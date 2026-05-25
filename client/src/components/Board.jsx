import React, { useMemo } from 'react';

// Star points for 15x15 Gobang board (traditional markers)
const STAR_POINTS_15 = new Set([
  '3,3','3,7','3,11',
  '7,3','7,7','7,11',
  '11,3','11,7','11,11',
]);

const CELL_SIZE_MAP = { 15: 36, 20: 28 };

export default function Board({ board, size = 15, yourSymbol, isMyTurn, onCellClick, disabled, winningCells }) {
  const cellPx = CELL_SIZE_MAP[size] ?? 32;

  const winSet = useMemo(() => {
    if (!winningCells) return new Set();
    return new Set(winningCells.map(([r, c]) => `${r},${c}`));
  }, [winningCells]);

  const opponentSymbol = yourSymbol === 'X' ? 'O' : 'X';
  const canClick = !disabled && isMyTurn;

  return (
    <div className="flex justify-center overflow-x-auto pb-2">
      <div
        className="relative rounded-2xl overflow-hidden shadow-2xl shadow-black/50 shrink-0"
        style={{
          background: 'linear-gradient(135deg, #3d1f0a 0%, #5c2e0e 40%, #3d1f0a 100%)',
          padding: 10,
          border: '2px solid #7c4a1e',
        }}
      >
        {/* Outer wood frame glow */}
        <div
          className="absolute inset-0 rounded-2xl pointer-events-none"
          style={{ boxShadow: 'inset 0 0 30px rgba(0,0,0,0.6)' }}
        />

        <div
          className="relative grid"
          style={{
            gridTemplateColumns: `repeat(${size}, ${cellPx}px)`,
            gridTemplateRows:    `repeat(${size}, ${cellPx}px)`,
            gap: 0,
          }}
        >
          {Array.from({ length: size * size }, (_, idx) => {
            const r = Math.floor(idx / size);
            const c = idx % size;
            const value = board[r][c];
            const isWin = winSet.has(`${r},${c}`);
            const isStar = STAR_POINTS_15.has(`${r},${c}`) && size === 15;
            const isEmpty = value === null;

            const isTopEdge    = r === 0;
            const isBottomEdge = r === size - 1;
            const isLeftEdge   = c === 0;
            const isRightEdge  = c === size - 1;

            return (
              <div
                key={idx}
                className="board-cell relative flex items-center justify-center select-none"
                style={{ width: cellPx, height: cellPx, cursor: isEmpty && canClick ? 'pointer' : 'default' }}
                onClick={() => isEmpty && canClick && onCellClick(r, c)}
              >
                {/* Grid lines — only draw right & bottom half-lines so they meet at cell centers */}
                {!isRightEdge && (
                  <div className="absolute pointer-events-none"
                    style={{ left: '50%', top: '50%', width: '50%', height: 1, background: 'rgba(180,120,60,0.45)', transform: 'translateY(-50%)' }} />
                )}
                {!isLeftEdge && (
                  <div className="absolute pointer-events-none"
                    style={{ right: '50%', top: '50%', width: '50%', height: 1, background: 'rgba(180,120,60,0.45)', transform: 'translateY(-50%)' }} />
                )}
                {!isBottomEdge && (
                  <div className="absolute pointer-events-none"
                    style={{ left: '50%', top: '50%', width: 1, height: '50%', background: 'rgba(180,120,60,0.45)', transform: 'translateX(-50%)' }} />
                )}
                {!isTopEdge && (
                  <div className="absolute pointer-events-none"
                    style={{ left: '50%', bottom: '50%', width: 1, height: '50%', background: 'rgba(180,120,60,0.45)', transform: 'translateX(-50%)' }} />
                )}

                {/* Star point dot */}
                {isStar && isEmpty && (
                  <div className="absolute w-2 h-2 rounded-full bg-amber-800/80 pointer-events-none z-10"
                    style={{ transform: 'translate(-50%,-50%)', left: '50%', top: '50%' }} />
                )}

                {/* Hover preview */}
                {isEmpty && canClick && (
                  <div
                    className="cell-preview absolute rounded-full opacity-0 transition-opacity duration-100 pointer-events-none z-10"
                    style={{
                      width: '72%', height: '72%',
                      background: yourSymbol === 'X' ? 'rgba(96,165,250,0.55)' : 'rgba(248,113,113,0.55)',
                    }}
                  />
                )}

                {/* Piece */}
                {value && (
                  <div
                    className={`
                      relative z-20 rounded-full flex items-center justify-center
                      font-black text-xs leading-none animate-piece
                      ${isWin
                        ? (value === 'X' ? 'win-cell-x' : 'win-cell-o')
                        : ''}
                    `}
                    style={{
                      width: '78%', height: '78%',
                      background: value === 'X'
                        ? 'radial-gradient(circle at 35% 35%, #93c5fd, #1d4ed8)'
                        : 'radial-gradient(circle at 35% 35%, #fca5a5, #b91c1c)',
                      boxShadow: isWin
                        ? undefined
                        : value === 'X'
                          ? '0 2px 6px rgba(29,78,216,0.6), inset 0 1px 2px rgba(255,255,255,0.3)'
                          : '0 2px 6px rgba(185,28,28,0.6), inset 0 1px 2px rgba(255,255,255,0.3)',
                    }}
                  >
                    {/* Inner shine */}
                    <div className="absolute rounded-full pointer-events-none"
                      style={{ width: '35%', height: '35%', top: '12%', left: '15%',
                        background: 'rgba(255,255,255,0.45)', borderRadius: '50%' }} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
