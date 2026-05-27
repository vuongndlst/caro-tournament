import React, { useState, useCallback, useEffect } from 'react';
import { Chessboard } from 'react-chessboard';
import { Chess } from 'chess.js';

/**
 * Chess board with click-to-select + click-to-move UX.
 *   1. Click piece   → select (gold highlight + green/red move hints)
 *   2. Click dest    → execute move immediately (no confirm step)
 *   3. Drag-and-drop → also works as secondary input
 *
 * When it is the active player's turn and their king is in check,
 * the king's square is highlighted red automatically.
 *
 * yourSymbol: 'X' = White (board at bottom), 'O' = Black (board at bottom)
 */
export default function ChessBoard({ fen, yourSymbol, isMyTurn, onMove, disabled }) {
  const boardOrientation = yourSymbol === 'X' ? 'white' : 'black';
  const canInteract      = !disabled && isMyTurn;
  const myColor          = yourSymbol === 'X' ? 'w' : 'b';

  const [selectedSq,   setSelectedSq]   = useState(null);
  const [highlightSqs, setHighlightSqs] = useState({});

  // Clear selection whenever the board changes (after any move lands)
  useEffect(() => {
    setSelectedSq(null);
    setHighlightSqs({});
  }, [fen]);

  // ── Highlight helpers ──────────────────────────────────────────────────────
  function buildMoveHighlights(square, chess) {
    const moves = chess.moves({ square, verbose: true });
    if (!moves.length) return null;
    const h = {};
    h[square] = { background: 'rgba(255, 214, 10, 0.55)', borderRadius: '4px' };
    moves.forEach(m => {
      const isCapture = !!chess.get(m.to);
      h[m.to] = isCapture
        ? { background: 'radial-gradient(circle, transparent 58%, rgba(220,38,38,0.65) 58%)', borderRadius: '50%' }
        : { background: 'radial-gradient(circle, rgba(34,197,94,0.55) 30%, transparent 30%)',  borderRadius: '50%' };
    });
    return h;
  }

  // Red king highlight when in check (computed every render, lightweight)
  function buildCheckHighlight(chess) {
    if (!chess.inCheck()) return {};
    for (const row of chess.board()) {
      for (const sq of row) {
        if (sq?.type === 'k' && sq.color === myColor) {
          return { [sq.square]: { background: 'rgba(220, 38, 38, 0.60)', borderRadius: '4px' } };
        }
      }
    }
    return {};
  }

  // ── Move execution ─────────────────────────────────────────────────────────
  const tryMove = useCallback(
    (from, to) => {
      try {
        const chess = new Chess(fen);
        const piece = chess.get(from);
        const isPromotion =
          piece?.type === 'p' &&
          ((piece.color === 'w' && to[1] === '8') ||
           (piece.color === 'b' && to[1] === '1'));
        const move = chess.move({ from, to, promotion: isPromotion ? 'q' : undefined });
        if (!move) return false;
        onMove(move);
        return true;
      } catch {
        return false;
      }
    },
    [fen, onMove]
  );

  // ── Click handler ──────────────────────────────────────────────────────────
  const onSquareClick = useCallback(
    (square) => {
      if (!canInteract) return;
      try {
        const chess = new Chess(fen);

        if (selectedSq) {
          // Check if this is a valid target
          const validMoves = chess.moves({ square: selectedSq, verbose: true });
          const isTarget   = validMoves.some(m => m.to === square);

          if (isTarget) {
            if (tryMove(selectedSq, square)) return;   // state cleared by fen useEffect
          }

          // Re-select another own piece
          const piece = chess.get(square);
          if (piece && piece.color === myColor) {
            const h = buildMoveHighlights(square, chess);
            if (h) { setSelectedSq(square); setHighlightSqs(h); return; }
          }

          // Deselect
          setSelectedSq(null);
          setHighlightSqs({});
          return;
        }

        // Nothing selected — select a piece
        const piece = chess.get(square);
        if (piece && piece.color === myColor) {
          const h = buildMoveHighlights(square, chess);
          if (h) { setSelectedSq(square); setHighlightSqs(h); }
        }
      } catch {
        setSelectedSq(null);
        setHighlightSqs({});
      }
    },
    [canInteract, fen, myColor, selectedSq, tryMove]
  );

  // ── Drag-and-drop ──────────────────────────────────────────────────────────
  const onDrop = useCallback(
    (sourceSquare, targetSquare) => {
      if (!canInteract) return false;
      return tryMove(sourceSquare, targetSquare);
    },
    [canInteract, tryMove]
  );

  const onPieceDragBegin = useCallback(
    (_, square) => {
      if (!canInteract) return;
      try {
        const chess = new Chess(fen);
        const h = buildMoveHighlights(square, chess);
        if (h) { setSelectedSq(square); setHighlightSqs(h); }
      } catch {}
    },
    [canInteract, fen]
  );

  const onPieceDragEnd = useCallback(() => {
    setSelectedSq(null);
    setHighlightSqs({});
  }, []);

  // ── Compute combined square styles ─────────────────────────────────────────
  // Check highlight applied first (lowest priority), move hints on top
  let checkHighlight = {};
  if (canInteract) {
    try { checkHighlight = buildCheckHighlight(new Chess(fen)); } catch {}
  }
  const combinedHighlights = { ...checkHighlight, ...highlightSqs };

  return (
    <div className="w-full max-w-[520px] mx-auto select-none touch-none">
      <div className="shadow-2xl shadow-black/50 rounded-lg overflow-hidden border-2 border-slate-700">
        <Chessboard
          id="main-board"
          position={fen}
          boardOrientation={boardOrientation}
          onPieceDrop={onDrop}
          onSquareClick={onSquareClick}
          onPieceDragBegin={onPieceDragBegin}
          onPieceDragEnd={onPieceDragEnd}
          arePiecesDraggable={canInteract}
          customSquareStyles={combinedHighlights}
          customDarkSquareStyle={{ backgroundColor: '#4a5568' }}
          customLightSquareStyle={{ backgroundColor: '#e2e8f0' }}
          animationDuration={120}
          areArrowsAllowed={false}
        />
      </div>

      {/* Hint text */}
      {canInteract && (
        <p className="text-center text-[11px] text-slate-500 mt-1.5">
          {selectedSq
            ? '🟡 Đã chọn — nhấp ô đích hoặc nhấp lại để huỷ'
            : '♟ Nhấp quân để chọn, nhấp ô để đi · hoặc kéo thả'}
        </p>
      )}
      {!canInteract && !disabled && (
        <p className="text-center text-[11px] text-slate-600 mt-1.5">
          Đang chờ đối thủ...
        </p>
      )}
    </div>
  );
}
