import { chooseBoardMove, chooseChessMove } from '../utils/botEngine';

self.onmessage = ({ data }) => {
  try {
    const move = data.gameType === 'chess'
      ? chooseChessMove(data.board, data.difficulty)
      : chooseBoardMove(data.board, data.gameType, data.botSymbol, data.difficulty);
    self.postMessage({ success: true, move });
  } catch (error) {
    self.postMessage({ success: false, message: error instanceof Error ? error.message : 'Bot không tìm được nước đi' });
  }
};
