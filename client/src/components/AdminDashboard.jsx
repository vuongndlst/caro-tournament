import React, { useState } from 'react';
import { useGame } from '../context/GameContext';
import {
  Users, Swords, Trophy, Play, Copy, CheckCheck,
  Wifi, WifiOff, Crown, Circle, Shield, QrCode, X
} from 'lucide-react';

export default function AdminDashboard() {
  const { roomCode, tournamentState, startTournament, connected } = useGame();
  const [copied, setCopied]     = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState('');
  const [showQR, setShowQR]     = useState(false);

  // Build the join URL for the QR code
  const joinUrl = `${window.location.origin}/?room=${roomCode}`;

  const copyCode = () => {
    navigator.clipboard.writeText(roomCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleStart = () => {
    setStarting(true); setStartError('');
    startTournament(roomCode, (res) => {
      setStarting(false);
      if (!res?.success) setStartError(res?.message || 'Không thể bắt đầu!');
    });
  };

  const status      = tournamentState?.status || 'waiting';
  const players     = tournamentState?.players || [];
  const leaderboard = tournamentState?.leaderboard || [];
  const liveMatches = (tournamentState?.matches || []).filter(m => m.status === 'active');
  const doneMatches = (tournamentState?.matches || []).filter(m => m.status === 'finished');
  const waitingCount = players.filter(p => p.status === 'waiting').length;
  const playingCount = players.filter(p => p.status === 'playing').length;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-900 to-indigo-950 p-4 lg:p-6">
      <div className="max-w-6xl mx-auto space-y-4 animate-fade-in">

        {/* Header bar */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-900/50">
              <Shield className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-extrabold leading-tight">CaroTourney</h1>
              <p className="text-xs text-slate-400">Bảng điều khiển giáo viên</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`badge text-xs px-3 py-1 ${connected ? 'bg-green-900/60 text-green-300 border border-green-700/40' : 'bg-red-900/60 text-red-300 border border-red-700/40'}`}>
              {connected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
              {connected ? 'Kết nối' : 'Mất kết nối'}
            </span>
            {status === 'active' && (
              <span className="badge bg-emerald-900/60 text-emerald-300 border border-emerald-700/40 text-xs px-3 py-1">
                <Circle className="w-2 h-2 fill-current animate-pulse" />
                Đang diễn ra
              </span>
            )}
          </div>
        </div>

        {/* Room code + stats */}
        <div className="card bg-gradient-to-r from-indigo-900/50 to-purple-900/30 border-indigo-700/50">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <p className="text-xs text-indigo-300 font-semibold uppercase tracking-wider mb-1.5">
                Mã phòng — chia sẻ cho học sinh
              </p>
              <div className="flex items-center gap-3">
                <span className="text-5xl font-black tracking-[0.18em] text-white drop-shadow-lg">{roomCode}</span>
                <button onClick={copyCode} className="p-2.5 rounded-xl bg-indigo-700/40 hover:bg-indigo-600/50 transition-colors border border-indigo-600/40"
                  title="Sao chép">
                  {copied ? <CheckCheck className="w-5 h-5 text-green-400" /> : <Copy className="w-5 h-5 text-indigo-300" />}
                </button>
                <button onClick={() => setShowQR(v => !v)} className="p-2.5 rounded-xl bg-purple-700/40 hover:bg-purple-600/50 transition-colors border border-purple-600/40"
                  title="Hiện QR Code">
                  <QrCode className="w-5 h-5 text-purple-300" />
                </button>
              </div>

              {/* QR Code panel */}
              {showQR && (
                <div className="mt-3 flex items-start gap-3 p-3 bg-white rounded-xl w-fit animate-fade-in">
                  <img
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(joinUrl)}&bgcolor=ffffff&color=1e293b&margin=6`}
                    alt="QR Code"
                    className="w-[120px] h-[120px] rounded-lg"
                  />
                  <div className="flex flex-col justify-center gap-1 pr-1">
                    <p className="text-slate-700 text-xs font-semibold">Quét để tham gia</p>
                    <p className="text-slate-500 text-[10px] break-all max-w-[120px]">{joinUrl}</p>
                    <button onClick={() => setShowQR(false)} className="mt-1 text-[10px] text-slate-400 hover:text-slate-600 flex items-center gap-0.5">
                      <X className="w-3 h-3" /> Đóng
                    </button>
                  </div>
                </div>
              )}
              <div className="flex gap-4 mt-2 text-xs text-slate-400">
                <span><span className="text-white font-semibold">{players.length}</span> người tham gia</span>
                {status === 'active' && (
                  <>
                    <span><span className="text-amber-300 font-semibold">{playingCount}</span> đang đấu</span>
                    <span><span className="text-slate-300 font-semibold">{waitingCount}</span> chờ</span>
                    <span><span className="text-slate-500 font-semibold">{doneMatches.length}</span> trận xong</span>
                  </>
                )}
              </div>
            </div>

            <div className="shrink-0">
              {status === 'waiting' ? (
                <div className="text-right">
                  {startError && <p className="text-red-400 text-xs mb-2 text-left">{startError}</p>}
                  <button onClick={handleStart} disabled={starting || players.length < 2} className="btn-primary flex items-center gap-2">
                    {starting ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Play className="w-5 h-5" />}
                    Bắt đầu giải đấu
                  </button>
                  {players.length < 2 && <p className="text-slate-500 text-xs mt-1.5 text-center">Cần ít nhất 2 người</p>}
                </div>
              ) : (
                <div className="text-right space-y-2">
                  <div className="text-xs text-slate-400">
                    Còn lại: <span className="text-white font-bold">{waitingCount}</span> người chờ ghép trận
                  </div>
                  {waitingCount >= 2 && (
                    <button onClick={() => startTournament(roomCode, () => {})}
                      className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors">
                      Ghép trận ngay →
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 3-column grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

          {/* Waiting Room */}
          <div className="card">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center">
                <Users className="w-4 h-4 text-blue-400" />
              </div>
              <div>
                <h2 className="font-bold text-sm">Phòng chờ</h2>
                <p className="text-xs text-slate-500">Danh sách tham gia</p>
              </div>
              <span className="ml-auto badge bg-blue-900/50 text-blue-300 border border-blue-700/30">{players.length}</span>
            </div>

            {players.length === 0 ? (
              <div className="py-8 text-center">
                <p className="text-slate-500 text-sm">Chưa có học sinh tham gia...</p>
                <p className="text-slate-600 text-xs mt-1">Chia sẻ mã phòng để bắt đầu</p>
              </div>
            ) : (
              <ul className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
                {players.map((p, i) => (
                  <li key={p.id} className="flex items-center gap-2.5 rounded-xl px-3 py-2 bg-slate-700/30 hover:bg-slate-700/50 transition-colors">
                    <span className="text-slate-500 text-xs w-5 shrink-0 text-center">{i + 1}</span>
                    <div className={`w-2 h-2 rounded-full shrink-0 ${p.status === 'playing' ? 'bg-amber-400 animate-pulse' : 'bg-green-400'}`} />
                    <span className="font-medium text-sm truncate flex-1">{p.nickname}</span>
                    <span className={`badge text-xs ${p.status === 'playing' ? 'bg-amber-900/40 text-amber-300' : 'bg-slate-600/50 text-slate-400'}`}>
                      {p.status === 'playing' ? 'Đấu' : 'Chờ'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Live Matches */}
          <div className="card">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="w-8 h-8 rounded-lg bg-amber-500/20 flex items-center justify-center">
                <Swords className="w-4 h-4 text-amber-400" />
              </div>
              <div>
                <h2 className="font-bold text-sm">Trận đang diễn ra</h2>
                <p className="text-xs text-slate-500">{doneMatches.length} trận đã hoàn thành</p>
              </div>
              <span className="ml-auto badge bg-amber-900/50 text-amber-300 border border-amber-700/30 animate-pulse">{liveMatches.length}</span>
            </div>

            {liveMatches.length === 0 ? (
              <div className="py-8 text-center">
                <p className="text-slate-500 text-sm">
                  {status === 'waiting' ? 'Giải đấu chưa bắt đầu' : 'Không có trận đấu đang diễn ra'}
                </p>
              </div>
            ) : (
              <ul className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {liveMatches.map((m) => (
                  <li key={m.id} className="bg-amber-950/40 border border-amber-800/30 rounded-xl px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="text-blue-300 font-semibold text-sm truncate flex-1">{m.p1Nickname}</span>
                      <span className="text-slate-500 text-xs font-black shrink-0">VS</span>
                      <span className="text-red-300 font-semibold text-sm truncate flex-1 text-right">{m.p2Nickname}</span>
                    </div>
                    <div className="flex items-center gap-1.5 mt-1">
                      <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
                      <span className="text-xs text-slate-500">Đang chơi...</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {/* Recent finished */}
            {doneMatches.length > 0 && (
              <div className="mt-3 pt-3 border-t border-slate-700/60">
                <p className="text-xs text-slate-500 mb-2">Kết quả gần nhất</p>
                <ul className="space-y-1">
                  {doneMatches.slice(-3).reverse().map(m => (
                    <li key={m.id} className="flex items-center gap-2 text-xs text-slate-400">
                      <span className="truncate flex-1">{m.p1Nickname}</span>
                      <span className={`font-bold shrink-0 ${m.winner === m.p1Id ? 'text-green-400' : m.winner === m.p2Id ? 'text-red-400' : 'text-yellow-400'}`}>
                        {m.winner === m.p1Id ? '>' : m.winner === m.p2Id ? '<' : '='}
                      </span>
                      <span className="truncate flex-1 text-right">{m.p2Nickname}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Leaderboard */}
          <div className="card">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="w-8 h-8 rounded-lg bg-yellow-500/20 flex items-center justify-center">
                <Trophy className="w-4 h-4 text-yellow-400" />
              </div>
              <div>
                <h2 className="font-bold text-sm">Bảng xếp hạng</h2>
                <p className="text-xs text-slate-500">Cập nhật real-time</p>
              </div>
            </div>

            {leaderboard.length === 0 ? (
              <div className="py-8 text-center">
                <p className="text-slate-500 text-sm">Chưa có dữ liệu xếp hạng</p>
              </div>
            ) : (
              <ul className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
                {leaderboard.map((p, i) => (
                  <li key={p.id} className={`flex items-center gap-2 rounded-xl px-3 py-2 ${
                    i === 0 ? 'bg-yellow-900/30 border border-yellow-700/30' :
                    i === 1 ? 'bg-slate-600/20 border border-slate-600/30' :
                    i === 2 ? 'bg-amber-900/20 border border-amber-800/20' :
                    'bg-slate-700/20'
                  }`}>
                    <div className="w-6 text-center shrink-0">
                      {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : <span className="text-slate-500 text-xs">{i+1}</span>}
                    </div>
                    {i === 0 && <Crown className="w-3 h-3 text-yellow-400 shrink-0" />}
                    <span className="font-medium text-sm truncate flex-1">
                      {p.nickname}
                      {p.streak >= 2 && <span className="ml-1 text-orange-400 text-xs">🔥{p.streak}</span>}
                    </span>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-bold text-indigo-300">{p.score}<span className="text-xs font-normal text-slate-500">đ</span></div>
                      <div className="text-xs text-slate-500">{p.wins}T·{p.draws}H·{p.losses}B</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-3 pt-3 border-t border-slate-700/60 flex justify-around text-xs text-slate-500">
              <span>🏆 Thắng = 3đ</span>
              <span>🤝 Hoà = 1đ</span>
              <span>💀 Thua = 0đ</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
