import React, { useState, useCallback, useEffect } from 'react';
import { Chessboard } from 'react-chessboard';
import { Chess } from 'chess.js';

/**
 * Chess board with click-to-select + click-to-move (works on Edge, mobile, all browsers)
 * Also supports drag-and-drop as a secondary option.
 *
 * yourSymbol: 'X' = White (bottom), 'O' = Black (bottom)
 */
export default function ChessBoard({ fen, yourSymbol, isMyTurn, onMove, disabled }) {
  const boardOrientation = yourSymbol === 'X' ? 'white' : 'black';
  const canInteract      = !disabled && isMyTurn;

  const [selectedSq, setSelectedSq]     = useState(null);  // currently selected square
  const [highlightSqs, setHighlightSqs] = useState({});    // squares to highlight

  // Clear selection whenever board state changes (after any move)
  useEffect(() => {
    setSelectedSq(null);
    setHighlightSqs({});
  }, [fen]);

  // Build highlight map for a selected square
  function buildHighlights(square, chess) {
    const moves = chess.moves({ square, verbose: true });
    if (!moves.length) return null;

    const h = {};
    // Selected piece — gold
    h[square] = { background: 'rgba(255, 214, 10, 0.55)', borderRadius: '4px' };
    // Valid target squares
    moves.forEach(m => {
      const isCapture = !!chess.get(m.to);
      h[m.to] = isCapture
        ? {
            // Capture hint: red ring
            background:
              'radial-gradient(circle, transparent 58%, rgba(220,38,38,0.55) 58%)',
            borderRadius: '50%',
          }
        : {
            // Move hint: green dot
            background:
              'radial-gradient(circle, rgba(34,197,94,0.55) 30%, transparent 30%)',
            borderRadius: '50%',
          };
    });
    return h;
  }

  // Try to execute a move from → to, return true on success
  const tryMove = useCallback(
    (from, to) => {
      try {
        const chess = new Chess(fen);
        // Check if it's a promotion (pawn reaching last rank)
        const piece = chess.get(from);
        const isPromotion =
          piece?.type === 'p' &&
          ((piece.color === 'w' && to[1] === '8') ||
           (piece.color === 'b' && to[1] === '1'));

        const move = chess.move({ from, to, promotion: 'q' });
        if (!move) return false;
        onMove(move);
        return true;
      } catch {
        return false;
      }
    },
    [fen, onMove]
  );

  // ── Click handler ────────────────────────────────────────────────────────────
  const onSquareClick = useCallback(
    (square) => {
      if (!canInteract) return;

      try {
        const chess = new Chess(fen);
        const myColor = yourSymbol === 'X' ? 'w' : 'b';

        // Case 1: something already selected
        if (selectedSq) {
          // Is this square a valid destination?
          const validMoves = chess.moves({ square: selectedSq, verbose: true });
          const isTarget = validMoves.some(m => m.to === square);

          if (isTarget) {
            // Execute move
            if (tryMove(selectedSq, square)) return; // state reset by fen useEffect
          }

          // Re-select if clicking another own piece
          const piece = chess.get(square);
          if (piece && piece.color === myColor) {
            const h = buildHighlights(square, chess);
            if (h) { setSelectedSq(square); setHighlightSqs(h); return; }
          }

          // Deselect
          setSelectedSq(null);
          setHighlightSqs({});
          return;
        }

        // Case 2: nothing selected — try to select a piece
        const piece = chess.get(square);
        if (piece && piece.color === myColor) {
          const h = buildHighlights(square, chess);
          if (h) { setSelectedSq(square); setHighlightSqs(h); }
        }
      } catch {
        setSelectedSq(null);
        setHighlightSqs({});
      }
    },
    [canInteract, fen, yourSymbol, selectedSq, tryMove]
  );

  // ── Drag-and-drop (secondary, same logic as click-to-move) ──────────────────
  const onDrop = useCallback(
    (sourceSquare, targetSquare) => {
      if (!canInteract) return false;
      return tryMove(sourceSquare, targetSquare);
    },
    [canInteract, tryMove]
  );

  // Show selected-piece highlight even for drag start
  const onPieceDragBegin = useCallback(
    (piece, square) => {
      if (!canInteract) return;
      try {
        const chess = new Chess(fen);
        const h = buildHighlights(square, chess);
        if (h) setHighlightSqs(h);
      } catch {}
    },
    [canInteract, fen]
  );

  const onPieceDragEnd = useCallback(() => {
    setHighlightSqs({});
    setSelectedSq(null);
  }, []);

  return (
    <div className="w-full max-w-[520px] mx-auto pb-2 select-none touch-none">
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
          customSquareStyles={highlightSqs}
          customDarkSquareStyle={{ backgroundColor: '#4a5568' }}
          customLightSquareStyle={{ backgroundColor: '#e2e8f0' }}
          animationDuration={150}
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
