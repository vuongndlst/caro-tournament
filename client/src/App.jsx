import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { GameProvider } from './context/GameContext';
import HomePage from './pages/HomePage';
import AdminPage from './pages/AdminPage';

export default function App() {
  return (
    <GameProvider>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </GameProvider>
  );
}
