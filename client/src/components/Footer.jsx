import React from 'react';

export default function Footer({ className = '' }) {
  return (
    <footer className={`text-center text-xs text-slate-600 py-3 ${className}`}>
      Phát triển bởi{' '}
      <span className="text-slate-500 font-medium">thầy Nguyễn Đình Vương</span>
      {' '}·{' '}
      <span className="text-indigo-700 font-semibold">LSTS Caro<span className="text-indigo-500">Tourney</span></span>
    </footer>
  );
}
