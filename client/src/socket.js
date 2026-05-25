import { io } from 'socket.io-client';

// Use relative URL so Vite proxy handles it in dev; set VITE_SERVER_URL for production
const SOCKET_URL = import.meta.env.VITE_SERVER_URL || '';

export const socket = io(SOCKET_URL, {
  autoConnect: false,
  transports: ['websocket', 'polling'],
  path: '/socket.io',
});
