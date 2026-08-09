import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { GameProvider } from './context/GameContext';
import { AuthProvider } from './context/AuthContext';
import HomePage from './pages/HomePage';
import AdminPage from './pages/AdminPage';
import SpectatorPage from './pages/SpectatorPage';

export default function App() {
  return (
    <AuthProvider>
      <GameProvider>
        <Routes>
          <Route path="/"         element={<HomePage />} />
          <Route path="/admin"    element={<AdminPage />} />
          <Route path="/spectate" element={<SpectatorPage />} />
          <Route path="*"         element={<Navigate to="/" replace />} />
        </Routes>
      </GameProvider>
    </AuthProvider>
  );
}
