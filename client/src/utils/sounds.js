/**
 * CaroTourney — Web Audio API sound engine
 * No external files needed — all sounds are synthesised on-the-fly.
 */

let _ctx = null;

function getCtx() {
  if (!_ctx) {
    _ctx = new (window.AudioContext || window.webkitAudioContext)();
  }
  // Resume if suspended by browser autoplay policy
  if (_ctx.state === 'suspended') _ctx.resume();
  return _ctx;
}

/**
 * Play a single oscillator tone.
 * @param {number} freq      - frequency in Hz
 * @param {number} dur       - duration in seconds
 * @param {string} type      - 'sine' | 'square' | 'triangle' | 'sawtooth'
 * @param {number} vol       - peak gain 0-1
 * @param {number} delay     - start delay in seconds from now
 */
function tone(freq, dur, type = 'sine', vol = 0.25, delay = 0) {
  try {
    const c = getCtx();
    const t = c.currentTime + delay;

    const osc  = c.createOscillator();
    const gain = c.createGain();

    osc.connect(gain);
    gain.connect(c.destination);

    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);

    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(vol, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);

    osc.start(t);
    osc.stop(t + dur + 0.05);
  } catch (_) { /* silently ignore if AudioContext not available */ }
}

// ── Mute state ────────────────────────────────────────────────────────────────
let _muted = false;
export const isMuted  = () => _muted;
export const setMuted = (v) => { _muted = v; };
export const toggleMute = () => { _muted = !_muted; return _muted; };

function play(fn) {
  if (_muted) return;
  try { fn(); } catch (_) {}
}

// ── Sound library ─────────────────────────────────────────────────────────────
export const sounds = {
  /** Short click when placing a piece */
  place: () => play(() => {
    tone(660, 0.07, 'sine', 0.22);
  }),

  /** Ascending fanfare on winning */
  win: () => play(() => {
    tone(523.25, 0.10, 'sine', 0.28);
    tone(659.25, 0.10, 'sine', 0.28, 0.12);
    tone(783.99, 0.10, 'sine', 0.28, 0.24);
    tone(1046.5, 0.28, 'sine', 0.35, 0.36);
    tone(1318.5, 0.35, 'sine', 0.28, 0.52);
  }),

  /** Descending tones on losing */
  lose: () => play(() => {
    tone(392, 0.12, 'sine', 0.28);
    tone(349, 0.12, 'sine', 0.28, 0.15);
    tone(293.66, 0.28, 'sine', 0.30, 0.30);
  }),

  /** Neutral chord on draw */
  draw: () => play(() => {
    tone(440, 0.09, 'sine', 0.22);
    tone(440, 0.09, 'sine', 0.22, 0.14);
    tone(369.99, 0.22, 'sine', 0.22, 0.26);
  }),

  /** Urgent tick when timer < 10 s */
  tick: () => play(() => {
    tone(1200, 0.045, 'square', 0.12);
  }),

  /** Ping when a match is found */
  matchFound: () => play(() => {
    tone(880,  0.09, 'sine', 0.28);
    tone(1108, 0.13, 'sine', 0.32, 0.11);
  }),

  /** Opening fanfare when tournament starts */
  tournamentStart: () => play(() => {
    tone(523.25, 0.10, 'sine', 0.30);
    tone(659.25, 0.10, 'sine', 0.30, 0.10);
    tone(783.99, 0.10, 'sine', 0.30, 0.20);
    tone(1046.5, 0.18, 'sine', 0.34, 0.30);
    tone(1318.5, 0.30, 'sine', 0.30, 0.48);
  }),

  /** Click feedback for UI buttons */
  click: () => play(() => {
    tone(800, 0.04, 'sine', 0.14);
  }),

  /** Countdown beep (3-2-1) */
  countdown: () => play(() => {
    tone(660, 0.08, 'sine', 0.20);
  }),

  /** "GO!" beep — higher pitched */
  go: () => play(() => {
    tone(1046.5, 0.10, 'sine', 0.30);
    tone(1318.5, 0.18, 'sine', 0.25, 0.12);
  }),
};
