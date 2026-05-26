import React, { useState, useEffect, useRef } from 'react';

/**
 * Chess-style per-player countdown clock.
 *
 * Props:
 *   timeMs        – remaining milliseconds at start of this turn
 *   isActive      – true while this player's clock is ticking
 *   turnStartedAt – server timestamp when the current turn began (ms)
 *
 * When isActive changes to true (new turn) the component resets using timeMs
 * and counts down in real time.  When inactive, the clock is frozen.
 */
export default function ChessClock({ timeMs, isActive, turnStartedAt }) {
  const [displayMs, setDisplayMs] = useState(timeMs ?? 0);

  // Track the "base" snapshot so we can compute elapsed without drift
  const baseMs = useRef(timeMs ?? 0);
  const baseTs = useRef(Date.now());

  // Whenever the server gives us a fresh timeMs (new turn), re-anchor
  useEffect(() => {
    baseMs.current = timeMs ?? 0;
    baseTs.current = Date.now();
    setDisplayMs(timeMs ?? 0);
  }, [timeMs]);

  // Tick every 100 ms while active
  useEffect(() => {
    if (!isActive) return;
    const id = setInterval(() => {
      const elapsed = Date.now() - baseTs.current;
      setDisplayMs(Math.max(0, baseMs.current - elapsed));
    }, 100);
    return () => clearInterval(id);
  }, [isActive, timeMs]);           // re-run when turn switches

  // Format MM:SS
  const totalS  = Math.ceil(displayMs / 1000);
  const min     = Math.floor(totalS / 60);
  const sec     = totalS % 60;
  const display = `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;

  const isLow     = displayMs < 30_000;
  const isVeryLow = displayMs < 10_000;

  return (
    <div className={`
      font-mono tabular-nums font-black text-xl px-4 py-1.5 rounded-xl
      transition-all duration-300 select-none
      ${isActive
        ? isVeryLow
          ? 'bg-red-900/80 text-red-100 border border-red-500/60 animate-pulse shadow-lg shadow-red-900/40'
          : isLow
            ? 'bg-orange-900/70 text-orange-100 border border-orange-500/40 shadow-md shadow-orange-900/30'
            : 'bg-indigo-900/70 text-white border border-indigo-500/40 shadow-md shadow-indigo-900/30'
        : 'bg-slate-800/60 text-slate-400 border border-slate-700/30'
      }
    `}>
      {display}
    </div>
  );
}
