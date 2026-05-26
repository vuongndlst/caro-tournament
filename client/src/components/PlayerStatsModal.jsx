import React, { useEffect, useState } from 'react';
import { X, Trophy, Sword, Handshake, Skull, TrendingUp, Clock } from 'lucide-react';
import { socket } from '../socket';

const RANK_COLORS = {
  purple: 'text-purple-400 bg-purple-900/30 border-purple-700/40',
  cyan:   'text-cyan-400 bg-cyan-900/30 border-cyan-700/40',
  yellow: 'text-yellow-400 bg-yellow-900/30 border-yellow-700/40',
  slate:  'text-slate-300 bg-slate-700/30 border-slate-600/40',
  orange: 'text-orange-400 bg-orange-900/30 border-orange-700/40',
  amber:  'text-amber-400 bg-amber-900/30 border-amber-700/40',
};

function RankBadge({ rank }) {
  const colorClass = RANK_COLORS[rank?.color] || RANK_COLORS.amber;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold border ${colorClass}`}>
      {rank?.emoji} {rank?.name}
    </span>
  );
}

export default function PlayerStatsModal({ roomCode, playerId, onClose }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    socket.emit('get_player_stats', { roomCode, playerId }, (res) => {
      setLoading(false);
      if (res?.success) setStats(res.stats);
    });
  }, [roomCode, playerId]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-slate-900 border border-slate-700/60 rounded-2xl shadow-2xl w-full max-w-md animate-bounce-in flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 pt-5 pb-4 border-b border-slate-700/60 shrink-0">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center font-black text-white shadow-lg">
            {stats?.nickname?.charAt(0).toUpperCase() || '?'}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-extrabold text-base leading-tight truncate">{stats?.nickname || 'Đang tải...'}</h2>
            {stats && <RankBadge rank={stats.rank} />}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-700/60 transition-colors text-slate-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto flex-1 px-5 py-4">
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <span className="w-8 h-8 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
            </div>
          ) : !stats ? (
            <p className="text-slate-500 text-center py-8">Không tìm thấy thông tin người chơi.</p>
          ) : (
            <div className="space-y-4">
              {/* Score & rank */}
              <div className="bg-indigo-900/30 border border-indigo-700/40 rounded-xl p-4 text-center">
                <p className="text-xs text-indigo-300 mb-1">Tổng điểm</p>
                <p className="text-4xl font-black text-white">{stats.score}<span className="text-xl text-indigo-400">đ</span></p>
                {stats.streak >= 2 && (
                  <p className="text-orange-400 text-sm font-bold mt-1">🔥 {stats.streak} trận thắng liên tiếp</p>
                )}
              </div>

              {/* W/D/L */}
              <div className="grid grid-cols-3 gap-2">
                {[
                  { icon: Trophy,    label: 'Thắng', value: stats.wins,   color: 'green' },
                  { icon: Handshake, label: 'Hoà',   value: stats.draws,  color: 'yellow' },
                  { icon: Skull,     label: 'Thua',  value: stats.losses, color: 'red' },
                ].map(({ icon: Icon, label, value, color }) => (
                  <div key={label} className={`bg-${color}-900/20 border border-${color}-800/30 rounded-xl p-3 text-center`}>
                    <Icon className={`w-4 h-4 text-${color}-400 mx-auto mb-1`} />
                    <p className={`text-xl font-black text-${color}-400`}>{value}</p>
                    <p className="text-xs text-slate-500">{label}</p>
                  </div>
                ))}
              </div>

              {/* Match rate */}
              {(stats.wins + stats.draws + stats.losses) > 0 && (
                <div className="bg-slate-800/60 rounded-xl p-3 flex items-center gap-3">
                  <TrendingUp className="w-4 h-4 text-indigo-400 shrink-0" />
                  <div className="flex-1">
                    <div className="flex justify-between text-xs text-slate-400 mb-1">
                      <span>Tỉ lệ thắng</span>
                      <span className="text-white font-bold">
                        {Math.round((stats.wins / (stats.wins + stats.draws + stats.losses)) * 100)}%
                      </span>
                    </div>
                    <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-indigo-500 to-green-500 rounded-full"
                        style={{ width: `${Math.round((stats.wins / (stats.wins + stats.draws + stats.losses)) * 100)}%` }}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Match history */}
              {stats.matchHistory.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-slate-400 mb-2 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5" /> Lịch sử trận đấu ({stats.matchHistory.length})
                  </h3>
                  <ul className="space-y-1.5 max-h-40 overflow-y-auto">
                    {stats.matchHistory.map((m, i) => (
                      <li key={i} className="flex items-center gap-2 bg-slate-800/50 rounded-lg px-3 py-1.5 text-xs">
                        {m.result === 'win'  && <Trophy    className="w-3.5 h-3.5 text-green-400 shrink-0" />}
                        {m.result === 'draw' && <Handshake className="w-3.5 h-3.5 text-yellow-400 shrink-0" />}
                        {m.result === 'loss' && <Skull     className="w-3.5 h-3.5 text-red-400 shrink-0" />}
                        <span className="text-slate-300 flex-1 truncate">vs {m.opponentNickname}</span>
                        <span className={`font-bold ${m.result === 'win' ? 'text-green-400' : m.result === 'draw' ? 'text-yellow-400' : 'text-red-400'}`}>
                          {m.result === 'win' ? 'Thắng' : m.result === 'draw' ? 'Hoà' : 'Thua'}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
