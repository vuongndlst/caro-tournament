import { io } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_SERVER_URL || '';

// Attach admin token if present so the server can verify admin actions.
const adminToken = localStorage.getItem('caro_admin_token');

export const socket = io(SOCKET_URL, {
  autoConnect: false,
  transports: ['websocket', 'polling'],
  path: '/socket.io',
  auth: adminToken ? { token: adminToken } : {},
});
