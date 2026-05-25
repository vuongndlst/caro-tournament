import React, { useEffect, useState, useRef } from 'react';
import { Clock } from 'lucide-react';

export default function TimerBar({ turnStartedAt, turnDurationMs, isMyTurn }) {
  const [remaining, setRemaining] = useState(turnDurationMs);
  const rafRef = useRef(null);

  useEffect(() => {
    if (!turnStartedAt) return;

    const tick = () => {
      const elapsed = Date.now() - turnStartedAt;
      const left = Math.max(0, turnDurationMs - elapsed);
      setRemaining(left);
      if (left > 0) rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [turnStartedAt, turnDurationMs]);

  const seconds = Math.ceil(remaining / 1000);
  const pct = (remaining / turnDurationMs) * 100;

  const barColor =
    pct > 50 ? 'bg-green-500' :
    pct > 25 ? 'bg-yellow-400' :
               'bg-red-500';

  const textColor =
    pct > 50 ? 'text-green-400' :
    pct > 25 ? 'text-yellow-400' :
               'text-red-400';

  const urgent = pct <= 25;

  return (
    <div className="w-full">
      {/* Label row */}
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <Clock className={`w-3.5 h-3.5 ${textColor} ${urgent ? 'animate-pulse' : ''}`} />
          <span className="text-xs text-slate-400">
            {isMyTurn ? 'Thời gian của bạn' : 'Thời gian đối thủ'}
          </span>
        </div>
        <span className={`text-sm font-bold tabular-nums ${textColor} ${urgent ? 'animate-pulse' : ''}`}>
          {seconds}s
        </span>
      </div>

      {/* Progress bar */}
      <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-100 ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
