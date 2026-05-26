/**
 * LSTS CaroTourney — Background music engine (Web Audio API, zero external files)
 * Two modes: 'lobby' (calm ambient) and 'game' (energetic).
 */

let _ctx = null;
let _masterGain = null;
let _muted = false;
let _playing = false;
let _currentMode = null;
let _timers = [];

function getCtx() {
  if (!_ctx) _ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (_ctx.state === 'suspended') _ctx.resume();
  return _ctx;
}

function getMaster() {
  const ctx = getCtx();
  if (!_masterGain || _masterGain.context !== ctx) {
    _masterGain = ctx.createGain();
    _masterGain.connect(ctx.destination);
  }
  return _masterGain;
}

function playNote(freq, dur, type, vol, delay = 0) {
  try {
    const ctx = getCtx();
    const master = getMaster();
    const t = ctx.currentTime + delay;

    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(master);

    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);

    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(vol, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);

    osc.start(t);
    osc.stop(t + dur + 0.05);
  } catch (_) {}
}

// ── Mode definitions ───────────────────────────────────────────────────────────
// Each mode is an array of { freq, dur, vol, type } played at `interval` ms apart.
const MODES = {
  /**
   * Lobby — Admin waiting room. Gentle, slow pentatonic melody in C major.
   * Evokes a calm, welcoming classroom atmosphere.
   */
  lobby: {
    interval: 750,
    type: 'sine',
    notes: [
      { freq: 261.6,  dur: 1.0, vol: 0.040 }, // C4
      { freq: 329.6,  dur: 0.9, vol: 0.035 }, // E4
      { freq: 392.0,  dur: 0.9, vol: 0.038 }, // G4
      { freq: 329.6,  dur: 0.9, vol: 0.030 }, // E4
      { freq: 493.9,  dur: 1.0, vol: 0.035 }, // B4
      { freq: 392.0,  dur: 0.9, vol: 0.032 }, // G4
      { freq: 329.6,  dur: 0.9, vol: 0.030 }, // E4
      { freq: 261.6,  dur: 1.2, vol: 0.038 }, // C4 (hold)
      { freq: 293.7,  dur: 0.9, vol: 0.030 }, // D4
      { freq: 261.6,  dur: 0.9, vol: 0.032 }, // C4
      { freq: 220.0,  dur: 1.2, vol: 0.035 }, // A3 (hold)
      { freq: 261.6,  dur: 0.9, vol: 0.030 }, // C4
    ],
  },

  /**
   * Game — Student gameplay. Brisk, rhythmic G pentatonic figure.
   * Energetic without being distracting.
   */
  game: {
    interval: 380,
    type: 'triangle',
    notes: [
      { freq: 392.0,  dur: 0.4, vol: 0.045 }, // G4
      { freq: 440.0,  dur: 0.4, vol: 0.040 }, // A4
      { freq: 523.25, dur: 0.4, vol: 0.045 }, // C5
      { freq: 440.0,  dur: 0.4, vol: 0.040 }, // A4
      { freq: 392.0,  dur: 0.4, vol: 0.042 }, // G4
      { freq: 349.2,  dur: 0.4, vol: 0.038 }, // F4
      { freq: 329.6,  dur: 0.4, vol: 0.040 }, // E4
      { freq: 392.0,  dur: 0.7, vol: 0.045 }, // G4 (hold)
      { freq: 493.9,  dur: 0.4, vol: 0.040 }, // B4
      { freq: 440.0,  dur: 0.4, vol: 0.038 }, // A4
      { freq: 392.0,  dur: 0.4, vol: 0.042 }, // G4
      { freq: 329.6,  dur: 0.7, vol: 0.040 }, // E4 (hold)
    ],
  },
};

// ── Loop scheduler ─────────────────────────────────────────────────────────────
function scheduleLoop(mode) {
  if (!_playing || _currentMode !== mode) return;

  const config = MODES[mode];
  let cumulative = 0;

  config.notes.forEach((note) => {
    const t = setTimeout(() => {
      if (_playing && _currentMode === mode) {
        playNote(note.freq, note.dur, config.type, note.vol);
      }
    }, cumulative);
    _timers.push(t);
    cumulative += config.interval;
  });

  // Schedule next iteration
  const loop = setTimeout(() => {
    if (_playing && _currentMode === mode) scheduleLoop(mode);
  }, cumulative + 200); // 200 ms gap between loops
  _timers.push(loop);
}

// ── Public API ─────────────────────────────────────────────────────────────────

/** Start background music for the given mode ('lobby' | 'game'). */
export function startMusic(mode) {
  if (!MODES[mode]) return;
  if (_currentMode === mode && _playing) return; // already playing this mode

  stopMusic(); // clean up any previous mode first
  _currentMode = mode;
  _playing = true;

  try {
    const ctx = getCtx();
    const master = getMaster();
    master.gain.setValueAtTime(_muted ? 0 : 1, ctx.currentTime);
    scheduleLoop(mode);
  } catch (_) {}
}

/** Stop all background music immediately. */
export function stopMusic() {
  _playing = false;
  _currentMode = null;
  _timers.forEach(clearTimeout);
  _timers = [];
}

/**
 * Mute or unmute background music.
 * Pass true to mute, false to unmute.
 * Changes take effect instantly via the master gain node.
 */
export function setMusicMuted(muted) {
  _muted = muted;
  if (_masterGain && _ctx) {
    _masterGain.gain.setValueAtTime(muted ? 0 : 1, _ctx.currentTime);
  }
}
