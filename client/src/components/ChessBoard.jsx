import React from 'react';
import { Chessboard } from 'react-chessboard';
import { Chess } from 'chess.js';

export default function ChessBoard({ fen, yourSymbol, isMyTurn, onMove, disabled }) {
  const boardOrientation = yourSymbol === 'X' ? 'white' : 'black';
  const canClick = !disabled && isMyTurn;

  function onDrop(sourceSquare, targetSquare, piece) {
    if (!canClick) return false;
    try {
      const chess = new Chess(fen);
      const move = chess.move({
        from: sourceSquare,
        to: targetSquare,
        promotion: 'q',
      });
      if (move === null) return false;
      onMove(move);
      return true;
    } catch (e) {
      return false;
    }
  }

  return (
    <div className="w-full max-w-[500px] mx-auto pb-4">
      <div className="shadow-2xl shadow-black/50 rounded-lg overflow-hidden border-2 border-slate-700">
        <Chessboard 
          position={fen} 
          onPieceDrop={onDrop} 
          boardOrientation={boardOrientation}
          arePiecesDraggable={canClick}
          customDarkSquareStyle={{ backgroundColor: '#475569' }}
          customLightSquareStyle={{ backgroundColor: '#cbd5e1' }}
        />
      </div>
    </div>
  );
}
