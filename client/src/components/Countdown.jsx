import React, { useState, useEffect } from 'react';
import { sounds } from '../utils/sounds';

/**
 * Full-screen 3-2-1 countdown overlay shown at the start of every match.
 * Calls `onDone()` when the "BẮT ĐẦU!" phase ends so GameView can proceed.
 */
export default function Countdown({ onDone }) {
  const [step, setStep] = useState(0);
  // steps: 0=3, 1=2, 2=1, 3=GO!, 4=hidden

  useEffect(() => {
    sounds.countdown();

    const delays = [900, 900, 900, 700];
    let timer;

    const advance = (current) => {
      if (current >= delays.length) {
        onDone?.();
        return;
      }
      if (current === 3) sounds.go();
      else sounds.countdown();

      timer = setTimeout(() => {
        setStep(current + 1);
        advance(current + 1);
      }, delays[current]);
    };

    timer = setTimeout(() => {
      setStep(1);
      advance(1);
    }, delays[0]);

    return () => clearTimeout(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (step >= 4) return null;

  const isGo    = step === 3;
  const display = isGo ? 'BẮT ĐẦU!' : String(3 - step);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div
        key={step}
        className={`font-black select-none animate-countdown ${
          isGo
            ? 'text-green-400 text-7xl'
            : 'text-white text-[11rem] leading-none'
        }`}
        style={{
          textShadow: isGo
            ? '0 0 40px rgba(74,222,128,0.9), 0 0 80px rgba(74,222,128,0.4)'
            : '0 0 40px rgba(99,102,241,0.9), 0 0 80px rgba(99,102,241,0.4)',
          filter: 'drop-shadow(0 0 20px currentColor)',
        }}
      >
        {display}
      </div>

      {!isGo && (
        <div className="absolute bottom-1/3 text-slate-400 text-sm tracking-widest uppercase">
          Chuẩn bị…
        </div>
      )}
    </div>
  );
}
