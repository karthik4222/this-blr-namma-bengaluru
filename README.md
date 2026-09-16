# namma-blr-not-that
Namma Bengaluru, not that

This is a static GitHub Pages site. The published source is `docs/`.

- `docs/index.html` — markup only
- `docs/css/` — `tokens.css` (palette and type), `layout.css` (chrome and cards), `stage.css` (background stage and loader)
- `docs/js/` — `guide.js` (data, rendering, forms), `stage.js` (scroll decorations)
- `docs/audio/kn/` — a small audio clip per Kannada phrase, plus `manifest.json`
- `docs/kannada-voice.js` — looks up a phrase's clip and plays it
- `docs/data/*.json` — lists. Bengaluru spots live in `locations.json` (including `personalPick`, `skipCrowd`, and a `try` list). Day trips live in `karnataka-places.json`. Dishes live in `dishes.json`. Asides live in `did-you-know.json`. The page fetches those files on load.

Do not put new lists back into the HTML.

## Kannada audio

Next to every Kannada word on the site there is a speaker button. Tapping it plays a
recording of that word.

The recordings are made ahead of time, not in the browser. They live in `docs/audio/kn/`
as small `.m4a` files, one per phrase, about 10 KB each. `manifest.json` in that folder
says which file belongs to which Kannada string, and `docs/kannada-voice.js` looks it up
and plays it. That is the whole thing.

We do it this way because the list of Kannada phrases is fixed. There are 147 of them and
they rarely change, so there is no reason to make every visitor's phone work them out.
Making the sound once and shipping the files means a visitor downloads about 10 KB when
they tap something, instead of a 38 MB speech model before they hear anything.

If a phrase has no clip, the button falls back to whatever Kannada voice the visitor's
device has. That is usually none, so it will be silent or sound wrong. Not broken, just
not useful. So it is worth making sure every phrase has a clip.

### Which machine renders what

Two jobs, two places, because the speech model is heavy.

**A few new phrases: GitHub Actions.** Add a phrase, push, and the Action renders it and
commits the clip. A couple of minutes per phrase on their CPU runners, which is fine for
the handful a change usually adds. This is the normal case and needs no setup from
whoever adds the phrase.

**Building a whole voice from scratch: a machine with a GPU.** All 158 phrases in one
voice takes roughly two hours on an Apple Silicon Mac, and would be far slower on a CPU
runner with a real chance of hitting the six-hour job limit. Do that locally and commit
the result.

So the Action is for keeping up, not for bulk work.

### I want to add a Kannada phrase

Add it to the right file in `docs/data/` like you would any other entry, with its `kn`
field. Commit and push.

That is it. A GitHub Action notices the new phrase, makes the audio for it, and commits
the file back to your branch a few minutes later. You do not need Python, the model, or
any of the rest of this page.

If you open a pull request, a check tells you whether every phrase has audio yet. If it
says one is missing, either wait for the Action to finish or make it yourself, below.

### Making the audio yourself

This is the same thing the Action does: feed each Kannada string to the speech model,
save what comes back as a small audio file, and record it in the manifest. You only need
to run it by hand if you want the clip straight away, or if the Action is not set up.

The model is gated, which means you need a free Hugging Face account and you have to click
accept on its page once:

1. Sign in at <https://huggingface.co>
2. Click accept at <https://huggingface.co/ai4bharat/indic-parler-tts>, which is instant
3. Make a read token at <https://huggingface.co/settings/tokens>

Then, from the repo root:

```bash
python3 -m venv .venv
.venv/bin/pip install torch numpy git+https://github.com/huggingface/parler-tts.git
.venv/bin/hf auth login          # paste the token when it asks
.venv/bin/python scripts/build-kannada-audio.py
```

It only makes clips that are missing, so adding one phrase takes about a minute. If
nothing is missing it does nothing at all. Add `--force` to redo everything, which takes
around an hour.

The first run downloads the model, which is about 3.5 GB, so give it time. You also need
`afconvert`, which comes with macOS, or `ffmpeg` on Linux.

Other useful flags:

- `--list` prints every phrase and its id without making anything
- `--check` fails if anything is out of order, which is what CI uses. It catches a
  phrase with no clip, a phrase with two clips, a clip nothing points at, and a
  manifest entry whose file is gone
- `--voice Anu` uses a different speaker. The choices are Suresh, Anu, Chetan and Vidya

### Turning on the automatic rebuilds

The Action needs one secret to work, because the model is gated. Whoever owns the repo
sets it once, and then anyone can add phrases without installing anything.

Do steps 1 to 3 above to get a token, then add it to the repo under Settings, Secrets and
variables, Actions, with the name `HF_TOKEN`. Or from a terminal:

```bash
gh secret set HF_TOKEN
```

It is a repo secret rather than a person's, so it keeps working when contributors come and
go.

Nothing breaks if it is never set. The Action still runs and still tells you which phrases
have no audio, it just cannot make them. The clips already in the repo play either way.

### Mixing in a real person's voice

Recordings and model clips live side by side. It is per phrase, not all or nothing, so
you can record the ten phrases you care most about and let the model keep handling the
other hundred and thirty seven. The site cannot tell the difference.

Get the list of phrases and their ids:

```bash
.venv/bin/python scripts/build-kannada-audio.py --list
```

An id looks like `bbf48876fb45`. Record a phrase, save it as `bbf48876fb45.wav` in a
folder somewhere, and point the script at that folder:

```bash
.venv/bin/python scripts/build-kannada-audio.py --recordings path/to/that/folder
```

A phrase with a recording uses the recording. Everything else is left exactly as it is,
or made by the model if it has no clip yet. Add more recordings to the folder later and
run it again; only the new ones get picked up.

Each phrase ends up with exactly one clip, whichever source it came from. The Action
never touches a phrase that already has one, so a recording you commit stays put. If two
clips for the same phrase ever do appear, `--check` fails and CI goes red rather than
leaving it to chance which one plays.

A run that is only taking in recordings finishes in under a second and never touches the
model, so you do not need the Hugging Face login or the 3.5 GB download for it.

Adding `--recordings` to `--list` marks which phrases you have already recorded, which is
handy when working through them a few at a time.

### Changing the voice

Edit `MODEL_ID` and `SPEAKERS` at the top of `scripts/build-kannada-audio.py`, then run it
with `--force` to redo every clip.

Before you commit the result, listen to `ಬರ್ರಿ`, `ಕೂಡ್ರಿ` and `ಹೇಗಿದ್ದೀರಾ?` first. Those are
the ones that catch a bad voice. We tried three others before this one and all three
failed on exactly those, because they read words out rather than speak them, and the
colloquial `-ri` ending is where that shows up worst.

### A few things worth knowing

Clip filenames contain a hash of the audio, so if you change the voice, every filename
changes. That is on purpose. Without it a browser would keep playing the copy it had
already saved and nobody would ever hear the new voice.

The hash comes from the audio before it is compressed, not from the finished file,
because `afconvert` stamps a timestamp into everything it writes. Hashing the finished
file would rename all 147 clips on every rebuild and leave a fresh copy of each in git
history for no reason.

The script also deletes clips for phrases that no longer exist on the site, so it is safe
to run whenever.

### Credit and licence

The clips are made with [AI4Bharat Indic Parler-TTS](https://huggingface.co/ai4bharat/indic-parler-tts),
speaker Suresh, from IIT Madras. It is trained on 1,806 hours of Indian language speech and
licensed Apache-2.0. Please keep the credit.

Suresh is a real person, but he never said any of these phrases. He recorded hours of other
Kannada sentences for an open research dataset, and the model learned both how Kannada
sounds and what his voice sounds like. Everything in `docs/audio/kn/` is generated, which is
why it can say restaurant names nobody has ever recorded.

## Local preview

From the repo root:

```bash
./scripts/preview.sh
```

Then open http://127.0.0.1:5600/

In Cursor / VS Code, run the **Preview GitHub Pages** task (default build task). Edit files under `docs/` and refresh the browser.

Override the port with `PORT=8080 ./scripts/preview.sh` if 5600 is already in use.

## Contributors

- Vinay Karthik Baluguri — Kannada audio
