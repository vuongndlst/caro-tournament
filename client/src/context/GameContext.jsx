import React, { createContext, useContext, useReducer, useEffect, useCallback, useRef } from 'react';
import { socket } from '../socket';
import { sounds } from '../utils/sounds';

const GameContext = createContext(null);

const initialState = {
  connected: false,
  // Shared
  roomCode: null,
  role: null, // 'admin' | 'player'
  tournamentState: null,
  // Player specific
  playerId: null,
  nickname: null,
  currentMatch: null,
  gameResult: null,
  playerStatus: 'idle', // 'idle' | 'waiting' | 'playing' | 'result'
  // Reaction from opponent
  incomingReaction: null, // { emoji, fromId, ts }
  // Show countdown overlay
  showCountdown: false,
  // Reconnect state
  opponentReconnecting: false,
  // UI
  error: null,
};

function reducer(state, action) {
  switch (action.type) {
    case 'SET_CONNECTED': return { ...state, connected: action.payload };
    case 'SET_ERROR':     return { ...state, error: action.payload };
    case 'CLEAR_ERROR':   return { ...state, error: null };

    case 'ADMIN_CREATED':
      return { ...state, role: 'admin', roomCode: action.payload.roomCode, error: null };

    case 'PLAYER_JOINED': {
      // Vào lại sau khi tải lại trang: nếu server báo còn trận đang chạy thì
      // khôi phục thẳng vào ván, đừng ném học sinh về sảnh rồi kẹt ở đó.
      const resumed = action.payload.match || null;
      return {
        ...state,
        role: 'player',
        playerId: action.payload.playerId,
        nickname: action.payload.nickname,
        roomCode: action.payload.roomCode,
        currentMatch: resumed ? {
          matchId:          resumed.matchId,
          gameType:         resumed.gameType || (typeof resumed.board === 'string' ? 'chess' : resumed.size === 3 ? 'tictactoe' : 'caro'),
          opponentNickname: resumed.opponentNickname,
          opponentId:       resumed.opponentId,
          yourSymbol:       resumed.yourSymbol,
          opponentSymbol:   resumed.opponentSymbol,
          currentTurn:      resumed.currentTurn,
          board:            resumed.board,
          size:             resumed.size,
          turnStartedAt:    resumed.turnStartedAt || Date.now(),
          turnDurationMs:   resumed.turnDurationMs || 30000,
          p1TimeMs:         resumed.p1TimeMs ?? null,
          p2TimeMs:         resumed.p2TimeMs ?? null,
          chessIncMs:       resumed.chessIncMs ?? null,
        } : null,
        playerStatus: resumed ? 'playing' : 'waiting',
        showCountdown: false,
        error: null,
      };
    }

    case 'ROOM_STATE_UPDATE':
      return { ...state, tournamentState: action.payload };

    case 'MATCH_FOUND': {
      // Auto-detect gameType in case server omits it (fallback)
      const payload = action.payload;
      const detectedType = payload.gameType ||
        (typeof payload.board === 'string' ? 'chess' :
         payload.size === 3 ? 'tictactoe' : 'caro');
      return {
        ...state,
        currentMatch: {
          matchId:          payload.matchId,
          gameType:         detectedType,
          opponentNickname: payload.opponentNickname,
          opponentId:       payload.opponentId,
          yourSymbol:       payload.yourSymbol,
          opponentSymbol:   payload.opponentSymbol,
          currentTurn:      payload.currentTurn,
          board:            payload.board,
          size:             payload.size,
          turnStartedAt:    payload.turnStartedAt || Date.now(),
          turnDurationMs:   payload.turnDurationMs || 30000,
          // Chess per-player clocks (null for non-chess)
          p1TimeMs:         payload.p1TimeMs  ?? null,
          p2TimeMs:         payload.p2TimeMs  ?? null,
          chessIncMs:       payload.chessIncMs ?? null,
        },
        gameResult:       null,
        playerStatus:     'playing',
        showCountdown:    true,
        incomingReaction: null,
      };
    }

    case 'HIDE_COUNTDOWN':
      return { ...state, showCountdown: false };

    case 'TURN_START':
      if (!state.currentMatch || state.currentMatch.matchId !== action.payload.matchId) return state;
      return {
        ...state,
        currentMatch: {
          ...state.currentMatch,
          currentTurn:    action.payload.currentTurn,
          turnStartedAt:  action.payload.turnStartedAt || Date.now(),
          turnDurationMs: action.payload.turnDurationMs || 30000,
          // Chess clocks: update if server sent them
          p1TimeMs:  action.payload.p1TimeMs  ?? state.currentMatch.p1TimeMs,
          p2TimeMs:  action.payload.p2TimeMs  ?? state.currentMatch.p2TimeMs,
        },
      };

    case 'MOVE_MADE':
      if (!state.currentMatch || state.currentMatch.matchId !== action.payload.matchId) return state;
      return {
        ...state,
        currentMatch: {
          ...state.currentMatch,
          board:         action.payload.board,
          currentTurn:   action.payload.currentTurn,
          turnStartedAt: Date.now(),
          // Chess clocks: update if server sent them
          p1TimeMs:  action.payload.p1TimeMs  ?? state.currentMatch.p1TimeMs,
          p2TimeMs:  action.payload.p2TimeMs  ?? state.currentMatch.p2TimeMs,
        },
      };

    case 'GAME_OVER':
      return {
        ...state,
        gameResult: action.payload,
        currentMatch: state.currentMatch ? {
          ...state.currentMatch,
          board:        action.payload.board || state.currentMatch.board,
          winningCells: action.payload.winningCells || null,
        } : state.currentMatch,
        playerStatus: 'result',
      };

    case 'REACTION_RECEIVED':
      return {
        ...state,
        incomingReaction: { ...action.payload, ts: Date.now() },
      };

    case 'OPPONENT_RECONNECTING':
      return { ...state, opponentReconnecting: true };

    case 'OPPONENT_RECONNECTED':
      return { ...state, opponentReconnecting: false };

    case 'TOURNAMENT_ENDED':
      return {
        ...state,
        tournamentState: state.tournamentState
          ? { ...state.tournamentState, status: 'finished', leaderboard: action.payload.leaderboard || state.tournamentState.leaderboard }
          : state.tournamentState,
        // If player is mid-game, the game_over will arrive separately — just mark lobby
        currentMatch:  null,
        gameResult:    null,
        playerStatus:  state.role === 'player' ? 'waiting' : state.playerStatus,
        showCountdown: false,
      };

    case 'RETURN_TO_LOBBY':
      return {
        ...state,
        currentMatch:          null,
        gameResult:            null,
        playerStatus:          'waiting',
        showCountdown:         false,
        incomingReaction:      null,
        opponentReconnecting:  false,
      };

    case 'RESET':
      return { ...initialState };

    default:
      return state;
  }
}

// Phiên của học sinh chỉ nằm trong React state, nên tải lại trang là mất sạch
// role/roomCode và các em bị đẩy về màn nhập mã phòng ("tự out ra"). Ghi lại mã
// phòng để vào lại được ngay.
const SESSION_KEY = 'caro_player_session';

function savePlayerSession(roomCode, nickname) {
  try { localStorage.setItem(SESSION_KEY, JSON.stringify({ roomCode, nickname })); } catch { /* private mode */ }
}
function loadPlayerSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; }
}
function clearPlayerSession() {
  try { localStorage.removeItem(SESSION_KEY); } catch { /* private mode */ }
}

export function GameProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  // Always-current snapshot of state for use inside static socket handlers
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; });

  useEffect(() => {
    socket.on('connect', () => {
      dispatch({ type: 'SET_CONNECTED', payload: true });
      // Reconnect: re-register admin socket ID in the tournament
      const { role, roomCode } = stateRef.current;
      if (role === 'admin' && roomCode) {
        const token = localStorage.getItem('caro_admin_token');
        if (token) socket.emit('admin_rejoin', { roomCode, token }, () => {});
        return;
      }
      // Học sinh tải lại trang: tự vào lại đúng phòng cũ.
      if (!role) {
        const saved = loadPlayerSession();
        if (saved?.roomCode) {
          socket.emit('join_room', { roomCode: saved.roomCode, nickname: saved.nickname }, (res) => {
            if (res?.success) {
              dispatch({ type: 'PLAYER_JOINED', payload: { ...res, nickname: saved.nickname } });
              return;
            }
            // Chỉ quên phòng khi phòng thật sự không còn. Lỗi tạm thời (phiên
            // Supabase chưa kịp khôi phục, mất mạng) mà xoá phiên thì học sinh
            // mất luôn đường tự vào lại — cứ để lần tải trang sau thử tiếp.
            const msg = res?.message || '';
            if (/không tồn tại|đã kết thúc|không thuộc/i.test(msg)) clearPlayerSession();
          });
        }
      }
    });
    socket.on('disconnect', () => dispatch({ type: 'SET_CONNECTED', payload: false }));

    socket.on('room_state_update', (data) => dispatch({ type: 'ROOM_STATE_UPDATE', payload: data }));

    socket.on('tournament_started', () => {
      sounds.tournamentStart();
    });

    socket.on('match_found', (data) => {
      sounds.matchFound();
      dispatch({ type: 'MATCH_FOUND', payload: data });
    });

    socket.on('move_made', (data) => {
      // Play move sound for both board (row/col) and chess (move object) moves
      if (data.row !== null || data.move) sounds.place();
      dispatch({ type: 'MOVE_MADE', payload: data });
    });

    socket.on('turn_start', (data) => {
      dispatch({ type: 'TURN_START', payload: data });
    });

    socket.on('game_over', (data) => {
      dispatch({ type: 'GAME_OVER', payload: data });
    });

    socket.on('reaction_received', (data) => {
      dispatch({ type: 'REACTION_RECEIVED', payload: data });
    });

    socket.on('tournament_ended', (data) => {
      dispatch({ type: 'TOURNAMENT_ENDED', payload: data });
    });

    socket.on('opponent_reconnecting', () => {
      dispatch({ type: 'OPPONENT_RECONNECTING' });
    });

    socket.on('opponent_reconnected', () => {
      dispatch({ type: 'OPPONENT_RECONNECTED' });
    });

    socket.connect();

    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('room_state_update');
      socket.off('tournament_started');
      socket.off('match_found');
      socket.off('turn_start');
      socket.off('move_made');
      socket.off('game_over');
      socket.off('reaction_received');
      socket.off('tournament_ended');
      socket.off('opponent_reconnecting');
      socket.off('opponent_reconnected');
    };
  }, []);

  const createTournament = useCallback((token, name, gameType, chessOpts, callback) => {
    // chessOpts: { chessInitialMs, chessIncMs } — optional, only for chess
    if (typeof chessOpts === 'function') { callback = chessOpts; chessOpts = {}; }
    if (token) socket.auth = { token };
    socket.emit('create_tournament', { token, name, gameType, ...chessOpts }, (res) => {
      if (res.success) dispatch({ type: 'ADMIN_CREATED', payload: res });
      callback?.(res);
    });
  }, []);

  const joinRoom = useCallback((roomCode, nickname, supabaseToken, callback) => {
    // supabaseToken is optional — backward-compat: if called with 3 args and 3rd is a function
    if (typeof supabaseToken === 'function') { callback = supabaseToken; supabaseToken = null; }
    socket.emit('join_room', { roomCode, nickname, supabaseToken }, (res) => {
      if (res.success) {
        savePlayerSession(roomCode, nickname);
        dispatch({ type: 'PLAYER_JOINED', payload: { ...res, nickname } });
      } else {
        dispatch({ type: 'SET_ERROR', payload: res.message });
      }
      callback?.(res);
    });
  }, []);

  // Cần thiết vì client tự vào lại phòng đã lưu: không có đường rời phòng thì
  // học sinh bị nhốt trong phòng cũ, không sang phòng khác được.
  const leaveRoom = useCallback(() => {
    clearPlayerSession();
    dispatch({ type: 'RESET' });
  }, []);

  const startTournament = useCallback((roomCode, callback) => {
    socket.emit('start_tournament', { roomCode }, callback);
  }, []);

  const endTournament = useCallback((roomCode, callback) => {
    socket.emit('end_tournament', { roomCode }, (res) => {
      callback?.(res);
    });
  }, []);

  const makeMove = useCallback((matchId, row, col, move, callback) => {
    socket.emit('make_move', { matchId, row, col, move }, callback);
  }, []);

  const sendReaction = useCallback((emoji) => {
    if (state.currentMatch?.matchId) {
      socket.emit('send_reaction', { matchId: state.currentMatch.matchId, emoji });
    }
  }, [state.currentMatch]);

  const requestNextMatch = useCallback(() => {
    if (state.roomCode) {
      socket.emit('request_next_match', { roomCode: state.roomCode });
      dispatch({ type: 'RETURN_TO_LOBBY' });
    }
  }, [state.roomCode]);

  // Return to lobby UI without emitting request_next_match (used for manual-queue mode)
  const returnToLobbyOnly = useCallback(() => {
    dispatch({ type: 'RETURN_TO_LOBBY' });
  }, []);

  const hideCountdown = useCallback(() => {
    dispatch({ type: 'HIDE_COUNTDOWN' });
  }, []);

  const clearError = useCallback(() => dispatch({ type: 'CLEAR_ERROR' }), []);

  return (
    <GameContext.Provider value={{
      ...state,
      createTournament,
      joinRoom,
      leaveRoom,
      startTournament,
      endTournament,
      makeMove,
      sendReaction,
      requestNextMatch,
      returnToLobbyOnly,
      hideCountdown,
      clearError,
      dispatch,
    }}>
      {children}
    </GameContext.Provider>
  );
}

export function useGame() {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error('useGame must be used within GameProvider');
  return ctx;
}
