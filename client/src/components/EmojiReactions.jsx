import React, { useState, useEffect, useRef, useCallback } from 'react';

const EMOJIS = ['👍', '😮', '🤔', '😅', '🔥', '💯'];

let _nextId = 0;

/**
 * Emoji reaction bar + floating emoji animations.
 *
 * Props:
 *   onReact(emoji)  — called when the local player taps a reaction
 *   incoming        — { emoji, fromId } object from server (changes on each incoming reaction)
 *   disabled        — hide the send buttons (spectator mode)
 */
export default function EmojiReactions({ onReact, incoming, disabled }) {
  const [floaters, setFloaters] = useState([]);
  // Track cooldown per emoji to prevent spam
  const cooldowns = useRef({});

  const addFloater = useCallback((emoji, isOpponent) => {
    const id = _nextId++;
    setFloaters(f => [...f, { id, emoji, isOpponent }]);
    setTimeout(() => setFloaters(f => f.filter(x => x.id !== id)), 1800);
  }, []);

  // Show incoming emoji from opponent
  useEffect(() => {
    if (!incoming?.emoji) return;
    addFloater(incoming.emoji, true);
  }, [incoming, addFloater]);

  const handleSend = (emoji) => {
    if (disabled) return;
    const now = Date.now();
    if (cooldowns.current[emoji] && now - cooldowns.current[emoji] < 1500) return; // 1.5s cooldown
    cooldowns.current[emoji] = now;
    onReact?.(emoji);
    addFloater(emoji, false);
  };

  return (
    <div className="relative">
      {/* Floating emojis */}
      {floaters.map(({ id, emoji, isOpponent }) => (
        <div
          key={id}
          className="absolute pointer-events-none z-20 text-2xl animate-float-up"
          style={{
            bottom: '100%',
            [isOpponent ? 'right' : 'left']: `${8 + Math.random() * 24}px`,
          }}
        >
          {emoji}
        </div>
      ))}

      {/* Send buttons */}
      {!disabled && (
        <div className="flex items-center gap-1 flex-wrap">
          {EMOJIS.map(e => (
            <button
              key={e}
              onClick={() => handleSend(e)}
              className="text-lg hover:scale-125 active:scale-90 transition-transform duration-100 select-none px-0.5 py-0.5 rounded-lg hover:bg-slate-700/50"
              title={`Gửi ${e}`}
            >
              {e}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
