import React, { useState } from 'react';
import { useGame } from '../context/GameContext';
import AdminDashboard from '../components/AdminDashboard';
import { Shield, Plus, ArrowLeft } from 'lucide-react';

export default function AdminPage() {
  const { role, createTournament, connected, roomCode } = useGame();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleCreate = () => {
    setLoading(true);
    setError('');
    createTournament((res) => {
      setLoading(false);
      if (!res.success) setError('Không thể tạo giải đấu, thử lại!');
    });
  };

  // Already created a tournament — show dashboard
  if (role === 'admin' && roomCode) return <AdminDashboard />;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 p-4">
      <div className="card w-full max-w-sm text-center animate-fade-in">
        {/* Icon */}
        <div className="w-16 h-16 bg-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-indigo-900/60">
          <Shield className="w-9 h-9 text-white" />
        </div>

        <h1 className="text-2xl font-extrabold mb-1">Bảng điều khiển</h1>
        <p className="text-slate-400 text-sm mb-6">Tạo một giải đấu mới cho lớp học của bạn</p>

        {error && (
          <p className="text-red-400 text-sm mb-4 bg-red-900/30 rounded-lg px-3 py-2">{error}</p>
        )}

        <button
          onClick={handleCreate}
          disabled={loading || !connected}
          className="btn-primary w-full flex items-center justify-center gap-2"
        >
          {loading ? (
            <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            <Plus className="w-5 h-5" />
          )}
          {loading ? 'Đang tạo...' : 'Tạo giải đấu mới'}
        </button>

        {!connected && (
          <p className="text-xs text-slate-500 mt-3">
            <span className="w-2 h-2 bg-red-500 rounded-full inline-block mr-1 animate-pulse" />
            Đang kết nối server...
          </p>
        )}
      </div>

      <a href="/" className="mt-5 text-slate-500 hover:text-slate-300 text-sm flex items-center gap-1 transition-colors">
        <ArrowLeft className="w-4 h-4" /> Về trang học sinh
      </a>
    </div>
  );
}
