import { Chess } from 'chess.js';
import { supabase } from './supabase';

export class SupabaseGameSocket {
  constructor() {
    this.connected = !!supabase;
    this.id = null;
    this.auth = {};
    this.listeners = new Map();
    this.tournamentId = null;
    this.roomCode = null;
    this.channel = null;
    this.spectatorChannel = null;
    this.snapshot = { tournamentStatus: null, match: null };
    this.refreshTimer = null;
    this.matchRetryTimer = null;
  }

  on(event, handler) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(handler);
    return this;
  }

  once(event, handler) {
    const wrapped = (...args) => { this.off(event, wrapped); handler(...args); };
    return this.on(event, wrapped);
  }

  off(event, handler) {
    if (!handler) this.listeners.delete(event);
    else this.listeners.get(event)?.delete(handler);
    return this;
  }

  _dispatch(event, payload) {
    for (const handler of this.listeners.get(event) || []) handler(payload);
  }

  async connect() {
    if (!supabase) {
      this.connected = false;
      queueMicrotask(() => this._dispatch('disconnect'));
      return this;
    }
    const { data: { session } } = await supabase.auth.getSession();
    this.id = session?.user?.id || null;
    this.connected = true;
    queueMicrotask(() => this._dispatch('connect'));
    return this;
  }

  async disconnect() {
    if (this.channel) await supabase.removeChannel(this.channel);
    if (this.spectatorChannel) await supabase.removeChannel(this.spectatorChannel);
    this.channel = null;
    this.spectatorChannel = null;
    this.connected = false;
    this._dispatch('disconnect');
  }

  async _invoke(action, payload = {}, attempt = 0) {
    if (!supabase) return { success: false, message: 'Supabase chưa được cấu hình.' };
    const { data: { session } } = await supabase.auth.getSession();
    this.id = session?.user?.id || null;
    if (!session) return { success: false, message: 'Vui lòng đăng nhập trước khi tham gia.' };
    const { data, error } = await supabase.functions.invoke('game-api', {
      body: { action, ...payload },
    });

    // Cả lớp cùng thao tác một lúc thì server có thể trả 5xx hoặc rớt mạng nhất
    // thời. Không thử lại thì học sinh mất nước đi hoặc thấy báo lỗi vô cớ.
    // Server đã chặn nước đi trùng bằng version và lượt nên thử lại là an toàn.
    const status = error?.context?.status;
    if (error && (status === undefined || status >= 500) && attempt < 2) {
      await new Promise(r => setTimeout(r, 300 * (attempt + 1) ** 2));
      return this._invoke(action, payload, attempt + 1);
    }
    if (error) {
      // supabase-js coi mọi mã 4xx/5xx là lỗi và chỉ đưa ra "Edge Function
      // returned a non-2xx status code", nuốt mất thông báo tiếng Việt trong
      // phần thân phản hồi. Đọc lại thân để học sinh thấy đúng lý do.
      let message = error.message || 'Không gọi được game-api.';
      try {
        const body = await error.context?.json?.();
        if (body?.message) message = body.message;
      } catch { /* phản hồi không phải JSON — giữ nguyên thông báo gốc */ }
      return { success: false, message };
    }
    return data || { success: false, message: 'Phản hồi rỗng từ game-api.' };
  }

  async emit(event, payload = {}, callback) {
    if (event === 'stop_spectating') {
      if (this.spectatorChannel) await supabase.removeChannel(this.spectatorChannel);
      this.spectatorChannel = null;
      callback?.({ success: true });
      return this;
    }

    const enrichedPayload = {
      ...payload,
      tournamentId: payload.tournamentId || this.tournamentId || undefined,
      roomCode: payload.roomCode || this.roomCode || undefined,
    };
    const result = await this._invoke(event, enrichedPayload);
    if (result?.success && ['create_tournament', 'join_room', 'admin_rejoin'].includes(event)) {
      this.tournamentId = result.tournamentId || result.state?.tournamentId;
      this.roomCode = result.roomCode || result.state?.roomCode || payload.roomCode;
      if (result.state) this._dispatch('room_state_update', result.state);
      if (this.tournamentId) await this._subscribeTournament();
    }
    if (result?.success && event === 'spectate_match') {
      await this._subscribeSpectator(result.match);
    }
    callback?.(result);
    if (result?.success && ['start_tournament', 'end_tournament', 'make_move', 'request_next_match'].includes(event)) {
      this._scheduleRefresh(0);
    }
    return this;
  }

  async _subscribeTournament() {
    if (!this.tournamentId) return;
    if (this.channel) await supabase.removeChannel(this.channel);
    const tournamentId = this.tournamentId;
    this.channel = supabase.channel(`tournament:${tournamentId}:${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tournaments', filter: `id=eq.${tournamentId}` }, () => this._scheduleRefresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tournament_players', filter: `tournament_id=eq.${tournamentId}` }, () => this._scheduleRefresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches', filter: `tournament_id=eq.${tournamentId}` }, () => this._scheduleRefresh())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'game_events', filter: `tournament_id=eq.${tournamentId}` }, payload => {
        const event = payload.new;
        if (event.event_type === 'reaction' && event.actor_id !== this.id) {
          this._dispatch('reaction_received', { ...event.payload, fromId: event.actor_id, matchId: event.match_id });
        }
      })
      .subscribe();
    this._scheduleRefresh(0);
  }

  _scheduleRefresh(delay = 40) {
    clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => this._refresh(), delay);
  }

  async _refresh() {
    if (!this.tournamentId || !this.roomCode) return;
    const result = await this._invoke('get_state', { tournamentId: this.tournamentId, roomCode: this.roomCode });
    if (!result?.success) return;
    const previous = this.snapshot;
    const currentMatch = result.match;
    this._dispatch('room_state_update', result.state);

    if (previous.tournamentStatus && previous.tournamentStatus !== result.state.status) {
      if (result.state.status === 'active') this._dispatch('tournament_started');
      if (result.state.status === 'finished') this._dispatch('tournament_ended', { leaderboard: result.state.leaderboard });
    }

    if (currentMatch?.status === 'active') {
      clearTimeout(this.matchRetryTimer);
      if (!previous.match || previous.match.matchId !== currentMatch.matchId || previous.match.status !== 'active') {
        this._dispatch('match_found', currentMatch);
      } else if (currentMatch.version !== previous.match.version) {
        let isCheck = false;
        if (currentMatch.gameType === 'chess') {
          try { isCheck = new Chess(currentMatch.board).inCheck(); } catch { /* invalid FEN is handled by API */ }
        }
        this._dispatch('move_made', { ...currentMatch, isCheck });
        this._dispatch('turn_start', currentMatch);
      }
      this._scheduleTimeoutClaim(currentMatch);
    } else if (currentMatch?.status === 'finished' && previous.match?.status === 'active') {
      this._dispatch('game_over', {
        matchId: currentMatch.matchId, winnerId: currentMatch.winnerId,
        winnerSymbol: currentMatch.winnerId === currentMatch.p1Id ? 'X' : currentMatch.winnerId === currentMatch.p2Id ? 'O' : null,
        isDraw: currentMatch.isDraw, board: currentMatch.board,
        winningCells: currentMatch.winningCells,
        timedOut: currentMatch.resultReason === 'timeout',
        eloChange: currentMatch.eloChange,
      });
    }
    const me = result.state.leaderboard?.find(player => player.id === this.id);
    if (result.state.status === 'active' && me?.status === 'waiting' && currentMatch?.status !== 'active') {
      clearTimeout(this.matchRetryTimer);
      this.matchRetryTimer = setTimeout(async () => {
        await this._invoke('request_next_match', { tournamentId: this.tournamentId, roomCode: this.roomCode });
        this._scheduleRefresh(0);
      }, 5_000);
    } else {
      clearTimeout(this.matchRetryTimer);
    }
    this.snapshot = { tournamentStatus: result.state.status, match: currentMatch };
  }

  _scheduleTimeoutClaim(match) {
    clearTimeout(this.timeoutTimer);
    if (!match?.turnStartedAt || !match?.turnDurationMs) return;
    const deadline = match.turnStartedAt + match.turnDurationMs;
    this.timeoutTimer = setTimeout(async () => {
      await this._invoke('claim_timeout', { tournamentId: this.tournamentId, matchId: match.matchId });
      this._scheduleRefresh(0);
    }, Math.max(0, deadline - Date.now()) + 150);
  }

  async _subscribeSpectator(match) {
    if (!match?.matchId || !match?.tournamentId) return;
    if (this.spectatorChannel) await supabase.removeChannel(this.spectatorChannel);
    let previous = match;
    this.spectatorChannel = supabase.channel(`spectate:${match.matchId}:${crypto.randomUUID()}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'matches', filter: `id=eq.${match.matchId}` }, async payload => {
        const row = payload.new;
        const refreshed = await this._invoke('spectate_match', {
          tournamentId: match.tournamentId, roomCode: match.roomCode, matchId: match.matchId,
        });
        if (!refreshed?.success) return;
        const current = refreshed.match;
        if (row.status === 'finished' && previous.status === 'active') this._dispatch('game_over', current);
        else {
          this._dispatch('move_made', current);
          this._dispatch('turn_start', current);
        }
        previous = current;
      })
      .subscribe();
  }
}
