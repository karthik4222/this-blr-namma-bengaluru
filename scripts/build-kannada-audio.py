#!/usr/bin/env python3
"""Render every Kannada string on the site to a small audio clip, once.

The guide's Kannada phrases are a fixed list, so there is no reason to make each
visitor's browser synthesise them. This renders them ahead of time into
docs/audio/kn/ plus a manifest the page looks up at runtime.

Voice: AI4Bharat Indic Parler-TTS (https://huggingface.co/ai4bharat/indic-parler-tts),
Apache-2.0, trained on 1,806 hours of Indic speech. Kannada is one of its officially
supported languages and one where a delivery instruction is honoured, so the clips
are asked for in a conversational tone rather than a narration one. That is the
difference you can hear on the colloquial "-ri" endings that the alternatives read
stiffly.

The repository is gated: accept its terms once on Hugging Face and log in with
`hf auth login` before the first run. Nothing is needed after the weights cache.

Human recordings still beat it. Drop WAVs into a folder and pass --recordings and
they win over the model, phrase by phrase; the site cannot tell the difference.

Maintainers only; visitors never run this. The model is about 3.5 GB and generation
is slow (seconds per phrase), so a full rebuild takes a while. That cost is paid once
here rather than by every visitor.

    python3 -m venv .venv
    .venv/bin/pip install torch numpy git+https://github.com/huggingface/parler-tts.git
    .venv/bin/hf auth login
    .venv/bin/python scripts/build-kannada-audio.py
"""

import argparse
import glob
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import wave

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, 'docs', 'data')
INDEX = os.path.join(ROOT, 'docs', 'index.html')
OUT_DIR = os.path.join(ROOT, 'docs', 'audio', 'kn')
MANIFEST = os.path.join(OUT_DIR, 'manifest.json')
MODEL_ID = 'ai4bharat/indic-parler-tts'
SAMPLE_RATE = 44100
KANNADA = re.compile(r'[ಀ-೿]')

# AI4Bharat's Kannada speakers. They rate Suresh and Anu highest, which is why those
# two are built; the site lets a reader switch between them. DEFAULT_VOICE is what
# someone hears before they choose anything.
SPEAKERS = ('Suresh', 'Anu', 'Chetan', 'Vidya')
VOICES = ('Suresh', 'Anu')
DEFAULT_VOICE = 'Suresh'
# The model is autoregressive and sometimes keeps going after the word is finished,
# which comes out as a short phrase rambling for seconds. Roughly, a clip should run
# FIXED_SECONDS of lead-in plus PER_CHARACTER for each character; anything longer than
# TOLERANCE times that is the model overrunning rather than speaking slowly. Fitted to
# clips that sound right, then checked against the ones that do not.
FIXED_SECONDS = 0.35
PER_CHARACTER = 0.10
TOLERANCE = 1.8
RETRY_SEEDS = (0, 1, 2, 3, 4, 5)

# Keep this plain. An earlier version asked for a voice that was "casual",
# "conversational", "as if talking to a friend" and "expressive", and the model took
# that as licence to embellish: Anu inserted words the text did not contain, sometimes
# without the clip even running long. Asking only for clear speech fixed it. Greedy
# decoding was tried too and is much worse: with no randomness it can settle into a
# loop and run away, thirty seconds of audio for a single word. So the sampling stays
# and the instruction is what got simpler.
DELIVERY = ('{speaker} speaks clearly at a moderate pace. '
            'Very high quality recording, no background noise.')


def normalize(text):
    """Must match normalize() in docs/kannada-voice.js so lookups line up."""
    return re.sub(r'\s+', ' ', text).strip()


def prepare_for_voice(text):
    """The written form is not always speakable. Only affects what the model hears;
    the manifest is still keyed by the string as it appears on the site."""
    text = text.replace('‌', '').replace('‍', '')  # invisible joiners, no sound
    text = text.replace('/', ',')                            # "ಅಣ್ಣ / ಅಕ್ಕ" -> a pause
    return re.sub(r'\s+', ' ', text).strip()


def collect():
    """Every Kannada string the page can ask to speak, in a stable order."""
    found = {}

    def note(text, source):
        text = normalize(text)
        if text and KANNADA.search(text):
            found.setdefault(text, source)

    def walk(node, source):
        if isinstance(node, dict):
            for key, value in node.items():
                if key == 'kn' and isinstance(value, str):
                    note(value, source)
                else:
                    walk(value, source)
        elif isinstance(node, list):
            for value in node:
                walk(value, source)

    for path in sorted(glob.glob(os.path.join(DATA_DIR, '*.json'))):
        with open(path, encoding='utf-8') as fh:
            walk(json.load(fh), os.path.basename(path))

    # A handful of phrases are written straight into the page rather than the data.
    with open(INDEX, encoding='utf-8') as fh:
        for text in re.findall(r"speakText\('([^']+)'\)", fh.read()):
            note(text.replace("\\'", "'"), 'index.html')

    return found


def phrase_id(text):
    """Stable name for a phrase, independent of which voice rendered it. Used by
    --list and by --recordings so a human can name their files predictably."""
    return hashlib.sha1(text.encode('utf-8')).hexdigest()[:12]


def recording_for(directory, phrase):
    """A human recording for this phrase, if one has been dropped in."""
    if not directory:
        return None
    candidate = os.path.join(directory, phrase + '.wav')
    return candidate if os.path.exists(candidate) else None


def clip_path(voice, name):
    """Clips live one folder per voice, so 'one clip per phrase' stays true within
    a voice while the same phrase can exist in several."""
    return os.path.join(OUT_DIR, voice, name)


def clip_name(phrase, wav_path, kbps):
    """Clip filenames carry a hash of the audio, so re-rendering with a different
    voice produces a different URL. Without that, browsers and CDNs go on serving the
    copy they already cached and nobody hears the new voice.

    Hashed from the WAV rather than the encoded file on purpose: afconvert stamps a
    timestamp into its output, so encoding the same audio twice gives different bytes.
    Hashing that would rename every clip on every rebuild and pile up copies in git
    history for no reason."""
    with open(wav_path, 'rb') as fh:
        digest = hashlib.sha1(fh.read() + str(kbps).encode()).hexdigest()[:8]
    return f'{phrase}-{digest}.m4a'


def plausible_seconds(text):
    """About how long this phrase should take. Short words carry a fixed cost, so a
    flat seconds-per-character rule would wrongly condemn them."""
    return FIXED_SECONDS + PER_CHARACTER * len(text)


def load_voice(speaker):
    """Return a render function. The model is gated, so the first run needs
    `hf auth login`; afterwards the weights are cached locally."""
    import numpy as np
    import torch
    from parler_tts import ParlerTTSConfig, ParlerTTSForConditionalGeneration
    from transformers import AutoConfig, AutoTokenizer, set_seed

    # The package ships the config class but never registers it with AutoConfig.
    try:
        AutoConfig.register('parler_tts', ParlerTTSConfig)
    except ValueError:
        pass  # already registered

    # cuda first: on a rented GPU box this is the whole point, and checking only for
    # Apple's mps quietly left the GPU idle while the CPU did the work.
    if torch.cuda.is_available():
        device = 'cuda'
    elif torch.backends.mps.is_available():
        device = 'mps'
    else:
        device = 'cpu'
    model = ParlerTTSForConditionalGeneration.from_pretrained(MODEL_ID).to(device).eval()
    prompt_tokenizer = AutoTokenizer.from_pretrained(MODEL_ID, config=model.config)
    style_tokenizer = AutoTokenizer.from_pretrained(model.config.text_encoder._name_or_path)
    style = style_tokenizer(DELIVERY.format(speaker=speaker), return_tensors='pt').to(device)
    print(f'  loaded on {device}')

    def attempt(text, seed):
        set_seed(seed)  # sampled decoding; fixed per attempt so rebuilds are reproducible
        prompt = prompt_tokenizer(prepare_for_voice(text), return_tensors='pt').to(device)
        with torch.no_grad():
            generated = model.generate(
                input_ids=style.input_ids, attention_mask=style.attention_mask,
                prompt_input_ids=prompt.input_ids, prompt_attention_mask=prompt.attention_mask)
        return generated.cpu().numpy().squeeze().astype(np.float32)

    def render(text):
        # Keep the first attempt that runs to a plausible length, else the shortest of
        # them: a clip that overruns is worse than one that is merely a bit long.
        limit = plausible_seconds(text) * TOLERANCE
        best = None
        for seed in RETRY_SEEDS:
            audio = attempt(text, seed)
            seconds = audio.size / SAMPLE_RATE
            if best is None or seconds < best[0]:
                best = (seconds, audio, seed)
            if seconds <= limit:
                if seed != RETRY_SEEDS[0]:
                    print(f'      seed {seed} after {seed} overran ({seconds:.2f}s, '
                          f'wanted under {limit:.2f}s)')
                break
        else:
            print(f'      WARNING: every seed overran for "{text}" - kept the shortest '
                  f'at {best[0]:.2f}s against a {limit:.2f}s budget')
        audio = best[1]

        # Levels vary a lot between phrases; even them out so one clip is not
        # noticeably quieter than the next.
        peak = float(np.abs(audio).max()) if audio.size else 0.0
        if peak > 0.01:
            audio = audio * (0.89 / peak)
        return audio

    return render


def find_encoder():
    for tool in ('afconvert', 'ffmpeg'):
        if shutil.which(tool):
            return tool
    sys.exit('Need afconvert (macOS) or ffmpeg on PATH to encode the clips.')


def encode(encoder, wav_path, out_path, kbps):
    if encoder == 'afconvert':
        cmd = ['afconvert', '-f', 'm4af', '-d', 'aac', '-b', str(kbps * 1000),
               '-c', '1', wav_path, out_path]
    else:
        cmd = ['ffmpeg', '-y', '-loglevel', 'error', '-i', wav_path,
               '-c:a', 'aac', '-b:a', f'{kbps}k', '-ac', '1', out_path]
    subprocess.run(cmd, check=True, capture_output=True)


def write_wav(samples, rate, path):
    import numpy as np
    pcm = (np.clip(samples, -1.0, 1.0) * 32767).astype('<i2')
    with wave.open(path, 'wb') as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(rate)
        handle.writeframes(pcm.tobytes())


def load_manifest():
    """{'default': voice, 'voices': [...], 'clips': {text: {voice: file}}}."""
    if not os.path.exists(MANIFEST):
        return {}
    with open(MANIFEST, encoding='utf-8') as fh:
        data = json.load(fh)
    return data.get('clips', {})


def finish(clips, new_count):
    """Write the manifest and drop clips nothing points at any more."""
    with open(MANIFEST, 'w', encoding='utf-8') as fh:
        json.dump({'default': DEFAULT_VOICE, 'voices': list(VOICES), 'clips': clips},
                  fh, ensure_ascii=False, indent=0, sort_keys=True)

    total = 0
    for voice in VOICES:
        folder = os.path.join(OUT_DIR, voice)
        if not os.path.isdir(folder):
            continue
        keep = {per_voice[voice] for per_voice in clips.values() if voice in per_voice}
        for stale in sorted(os.listdir(folder)):
            if stale not in keep:
                os.remove(os.path.join(folder, stale))
                print(f'  removed stale clip {voice}/{stale}')
        total += sum(os.path.getsize(os.path.join(folder, n)) for n in keep)

    print(f'{len(clips)} phrases across {len(VOICES)} voices ({new_count} new), '
          f'{total/1e6:.2f} MB total, manifest at {os.path.relpath(MANIFEST, ROOT)}')


def check(phrases, clips):
    """Every phrase needs one clip in every voice, and nothing spare lying around."""
    problems = []

    for text in phrases:
        for voice in VOICES:
            name = clips.get(text, {}).get(voice)
            if not name:
                problems.append(f'no {voice} clip: {phrase_id(text)}  {text}')
            elif not os.path.exists(clip_path(voice, name)):
                problems.append(f'manifest points at a missing file: {voice}/{name}  ({text})')

    for voice in VOICES:
        folder = os.path.join(OUT_DIR, voice)
        if not os.path.isdir(folder):
            continue
        on_disk = {n for n in os.listdir(folder) if n.endswith('.m4a')}
        wanted = {per_voice[voice] for per_voice in clips.values() if voice in per_voice}

        # One phrase, one clip per voice. Two means a recorded clip and a rendered one
        # both survived, and which plays is down to whatever the manifest points at.
        seen = {}
        for name in sorted(on_disk):
            seen.setdefault(name.split('-')[0], []).append(name)
        for pid, names in sorted(seen.items()):
            if len(names) > 1:
                problems.append(f'{len(names)} {voice} clips for one phrase {pid}: '
                                f'{", ".join(names)}')

        for name in sorted(on_disk - wanted):
            problems.append(f'clip no phrase points at: {voice}/{name}')

    return problems


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--voice', choices=SPEAKERS, action='append', dest='voices',
                        help=f'render only this voice; repeatable (default {", ".join(VOICES)})')
    parser.add_argument('--kbps', type=int, default=32, help='AAC bitrate (default 32)')
    parser.add_argument('--recordings', metavar='DIR',
                        help='prefer human-recorded WAVs from DIR, named <phrase id>.wav')
    parser.add_argument('--list', action='store_true',
                        help='print the phrases and their ids, render nothing')
    parser.add_argument('--force', action='store_true',
                        help='re-render every clip, not just the ones that are missing')
    parser.add_argument('--check', action='store_true',
                        help='exit non-zero if anything is out of order; renders nothing')
    args = parser.parse_args()

    voices = tuple(args.voices) if args.voices else VOICES
    phrases = collect()
    print(f'{len(phrases)} distinct Kannada strings across the site')

    if args.list:
        for number, (text, source) in enumerate(phrases.items(), 1):
            mark = ''
            if args.recordings:
                mark = 'recorded ' if recording_for(args.recordings, phrase_id(text)) else '-------- '
            print(f'{number:3}. {phrase_id(text)}  {mark}{source:24} {text}')
        return

    clips = {text: dict(per_voice) for text, per_voice in load_manifest().items()
             if text in phrases}

    if args.check:
        problems = check(phrases, clips)
        if problems:
            print(f'{len(problems)} problem(s):')
            for problem in problems:
                print(f'   {problem}')
            sys.exit(1)
        print(f'{len(phrases)} phrases, {len(VOICES)} voices, all accounted for')
        return

    # A phrase with a recording waiting is never reused: re-encoding a WAV is instant
    # and costs no model, and otherwise a recording added later would be silently
    # ignored in favour of the clip the model already made.
    todo = []
    for voice in voices:
        for text in phrases:
            name = clips.get(text, {}).get(voice)
            fresh = name and os.path.exists(clip_path(voice, name))
            if args.force or not fresh or recording_for(args.recordings, phrase_id(text)):
                todo.append((voice, text))

    print(f'{len(todo)} clip(s) to render across {len(voices)} voice(s)')
    if not todo:
        finish(clips, 0)
        return

    import numpy as np

    encoder = find_encoder()
    renderers = {}
    tmp_wav = os.path.join(OUT_DIR, '.tmp.wav')

    for index, (voice, text) in enumerate(todo, 1):
        os.makedirs(os.path.join(OUT_DIR, voice), exist_ok=True)
        phrase = phrase_id(text)
        recorded = recording_for(args.recordings, phrase)

        if recorded:
            shutil.copyfile(recorded, tmp_wav)
            with wave.open(tmp_wav) as handle:
                seconds = handle.getnframes() / handle.getframerate()
            peak, origin = 1.0, 'recorded'
        else:
            if voice not in renderers:
                print(f'loading {voice}…')
                renderers[voice] = load_voice(voice)
            audio = renderers[voice](text)
            peak = float(np.abs(audio).max()) if audio.size else 0.0
            seconds = audio.size / SAMPLE_RATE
            write_wav(audio, SAMPLE_RATE, tmp_wav)
            origin = 'rendered'

        tmp_clip = os.path.join(OUT_DIR, '.tmp.m4a')
        if os.path.exists(tmp_clip):
            os.remove(tmp_clip)
        encode(encoder, tmp_wav, tmp_clip, args.kbps)
        name = clip_name(phrase, tmp_wav, args.kbps)
        os.replace(tmp_clip, clip_path(voice, name))
        clips.setdefault(text, {})[voice] = name

        flag = '  <-- CHECK: near silence or too short' if (peak < 0.02 or seconds < 0.2) else ''
        print(f'  [{index:3}/{len(todo)}] {voice:7} {origin} {seconds:5.2f}s '
              f'peak={peak:.2f} {text}{flag}')

    if os.path.exists(tmp_wav):
        os.remove(tmp_wav)

    finish(clips, len(todo))


if __name__ == '__main__':
    main()
