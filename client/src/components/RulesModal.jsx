import React, { useState } from 'react';
import { X, BookOpen, Gamepad2, HelpCircle, Trophy, Clock, Users, Shield } from 'lucide-react';

const TABS = [
  { id: 'intro',  label: 'Giới thiệu', icon: BookOpen },
  { id: 'rules',  label: 'Luật chơi',  icon: Shield },
  { id: 'guide',  label: 'Hướng dẫn',  icon: HelpCircle },
];

export default function RulesModal({ onClose }) {
  const [tab, setTab] = useState('intro');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-slate-900 border border-slate-700/60 rounded-2xl shadow-2xl w-full max-w-lg animate-bounce-in flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center gap-3 px-5 pt-5 pb-4 border-b border-slate-700/60 shrink-0">
          <div className="w-9 h-9 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-900/50">
            <Gamepad2 className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="font-extrabold text-base leading-tight">
              LSTS Caro<span className="text-indigo-400">Tourney</span>
            </h2>
            <p className="text-xs text-slate-400">Giải đấu Cờ Caro trực tuyến</p>
          </div>
          <button
            onClick={onClose}
            className="ml-auto p-1.5 rounded-lg hover:bg-slate-700/60 transition-colors text-slate-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-5 pt-3 pb-0 shrink-0">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                tab === id
                  ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-900/40'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="overflow-y-auto flex-1 px-5 py-4 text-sm text-slate-300 space-y-4">

          {/* ── GIỚI THIỆU ── */}
          {tab === 'intro' && (
            <div className="space-y-4">
              <div className="bg-indigo-900/30 border border-indigo-700/40 rounded-xl p-4">
                <h3 className="font-bold text-indigo-300 mb-2">🎮 LSTS Caro Tourney là gì?</h3>
                <p className="text-slate-300 text-xs leading-relaxed">
                  <strong className="text-white">LSTS Caro Tourney</strong> là nền tảng thi đấu Cờ Caro (Gomoku)
                  trực tuyến được thiết kế riêng cho lớp học. Giáo viên tạo phòng đấu, học sinh tham gia qua
                  mã phòng hoặc quét mã QR, rồi hệ thống tự động ghép trận và tính điểm theo thời gian thực.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {[
                  { icon: Users,   color: 'blue',   title: 'Nhiều người chơi', desc: 'Cả lớp cùng thi đấu đồng thời trong một giải đấu' },
                  { icon: Trophy,  color: 'yellow',  title: 'Bảng xếp hạng', desc: 'Điểm số cập nhật real-time, theo dõi thứ hạng trực tiếp' },
                  { icon: Clock,   color: 'orange',  title: 'Giới hạn thời gian', desc: 'Mỗi lượt đi có 30 giây, tăng tính kịch tính' },
                  { icon: Gamepad2, color: 'purple', title: 'Xem trực tiếp', desc: 'Học sinh chờ trận có thể xem các trận đang diễn ra' },
                ].map(({ icon: Icon, color, title, desc }) => (
                  <div key={title} className={`bg-${color}-900/20 border border-${color}-800/30 rounded-xl p-3`}>
                    <Icon className={`w-4 h-4 text-${color}-400 mb-1.5`} />
                    <p className={`text-${color}-300 font-semibold text-xs mb-1`}>{title}</p>
                    <p className="text-slate-400 text-[11px] leading-relaxed">{desc}</p>
                  </div>
                ))}
              </div>

              <div className="bg-slate-800/60 rounded-xl p-4">
                <h3 className="font-bold text-slate-200 mb-3 text-xs">🏆 Hệ thống tính điểm</h3>
                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="bg-green-900/30 rounded-lg py-2">
                    <div className="text-green-400 font-black text-lg">+3</div>
                    <div className="text-slate-500">Thắng</div>
                  </div>
                  <div className="bg-yellow-900/30 rounded-lg py-2">
                    <div className="text-yellow-400 font-black text-lg">+1</div>
                    <div className="text-slate-500">Hoà</div>
                  </div>
                  <div className="bg-red-900/30 rounded-lg py-2">
                    <div className="text-red-400 font-black text-lg">+0</div>
                    <div className="text-slate-500">Thua</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── LUẬT CHƠI ── */}
          {tab === 'rules' && (
            <div className="space-y-4">
              <div className="bg-slate-800/60 rounded-xl p-4">
                <h3 className="font-bold text-slate-200 mb-2">🎯 Mục tiêu</h3>
                <p className="text-xs leading-relaxed text-slate-300">
                  Xếp <strong className="text-white">5 quân liên tiếp</strong> theo hàng ngang, dọc hoặc chéo
                  trước đối thủ để giành chiến thắng. Bàn cờ có kích thước <strong className="text-white">15×15</strong>.
                </p>
              </div>

              <div className="space-y-2">
                <h3 className="font-bold text-slate-200 text-xs">📋 Các quy tắc cơ bản</h3>

                {[
                  {
                    no: '01',
                    color: 'blue',
                    title: 'Luân phiên đánh',
                    desc: 'Hai người đánh luân phiên, mỗi lượt chọn 1 ô trống trên bàn cờ. Người đi trước dùng quân X (xanh), người đi sau dùng quân O (đỏ).',
                  },
                  {
                    no: '02',
                    color: 'green',
                    title: 'Điều kiện thắng',
                    desc: 'Người đầu tiên tạo được 5 quân liên tiếp (ngang / dọc / chéo) thì thắng. Dãy 6 quân trở lên cũng tính là thắng.',
                  },
                  {
                    no: '03',
                    color: 'yellow',
                    title: '⚠️ Luật cấm "5 bị chặn 2 đầu"',
                    desc: 'Áp dụng luật cờ Caro Việt Nam: nếu đúng 5 quân liên tiếp nhưng cả hai đầu đều bị chặn bởi quân đối phương, thì KHÔNG tính thắng. Dãy này bị coi là vô hiệu.',
                  },
                  {
                    no: '04',
                    color: 'orange',
                    title: 'Giới hạn thời gian',
                    desc: 'Mỗi lượt có 30 giây. Nếu hết giờ mà chưa đánh, lượt sẽ tự động chuyển sang đối thủ (không bị thua, chỉ mất lượt).',
                  },
                  {
                    no: '05',
                    color: 'purple',
                    title: 'Hoà',
                    desc: 'Khi bàn cờ đầy mà không ai thắng, kết quả là hoà. Mỗi người được 1 điểm.',
                  },
                  {
                    no: '06',
                    color: 'red',
                    title: 'Ngắt kết nối',
                    desc: 'Nếu một người mất kết nối giữa trận, đối thủ được xử thắng ngay lập tức.',
                  },
                ].map(({ no, color, title, desc }) => (
                  <div key={no} className={`bg-${color}-900/15 border border-${color}-800/25 rounded-xl p-3 flex gap-3`}>
                    <span className={`text-${color}-500 font-black text-sm shrink-0 w-6 text-center`}>{no}</span>
                    <div>
                      <p className={`text-${color}-300 font-semibold text-xs mb-1`}>{title}</p>
                      <p className="text-slate-400 text-[11px] leading-relaxed">{desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── HƯỚNG DẪN ── */}
          {tab === 'guide' && (
            <div className="space-y-4">
              {/* Teacher guide */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-6 h-6 bg-indigo-600 rounded-lg flex items-center justify-center">
                    <Shield className="w-3.5 h-3.5 text-white" />
                  </div>
                  <h3 className="font-bold text-sm">Hướng dẫn Giáo viên</h3>
                </div>
                <div className="space-y-2">
                  {[
                    { step: 1, text: 'Truy cập trang /admin để vào bảng điều khiển giáo viên.' },
                    { step: 2, text: 'Nhấn "Tạo giải đấu" — hệ thống sẽ tạo mã phòng 6 ký tự.' },
                    { step: 3, text: 'Chia sẻ mã phòng hoặc chiếu QR Code lên màn hình cho học sinh.' },
                    { step: 4, text: 'Chờ học sinh vào phòng đủ rồi nhấn "Bắt đầu giải đấu" (cần ít nhất 2 người).' },
                    { step: 5, text: 'Hệ thống tự ghép trận và tính điểm. Giáo viên theo dõi bảng xếp hạng và các trận đang đấu.' },
                    { step: 6, text: 'Khi muốn kết thúc, nhấn "Kết thúc giải đấu" — các trận đang chơi sẽ được tính hoà.' },
                  ].map(({ step, text }) => (
                    <div key={step} className="flex gap-3 items-start">
                      <span className="w-5 h-5 rounded-full bg-indigo-700/60 border border-indigo-600/50 text-indigo-300 text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                        {step}
                      </span>
                      <p className="text-xs text-slate-300 leading-relaxed">{text}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="border-t border-slate-700/60" />

              {/* Student guide */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-6 h-6 bg-green-700 rounded-lg flex items-center justify-center">
                    <Gamepad2 className="w-3.5 h-3.5 text-white" />
                  </div>
                  <h3 className="font-bold text-sm">Hướng dẫn Học sinh</h3>
                </div>
                <div className="space-y-2">
                  {[
                    { step: 1, text: 'Truy cập trang web, nhập biệt danh và mã phòng do giáo viên cung cấp.' },
                    { step: 2, text: 'Nhấn "Vào phòng" và chờ trong sảnh cho đến khi giải đấu bắt đầu.' },
                    { step: 3, text: 'Khi có trận, màn hình đếm ngược 3-2-1 sẽ xuất hiện và bàn cờ mở ra.' },
                    { step: 4, text: 'Đến lượt bạn thì nhấn vào ô muốn đánh. Thời gian mỗi lượt là 30 giây.' },
                    { step: 5, text: 'Sau khi kết thúc trận, nhấn "Trận tiếp theo" để được ghép trận mới.' },
                    { step: 6, text: 'Khi đang chờ ghép trận, bạn có thể nhấn "Xem" để xem các trận đang diễn ra.' },
                  ].map(({ step, text }) => (
                    <div key={step} className="flex gap-3 items-start">
                      <span className="w-5 h-5 rounded-full bg-green-800/60 border border-green-700/50 text-green-300 text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                        {step}
                      </span>
                      <p className="text-xs text-slate-300 leading-relaxed">{text}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-amber-900/20 border border-amber-700/30 rounded-xl p-3 text-xs text-amber-300">
                <p className="font-semibold mb-1">💡 Mẹo</p>
                <ul className="text-slate-400 space-y-0.5 list-disc list-inside">
                  <li>Quét mã QR bằng camera điện thoại để vào phòng nhanh hơn.</li>
                  <li>Nhấn nút 🔊 / 🔇 ở góc phải để tắt/bật âm thanh.</li>
                  <li>Cố thắng liên tiếp để nhận huy hiệu 🔥 phong độ.</li>
                </ul>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-700/60 shrink-0">
          <button
            onClick={onClose}
            className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm py-2 rounded-xl transition-colors"
          >
            Đã hiểu, bắt đầu thôi!
          </button>
        </div>
      </div>
    </div>
  );
}
