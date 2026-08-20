import { io } from 'socket.io-client';

export function createLocalGameSocket(url, adminToken) {
  return io(url, {
    autoConnect: false,
    transports: ['websocket', 'polling'],
    path: '/socket.io',
    auth: adminToken ? { token: adminToken } : {},
  });
}
