import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Chessboard } from 'react-chessboard';
import { Chess } from 'chess.js';

/**
 * Chess board with staged-move UX:
 *   1. Click / drag-start  → select piece (show valid-move hints)
 *   2. Click dest / drop   → preview move (board shows result, Confirm/Cancel appear)
 *   3. Confirm             → emit move to server
 *   4. Cancel              → revert to original FEN
 *
 * yourSymbol: 'X' = White (bottom), 'O' = Black (bottom)
 */
export default function ChessBoard({ fen, yourSymbol, isMyTurn, onMove, disabled }) {
  const boardOrientation = yourSymbol === 'X' ? 'white' : 'black';
  const canInteract      = !disabled && isMyTurn;

  const [selectedSq,   setSelectedSq]   = useState(null);   // square currently selected
  const [highlightSqs, setHighlightSqs] = useState({});     // move-hint highlights
  const [pendingMove,  setPendingMove]  = useState(null);   // { from, to, move, previewFen }
  // Ref mirrors pendingMove to avoid stale-closure bugs in drag callbacks
  const pendingRef = useRef(null);

  // Clear everything when the server sends a new board position
  useEffect(() => {
    setSelectedSq(null);
    setHighlightSqs({});
    setPendingMove(null);
    pendingRef.current = null;
  }, [fen]);

  // ── Highlight builders ──────────────────────────────────────────────────────
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

  function buildPendingHighlights(from, to) {
    return {
      [from]: { background: 'rgba(251,191,36,0.70)', borderRadius: '4px' },
      [to]:   { background: 'rgba(251,191,36,0.70)', borderRadius: '4px' },
    };
  }

  // Try to validate a move locally and return { move, previewFen } or null
  function tryPreview(from, to, currentFen) {
    try {
      const chess = new Chess(currentFen);
      const piece = chess.get(from);
      const isPromotion =
        piece?.type === 'p' &&
        ((piece.color === 'w' && to[1] === '8') ||
         (piece.color === 'b' && to[1] === '1'));
      const move = chess.move({ from, to, promotion: isPromotion ? 'q' : undefined });
      if (!move) return null;
      return { move, previewFen: chess.fen() };
    } catch {
      return null;
    }
  }

  // ── Confirm / Cancel ────────────────────────────────────────────────────────
  const confirmMove = useCallback(() => {
    if (!pendingMove) return;
    onMove(pendingMove.move);
    // State will be reset by the fen useEffect once server confirms
  }, [pendingMove, onMove]);

  const cancelMove = useCallback(() => {
    pendingRef.current = null;
    setPendingMove(null);
    setSelectedSq(null);
    setHighlightSqs({});
  }, []);

  // ── Click handler ────────────────────────────────────────────────────────────
  const onSquareClick = useCallback(
    (square) => {
      if (!canInteract) return;
      if (pendingMove) return;         // block until confirmed/cancelled

      try {
        const chess   = new Chess(fen);
        const myColor = yourSymbol === 'X' ? 'w' : 'b';

        if (selectedSq) {
          // Is this a valid destination?
          const validMoves = chess.moves({ square: selectedSq, verbose: true });
          const isTarget   = validMoves.some(m => m.to === square);

          if (isTarget) {
            const preview = tryPreview(selectedSq, square, fen);
            if (preview) {
              const pm = { from: selectedSq, to: square, ...preview };
              pendingRef.current = pm;
              setPendingMove(pm);
              setHighlightSqs(buildPendingHighlights(selectedSq, square));
              setSelectedSq(null);
            }
            return;
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

        // Nothing selected — try to select a piece
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
    [canInteract, fen, yourSymbol, selectedSq, pendingMove]
  );

  // ── Drag-and-drop (also creates a pending preview) ───────────────────────────
  const onDrop = useCallback(
    (sourceSquare, targetSquare) => {
      if (!canInteract) return false;
      if (pendingRef.current) return false;   // use ref (not stale state)
      const preview = tryPreview(sourceSquare, targetSquare, fen);
      if (!preview) return false;
      const pm = { from: sourceSquare, to: targetSquare, ...preview };
      pendingRef.current = pm;
      setPendingMove(pm);
      setSelectedSq(null);
      setHighlightSqs(buildPendingHighlights(sourceSquare, targetSquare));
      return true;
    },
    [canInteract, fen]
  );

  // Show valid-move hints on drag start
  const onPieceDragBegin = useCallback(
    (_, square) => {
      if (!canInteract || pendingRef.current) return;
      try {
        const chess = new Chess(fen);
        const h = buildMoveHighlights(square, chess);
        if (h) { setSelectedSq(square); setHighlightSqs(h); }
      } catch {}
    },
    [canInteract, fen]
  );

  const onPieceDragEnd = useCallback(() => {
    // Use ref to check pending status — avoids stale closure issue
    // (onPieceDragEnd fires before React commits state from onDrop)
    if (!pendingRef.current) {
      setSelectedSq(null);
      setHighlightSqs({});
    }
  }, []);

  // The board shows the preview FEN while confirming, real FEN otherwise
  const displayFen = pendingMove ? pendingMove.previewFen : fen;

  return (
    <div className="w-full max-w-[520px] mx-auto select-none touch-none">
      <div className="shadow-2xl shadow-black/50 rounded-lg overflow-hidden border-2 border-slate-700">
        <Chessboard
          id="main-board"
          position={displayFen}
          boardOrientation={boardOrientation}
          onPieceDrop={onDrop}
          onSquareClick={onSquareClick}
          onPieceDragBegin={onPieceDragBegin}
          onPieceDragEnd={onPieceDragEnd}
          arePiecesDraggable={canInteract && !pendingMove}
          customSquareStyles={highlightSqs}
          customDarkSquareStyle={{ backgroundColor: '#4a5568' }}
          customLightSquareStyle={{ backgroundColor: '#e2e8f0' }}
          animationDuration={120}
          areArrowsAllowed={false}
        />
      </div>

      {/* ── Confirm / Cancel bar ─────────────────────────────────────────────── */}
      {canInteract && pendingMove && (
        <div className="flex gap-2 mt-2 px-1">
          <button
            onClick={confirmMove}
            className="flex-1 bg-green-600/90 hover:bg-green-500 active:bg-green-700 text-white font-bold rounded-xl py-3 text-sm flex items-center justify-center gap-2 transition-colors border border-green-500/60 shadow-lg shadow-green-900/30"
          >
            <span className="text-base">✓</span> Xác nhận
          </button>
          <button
            onClick={cancelMove}
            className="flex-[0.6] bg-slate-700/90 hover:bg-slate-600 active:bg-slate-800 text-slate-200 font-bold rounded-xl py-3 text-sm flex items-center justify-center gap-2 transition-colors border border-slate-600/50"
          >
            <span className="text-base">✗</span> Huỷ
          </button>
        </div>
      )}

      {/* ── Status hint text ─────────────────────────────────────────────────── */}
      {canInteract && !pendingMove && (
        <p className="text-center text-[11px] text-slate-500 mt-1.5">
          {selectedSq
            ? '🟡 Đã chọn — nhấp ô đích để xem trước'
            : '♟ Nhấp quân để chọn · nhấp ô để đi · hoặc kéo thả'}
        </p>
      )}
      {canInteract && pendingMove && (
        <p className="text-center text-[11px] text-amber-400/80 mt-1">
          🔶 Xem trước nước đi — xác nhận hoặc huỷ bỏ
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
