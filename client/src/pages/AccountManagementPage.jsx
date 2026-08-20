import React, { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { ArrowLeft, Copy, KeyRound, LockKeyhole, RefreshCw, Shield, UnlockKeyhole, UserPlus, Users, CalendarRange, Trophy } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';

function temporaryPassword(prefix = 'LSTS') {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const token = Array.from(bytes, value => 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'[value % 57]).join('');
  return `${prefix}-${token}@9a`;
}

async function invoke(action, payload = {}) {
  const { data, error } = await supabase.functions.invoke('game-api', { body: { action, ...payload } });
  if (error || !data?.success) throw error || new Error(data?.message || 'Thao tác thất bại.');
  return data;
}

export default function AccountManagementPage() {
  const { profile } = useAuth();
  const [tab, setTab] = useState('accounts');
  const [accounts, setAccounts] = useState([]);
  const [seasons, setSeasons] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [selectedSeason, setSelectedSeason] = useState('');
  const [gameType, setGameType] = useState('caro');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [credential, setCredential] = useState(null);
  const [newAccount, setNewAccount] = useState({ email: '', nickname: '', role: 'student', temporaryPassword: temporaryPassword() });
  const [newSeason, setNewSeason] = useState({ name: 'Học kỳ 2 · 2026-2027', schoolYear: '2026-2027', semester: '2' });

  async function loadAccounts() {
    setLoading(true); setError('');
    try { setAccounts((await invoke('admin_list_accounts')).accounts || []); }
    catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }

  async function loadSeasons(seasonId = selectedSeason, type = gameType) {
    setLoading(true); setError('');
    try {
      const data = await invoke('get_seasons', { seasonId: seasonId || undefined, gameType: type });
      setSeasons(data.seasons || []);
      const chosen = seasonId || data.seasons?.[0]?.id || '';
      setSelectedSeason(chosen);
      if (!seasonId && chosen) {
        const refreshed = await invoke('get_seasons', { seasonId: chosen, gameType: type });
        setLeaderboard(refreshed.leaderboard || []);
      } else setLeaderboard(data.leaderboard || []);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }

  useEffect(() => { if (profile?.role === 'admin') loadAccounts(); }, [profile?.role]);

  if (profile?.role !== 'admin') return <Navigate to="/admin" replace />;

  async function createAccount(event) {
    event.preventDefault(); setError(''); setBusyId('create'); setCredential(null);
    try {
      await invoke('admin_create_account', newAccount);
      setCredential({ email: newAccount.email, password: newAccount.temporaryPassword, label: 'Tài khoản mới' });
      setNewAccount({ email: '', nickname: '', role: 'student', temporaryPassword: temporaryPassword() });
      await loadAccounts();
    } catch (err) { setError(err.message); }
    finally { setBusyId(''); }
  }

  async function resetPassword(account) {
    if (!window.confirm(`Tạo mật khẩu tạm mới cho ${account.nickname}?`)) return;
    const password = temporaryPassword(account.role === 'teacher' ? 'GV' : 'HS');
    setBusyId(account.id); setError(''); setCredential(null);
    try {
      await invoke('admin_reset_password', { userId: account.id, temporaryPassword: password });
      setCredential({ email: account.email, password, label: 'Mật khẩu vừa reset' });
      await loadAccounts();
    } catch (err) { setError(err.message); }
    finally { setBusyId(''); }
  }

  async function toggleLock(account) {
    const locked = !account.is_locked;
    if (!window.confirm(`${locked ? 'Khóa' : 'Mở khóa'} tài khoản ${account.nickname}?`)) return;
    setBusyId(account.id); setError('');
    try { await invoke('admin_set_lock', { userId: account.id, locked }); await loadAccounts(); }
    catch (err) { setError(err.message); }
    finally { setBusyId(''); }
  }

  async function createSeason(event) {
    event.preventDefault(); setBusyId('season'); setError('');
    try { await invoke('admin_create_season', newSeason); await loadSeasons('', gameType); }
    catch (err) { setError(err.message); }
    finally { setBusyId(''); }
  }

  async function copyCredential() {
    if (!credential) return;
    await navigator.clipboard.writeText(`Email: ${credential.email}\nMật khẩu tạm: ${credential.password}`);
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-900 p-4 sm:p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-indigo-600 flex items-center justify-center"><Shield className="w-6 h-6" /></div>
            <div><h1 className="text-xl font-extrabold">Quản trị hệ thống</h1><p className="text-xs text-slate-400">Tài khoản, bảo mật và mùa giải</p></div>
          </div>
          <Link to="/admin" className="text-sm text-slate-400 hover:text-white flex items-center gap-1"><ArrowLeft className="w-4 h-4" /> Quay lại giải đấu</Link>
        </div>

        <div className="flex gap-2 mb-5">
          <button onClick={() => { setTab('accounts'); loadAccounts(); }} className={`px-4 py-2 rounded-xl text-sm font-semibold flex items-center gap-2 ${tab === 'accounts' ? 'bg-indigo-600' : 'bg-slate-800 text-slate-400'}`}><Users className="w-4 h-4" /> Tài khoản</button>
          <button onClick={() => { setTab('seasons'); loadSeasons(); }} className={`px-4 py-2 rounded-xl text-sm font-semibold flex items-center gap-2 ${tab === 'seasons' ? 'bg-indigo-600' : 'bg-slate-800 text-slate-400'}`}><CalendarRange className="w-4 h-4" /> Mùa giải & ELO</button>
        </div>

        {error && <div className="mb-4 rounded-xl bg-red-900/30 border border-red-700/40 px-4 py-3 text-sm text-red-300">{error}</div>}
        {credential && (
          <div className="mb-4 rounded-xl bg-amber-900/30 border border-amber-600/40 p-4 flex flex-wrap items-center justify-between gap-3">
            <div><p className="text-xs text-amber-300 font-semibold">{credential.label} — chỉ hiển thị trong phiên này</p><p className="text-sm mt-1"><code>{credential.email}</code> · <code>{credential.password}</code></p></div>
            <button onClick={copyCredential} className="px-3 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-sm font-semibold flex items-center gap-1"><Copy className="w-4 h-4" /> Sao chép</button>
          </div>
        )}

        {tab === 'accounts' ? (
          <div className="grid lg:grid-cols-[340px_1fr] gap-4">
            <form onSubmit={createAccount} className="card h-fit space-y-3">
              <h2 className="font-bold flex items-center gap-2"><UserPlus className="w-4 h-4 text-indigo-400" /> Tạo tài khoản</h2>
              <input className="input-field" type="email" placeholder="Email" value={newAccount.email} onChange={event => setNewAccount({ ...newAccount, email: event.target.value })} required />
              <input className="input-field" placeholder="Họ tên / biệt danh" maxLength={20} value={newAccount.nickname} onChange={event => setNewAccount({ ...newAccount, nickname: event.target.value })} required />
              <select className="input-field bg-slate-800" value={newAccount.role} onChange={event => setNewAccount({ ...newAccount, role: event.target.value })}><option value="student">Học sinh</option><option value="teacher">Giáo viên</option></select>
              <div className="flex gap-2"><input className="input-field font-mono" value={newAccount.temporaryPassword} onChange={event => setNewAccount({ ...newAccount, temporaryPassword: event.target.value })} minLength={10} required /><button type="button" onClick={() => setNewAccount({ ...newAccount, temporaryPassword: temporaryPassword() })} className="p-2 rounded-lg bg-slate-700"><RefreshCw className="w-4 h-4" /></button></div>
              <p className="text-xs text-slate-500">Người dùng bắt buộc đổi mật khẩu lần đầu. Giáo viên còn phải thiết lập MFA.</p>
              <button disabled={busyId === 'create'} className="btn-primary w-full">Tạo tài khoản</button>
            </form>

            <div className="card overflow-x-auto">
              <div className="flex items-center justify-between mb-3"><h2 className="font-bold">Danh sách tài khoản</h2><button onClick={loadAccounts} className="text-xs text-indigo-300 flex items-center gap-1"><RefreshCw className="w-3.5 h-3.5" /> Làm mới</button></div>
              {loading ? <div className="py-10 text-center text-slate-500">Đang tải...</div> : (
                <table className="w-full text-sm min-w-[680px]"><thead><tr className="text-left text-xs text-slate-500 border-b border-slate-700"><th className="py-2">Người dùng</th><th>Vai trò</th><th>Bảo mật</th><th>Trạng thái</th><th className="text-right">Thao tác</th></tr></thead>
                  <tbody>{accounts.map(account => <tr key={account.id} className="border-b border-slate-800"><td className="py-3"><p className="font-semibold">{account.nickname}</p><p className="text-xs text-slate-500">{account.email}</p></td><td><span className="badge bg-slate-700">{account.role}</span></td><td className="text-xs"><p className={account.must_change_password ? 'text-amber-300' : 'text-emerald-300'}>{account.must_change_password ? 'Chờ đổi mật khẩu' : 'Mật khẩu đã đổi'}</p>{account.mfa_required && <p className={account.mfaEnabled ? 'text-emerald-300' : 'text-amber-300'}>MFA: {account.mfaEnabled ? 'đã bật' : 'chưa bật'}</p>}</td><td><span className={account.is_locked ? 'text-red-300' : 'text-emerald-300'}>{account.is_locked ? 'Đã khóa' : 'Hoạt động'}</span></td><td><div className="flex justify-end gap-2"><button disabled={busyId === account.id || account.id === profile.id} onClick={() => resetPassword(account)} title="Reset mật khẩu" className="p-2 rounded-lg bg-slate-700 hover:bg-indigo-700 disabled:opacity-30"><KeyRound className="w-4 h-4" /></button>{account.role === 'student' && <button disabled={busyId === account.id} onClick={() => toggleLock(account)} title={account.is_locked ? 'Mở khóa' : 'Khóa'} className={`p-2 rounded-lg ${account.is_locked ? 'bg-emerald-800' : 'bg-red-900/70'}`}>{account.is_locked ? <UnlockKeyhole className="w-4 h-4" /> : <LockKeyhole className="w-4 h-4" />}</button>}</div></td></tr>)}</tbody></table>
              )}
            </div>
          </div>
        ) : (
          <div className="grid lg:grid-cols-[340px_1fr] gap-4">
            <form onSubmit={createSeason} className="card h-fit space-y-3"><h2 className="font-bold flex items-center gap-2"><CalendarRange className="w-4 h-4 text-indigo-400" /> Mở học kỳ mới</h2><input className="input-field" placeholder="Tên mùa giải" value={newSeason.name} onChange={event => setNewSeason({ ...newSeason, name: event.target.value })} required /><input className="input-field" pattern="[0-9]{4}-[0-9]{4}" value={newSeason.schoolYear} onChange={event => setNewSeason({ ...newSeason, schoolYear: event.target.value })} required /><select className="input-field bg-slate-800" value={newSeason.semester} onChange={event => setNewSeason({ ...newSeason, semester: event.target.value })}><option value="1">Học kỳ 1</option><option value="2">Học kỳ 2</option><option value="summer">Hè</option></select><p className="text-xs text-slate-500">Mùa hiện tại sẽ được lưu trữ. ELO mùa mới bắt đầu ở 1200; ELO toàn thời gian vẫn được giữ.</p><button disabled={busyId === 'season'} className="btn-primary w-full">Kích hoạt mùa mới</button></form>
            <div className="card"><div className="flex flex-wrap gap-2 justify-between mb-4"><div><h2 className="font-bold flex items-center gap-2"><Trophy className="w-4 h-4 text-amber-400" /> Bảng ELO học kỳ</h2><p className="text-xs text-slate-500">5 trận đầu là định hạng, trận 6–10 là provisional</p></div><div className="flex gap-2"><select className="input-field py-1.5 text-xs bg-slate-800" value={selectedSeason} onChange={event => { setSelectedSeason(event.target.value); loadSeasons(event.target.value, gameType); }}>{seasons.map(season => <option key={season.id} value={season.id}>{season.name}{season.status === 'active' ? ' · đang chạy' : ''}</option>)}</select><select className="input-field py-1.5 text-xs bg-slate-800" value={gameType} onChange={event => { setGameType(event.target.value); loadSeasons(selectedSeason, event.target.value); }}><option value="caro">Caro</option><option value="tictactoe">Tic Tac Toe</option><option value="chess">Cờ vua</option></select></div></div>{loading ? <p className="py-10 text-center text-slate-500">Đang tải...</p> : leaderboard.length === 0 ? <p className="py-10 text-center text-slate-500">Chưa có trận xếp hạng trong mùa này.</p> : <div className="space-y-2">{leaderboard.map((row, index) => <div key={`${row.user_id}-${row.game_type}`} className="flex items-center gap-3 p-3 rounded-xl bg-slate-800/60"><span className="w-7 text-center font-bold text-slate-500">#{index + 1}</span><div className="flex-1"><p className="font-semibold">{row.nickname}</p><p className="text-xs text-slate-500">{row.wins} thắng · {row.draws} hòa · {row.losses} thua</p></div><div className="text-right"><p className="font-black text-indigo-300">{row.elo}</p><p className="text-[10px] text-slate-500">{row.is_placement ? `${row.rated_games}/5 định hạng` : `${row.rated_games} trận`}</p></div></div>)}</div>}</div>
          </div>
        )}
      </div>
    </div>
  );
}
