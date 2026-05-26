import React, { useState } from 'react';
import { useGame } from '../context/GameContext';
import { Clock, Users, Trophy, Wifi, WifiOff, Gamepad2, Eye, Flag } from 'lucide-react';
import SpectatorView from './SpectatorView';
import Footer from './Footer';

export default function LobbyView() {
  const { nickname, roomCode, tournamentState, connected } = useGame();
  const leaderboard = tournamentState?.leaderboard || [];
  const status      = tournamentState?.status || 'waiting';
  const players     = tournamentState?.players || [];

  // ── Tournament ended screen ──────────────────────────────────────────────
  if (status === 'finished') {
    const myRankFinal = leaderboard.findIndex(p => p.nickname === nickname) + 1;
    const top3 = leaderboard.slice(0, 3);
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 flex flex-col items-center justify-center p-4 gap-5">
        <div className="card w-full max-w-md text-center animate-bounce-in">
          <div className="w-16 h-16 bg-yellow-500/20 rounded-full flex items-center justify-center mx-auto mb-4 border-2 border-yellow-500/40">
            <Flag className="w-8 h-8 text-yellow-400" />
          </div>
          <h2 className="text-2xl font-extrabold text-yellow-300 mb-1">Giải đấu kết thúc!</h2>
          {myRankFinal > 0 && (
            <p className="text-slate-400 text-sm mb-4">
              Bạn xếp hạng <span className="text-white font-bold">#{myRankFinal}</span>
              {myRankFinal === 1 && ' 🥇 Vô địch!'}
              {myRankFinal === 2 && ' 🥈 Á quân!'}
              {myRankFinal === 3 && ' 🥉 Hạng ba!'}
            </p>
          )}
          <div className="space-y-2">
            {top3.map((p, i) => (
              <div key={p.id} className={`flex items-center gap-3 rounded-xl px-4 py-2.5 ${
                i === 0 ? 'bg-yellow-900/40 border border-yellow-700/40' :
                i === 1 ? 'bg-slate-600/30 border border-slate-600/40' :
                          'bg-amber-900/20 border border-amber-800/30'
              }`}>
                <span className="text-xl">{['🥇','🥈','🥉'][i]}</span>
                <span className={`font-bold flex-1 text-left ${p.nickname === nickname ? 'text-indigo-300' : 'text-white'}`}>
                  {p.nickname}
                </span>
                <span className="text-indigo-300 font-bold">{p.score}đ</span>
                <span className="text-slate-500 text-xs">{p.wins}T·{p.draws}H·{p.losses}B</span>
              </div>
            ))}
          </div>
          {leaderboard.length > 3 && (
            <p className="text-slate-500 text-xs mt-3">+{leaderboard.length - 3} người chơi khác</p>
          )}
        </div>
        <Footer />
      </div>
    );
  }
  const allMatches  = tournamentState?.matches || [];
  const liveMatches = allMatches.filter(m => m.status === 'active');

  const myRank  = leaderboard.findIndex(p => p.nickname === nickname) + 1;
  const myStats = leaderboard.find(p => p.nickname === nickname);

  const [spectating, setSpectating] = useState(null); // { matchId }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 flex flex-col items-center justify-center p-4 gap-4">

      {/* Spectator overlay */}
      {spectating && (
        <SpectatorView
          matchId={spectating.matchId}
          roomCode={roomCode}
          onClose={() => setSpectating(null)}
        />
      )}

      {/* Profile card */}
      <div className="card w-full max-w-md text-center animate-fade-in">
        <div className="w-16 h-16 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center mx-auto mb-3 shadow-lg shadow-indigo-900/50">
          <span className="text-2xl font-extrabold text-white">
            {nickname?.charAt(0).toUpperCase()}
          </span>
        </div>
        <h2 className="text-xl font-bold">{nickname}</h2>

        <div className="flex items-center justify-center gap-2 mt-1 mb-3 flex-wrap">
          <span className="badge bg-indigo-900/50 text-indigo-300 border border-indigo-700/40 text-xs">
            Phòng: <span className="font-black tracking-widest ml-1">{roomCode}</span>
          </span>
          {myRank > 0 && (
            <span className="badge bg-yellow-900/40 text-yellow-300 border border-yellow-700/30 text-xs">
              #{myRank} BXH
            </span>
          )}
          {myStats?.streak >= 2 && (
            <span className="badge bg-orange-900/40 text-orange-300 border border-orange-700/30 text-xs">
              🔥 {myStats.streak} trận thắng liên tiếp
            </span>
          )}
        </div>

        {/* Stats */}
        {myStats && (
          <div className="grid grid-cols-3 gap-2 mb-4">
            {[
              { label: 'Thắng', value: myStats.wins,   color: 'text-green-400' },
              { label: 'Hoà',   value: myStats.draws,  color: 'text-yellow-400' },
              { label: 'Thua',  value: myStats.losses, color: 'text-red-400' },
            ].map(s => (
              <div key={s.label} className="bg-slate-700/40 rounded-xl py-2">
                <div className={`text-xl font-black ${s.color}`}>{s.value}</div>
                <div className="text-xs text-slate-500">{s.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Status */}
        <div className={`flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl ${
          status === 'waiting' ? 'bg-amber-900/30 border border-amber-700/30' : 'bg-green-900/30 border border-green-700/30'
        }`}>
          {status === 'waiting' ? (
            <>
              <Clock className="w-4 h-4 text-amber-400 shrink-0" style={{ animation: 'spin 4s linear infinite' }} />
              <p className="text-amber-300 font-medium text-sm">Chờ giáo viên bắt đầu giải đấu...</p>
            </>
          ) : (
            <>
              <Gamepad2 className="w-4 h-4 text-green-400 shrink-0" />
              <p className="text-green-300 font-medium text-sm">Đang chờ ghép trận...</p>
            </>
          )}
        </div>

        <div className="flex items-center justify-center gap-1.5 mt-3 text-xs text-slate-500">
          {connected
            ? <><Wifi className="w-3 h-3 text-green-400" /> Kết nối ổn định</>
            : <><WifiOff className="w-3 h-3 text-red-400" /> Mất kết nối — đang thử lại...</>}
        </div>
      </div>

      {/* Live matches to spectate */}
      {liveMatches.length > 0 && (
        <div className="card w-full max-w-md animate-fade-in">
          <div className="flex items-center gap-2 mb-3">
            <Eye className="w-4 h-4 text-purple-400 shrink-0" />
            <h3 className="font-semibold text-sm">Trận đang diễn ra</h3>
            <span className="ml-auto badge bg-purple-900/40 text-purple-300 text-xs">{liveMatches.length}</span>
          </div>
          <ul className="space-y-2">
            {liveMatches.map(m => (
              <li key={m.id} className="flex items-center gap-2 bg-slate-700/30 rounded-xl px-3 py-2">
                <span className="text-blue-300 font-medium text-xs truncate flex-1">{m.p1Nickname}</span>
                <span className="text-slate-500 text-[10px] font-black shrink-0">VS</span>
                <span className="text-red-300 font-medium text-xs truncate flex-1 text-right">{m.p2Nickname}</span>
                <button
                  onClick={() => setSpectating({ matchId: m.id })}
                  className="shrink-0 flex items-center gap-1 text-xs text-purple-400 hover:text-purple-300 bg-purple-900/30 hover:bg-purple-900/50 border border-purple-700/30 rounded-lg px-2 py-1 transition-colors"
                >
                  <Eye className="w-3 h-3" /> Xem
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Players + Leaderboard */}
      <div className="w-full max-w-md grid grid-cols-2 gap-3">
        <div className="card">
          <div className="flex items-center gap-2 mb-3">
            <Users className="w-4 h-4 text-blue-400 shrink-0" />
            <h3 className="font-semibold text-sm">Người chơi</h3>
            <span className="ml-auto badge bg-blue-900/40 text-blue-300 text-xs">{players.length}</span>
          </div>
          <ul className="space-y-1.5 max-h-52 overflow-y-auto">
            {players.length === 0
              ? <p className="text-slate-600 text-xs text-center py-4">Chưa có ai</p>
              : players.map(p => (
                <li key={p.id} className="flex items-center gap-2 text-sm">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${p.status === 'playing' ? 'bg-amber-400 animate-pulse' : 'bg-green-400'}`} />
                  <span className={`truncate ${p.nickname === nickname ? 'text-indigo-300 font-semibold' : 'text-slate-300'}`}>
                    {p.nickname}{p.nickname === nickname && <span className="text-slate-500 text-xs"> (bạn)</span>}
                  </span>
                </li>
              ))}
          </ul>
        </div>

        <div className="card">
          <div className="flex items-center gap-2 mb-3">
            <Trophy className="w-4 h-4 text-yellow-400 shrink-0" />
            <h3 className="font-semibold text-sm">Xếp hạng</h3>
          </div>
          <ul className="space-y-1.5 max-h-52 overflow-y-auto">
            {leaderboard.length === 0
              ? <p className="text-slate-600 text-xs text-center py-4">Chưa có kết quả</p>
              : leaderboard.map((p, i) => (
                <li key={p.id} className="flex items-center gap-1.5 text-xs">
                  <span className="text-slate-500 w-4 shrink-0">{i < 3 ? ['🥇','🥈','🥉'][i] : `${i+1}.`}</span>
                  <span className={`truncate flex-1 ${p.nickname === nickname ? 'text-indigo-300 font-semibold' : 'text-slate-300'}`}>
                    {p.nickname}
                  </span>
                  {p.streak >= 3 && <span className="text-orange-400 text-[10px] shrink-0">🔥</span>}
                  <span className="font-bold text-indigo-300 shrink-0">{p.score}đ</span>
                </li>
              ))}
          </ul>
        </div>
      </div>

      {/* Waiting animation */}
      <div className="flex gap-1.5">
        {[0,1,2,3,4].map(i => (
          <div key={i} className="w-1.5 h-1.5 bg-indigo-500/60 rounded-full animate-bounce"
            style={{ animationDelay: `${i*0.12}s`, animationDuration: '1s' }} />
        ))}
      </div>

      <Footer />
    </div>
  );
}
