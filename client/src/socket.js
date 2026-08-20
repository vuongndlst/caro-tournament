import { SupabaseGameSocket } from './lib/supabaseGameSocket';

const SOCKET_URL = import.meta.env.VITE_SERVER_URL || '';

// Attach admin token if present so the server can verify admin actions.
const adminToken = localStorage.getItem('caro_admin_token');

export const usingSupabaseGameBackend = import.meta.env.VITE_GAME_BACKEND === 'supabase';

export const socket = usingSupabaseGameBackend
  ? new SupabaseGameSocket()
  : (await import('./lib/localGameSocket')).createLocalGameSocket(SOCKET_URL, adminToken);
