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

    case 'PLAYER_JOINED':
      return {
        ...state,
        role: 'player',
        playerId: action.payload.playerId,
        nickname: action.payload.nickname,
        roomCode: action.payload.roomCode,
        playerStatus: 'waiting',
        error: null,
      };

    case 'ROOM_STATE_UPDATE':
      return { ...state, tournamentState: action.payload };

    case 'MATCH_FOUND':
      return {
        ...state,
        currentMatch: {
          matchId:          action.payload.matchId,
          gameType:         action.payload.gameType || 'caro',
          opponentNickname: action.payload.opponentNickname,
          opponentId:       action.payload.opponentId,
          yourSymbol:       action.payload.yourSymbol,
          opponentSymbol:   action.payload.opponentSymbol,
          currentTurn:      action.payload.currentTurn,
          board:            action.payload.board,
          size:             action.payload.size,
          turnStartedAt:    action.payload.turnStartedAt || Date.now(),
          turnDurationMs:   action.payload.turnDurationMs || 30000,
        },
        gameResult:       null,
        playerStatus:     'playing',
        showCountdown:    true,
        incomingReaction: null,
      };

    case 'HIDE_COUNTDOWN':
      return { ...state, showCountdown: false };

    case 'TURN_START':
      if (!state.currentMatch || state.currentMatch.matchId !== action.payload.matchId) return state;
      return {
        ...state,
        currentMatch: {
          ...state.currentMatch,
          currentTurn:   action.payload.currentTurn,
          turnStartedAt: action.payload.turnStartedAt || Date.now(),
          turnDurationMs: action.payload.turnDurationMs || 30000,
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
      if (data.row !== null) sounds.place();
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

  const createTournament = useCallback((token, name, gameType, callback) => {
    if (token) socket.auth = { token };
    socket.emit('create_tournament', { token, name, gameType }, (res) => {
      if (res.success) dispatch({ type: 'ADMIN_CREATED', payload: res });
      callback?.(res);
    });
  }, []);

  const joinRoom = useCallback((roomCode, nickname, callback) => {
    socket.emit('join_room', { roomCode, nickname }, (res) => {
      if (res.success) {
        dispatch({ type: 'PLAYER_JOINED', payload: { ...res, nickname } });
      } else {
        dispatch({ type: 'SET_ERROR', payload: res.message });
      }
      callback?.(res);
    });
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
