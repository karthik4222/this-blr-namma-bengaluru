/**
 * Kannada audio for the phrase, dish, place and festival cards.
 *
 * The site's Kannada strings are a fixed list, so the clips are rendered ahead of
 * time by scripts/build-kannada-audio.py and shipped as small AAC files under
 * audio/kn/<voice>/. There is nothing to download, nothing to opt into and no model
 * running in the visitor's browser - a tap fetches roughly ten kilobytes and plays.
 *
 * Two voices are built. The manifest names the default; a reader can switch, and the
 * choice is remembered. If a string has no clip, index.html falls back to whatever
 * voice the device has, as it did before.
 */

const MANIFEST_URL = 'audio/kn/manifest.json';
const CLIP_DIR = 'audio/kn/';
const PREF_KEY = 'namma-kannada-voice';

let manifest = null;
let voice = null;
let playing = null;
const audioFor = new Map(); // clip path -> HTMLAudioElement
const listeners = new Set();

/* Must match normalize() in scripts/build-kannada-audio.py so lookups line up. */
function normalize(text) {
  return text.replace(/\s+/g, ' ').trim();
}

function remembered() {
  try { return localStorage.getItem(PREF_KEY); } catch (e) { return null; }
}

const ready = fetch(MANIFEST_URL)
  .then((response) => {
    if (!response.ok) throw new Error(`manifest ${response.status}`);
    return response.json();
  })
  .then((data) => {
    manifest = data;
    const saved = remembered();
    voice = (saved && data.voices.includes(saved)) ? saved : data.default;
    /* Lets the per-card swap buttons appear only when there is something to swap to. */
    if (data.voices.length > 1) document.body.classList.add('has-voice-choice');
    console.info(`[kannada-voice] ${Object.keys(data.clips).length} phrases, ` +
                 `voices ${data.voices.join(', ')}, using ${voice}`);
    announce();
  })
  .catch((e) => {
    /* Not fatal: speakText() just uses the device voice instead. */
    console.warn('[kannada-voice] no clip manifest, falling back to the device voice', e);
  });

function announce() {
  for (const fn of listeners) {
    try { fn(voice, manifest ? manifest.voices : []); } catch (e) { /* a bad listener shouldn't stall the rest */ }
  }
}

function clipFor(text, which) {
  if (!manifest) return undefined;
  const perVoice = manifest.clips[normalize(text)];
  if (!perVoice) return undefined;
  const wanted = perVoice[which] ? which : manifest.default;
  const name = perVoice[wanted];
  return name ? `${CLIP_DIR}${wanted}/${name}` : undefined;
}

/** The voice a per-card swap should reach for: the next one along. */
function otherVoice() {
  if (!manifest || manifest.voices.length < 2) return null;
  const at = manifest.voices.indexOf(voice);
  return manifest.voices[(at + 1) % manifest.voices.length];
}

function playClip(path) {
  let audio = audioFor.get(path);
  if (!audio) {
    audio = new Audio(path);
    audio.preload = 'auto';
    audioFor.set(path, audio);
  }
  if (playing && playing !== audio) {
    playing.pause();
    playing.currentTime = 0;
  }
  playing = audio;
  audio.currentTime = 0;
  const started = audio.play();
  if (started && started.catch) {
    started.catch((e) => console.warn(`[kannada-voice] ${path} would not play`, e));
  }
}

const NammaVoice = {
  get voice() { return voice; },
  get voices() { return manifest ? manifest.voices : []; },

  onChange(fn) { listeners.add(fn); fn(voice, this.voices); },

  use(name) {
    if (!manifest || !manifest.voices.includes(name)) return;
    voice = name;
    try { localStorage.setItem(PREF_KEY, name); } catch (e) { /* private mode */ }
    announce();
  },

  /**
   * Returns true if a clip has taken the phrase, false to tell the caller to use the
   * device voice. Synchronous on purpose - speakText() needs the answer before it
   * decides - so a tap in the first moment after load can miss and fall back.
   */
  speak(text) {
    if (!text) return false;
    const path = clipFor(text, voice);
    if (!path) return false;
    playClip(path);
    return true;
  },

  /** Play one phrase in the other voice, without changing the reader's choice. */
  speakOther(text) {
    const other = otherVoice();
    if (!text || !other) return false;
    const path = clipFor(text, other);
    if (!path) return false;
    playClip(path);
    return true;
  },
};

window.NammaVoice = NammaVoice;

/* ---------------- the voice switch in the Kannada section ---------------- */

function mount() {
  const host = document.getElementById('voicePicker');
  if (!host) return;

  NammaVoice.onChange((current, voices) => {
    /* Nothing to choose between with one voice, so no control. */
    if (voices.length < 2) { host.hidden = true; return; }
    host.hidden = false;
    host.innerHTML = '<span class="voice-label">Voice</span>' + voices.map((name) =>
      `<button type="button" class="voice-choice" data-voice="${name}" ` +
      `aria-pressed="${name === current}">${name}</button>`).join('');
  });

  host.addEventListener('click', (event) => {
    const button = event.target.closest('.voice-choice');
    if (button) NammaVoice.use(button.dataset.voice);
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
else mount();

export default NammaVoice;
