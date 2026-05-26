import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Dev proxy: forward /socket.io and /api to local backend
    proxy: {
      '/socket.io': {
        target: 'http://localhost:3001',
        ws: true,
      },
      '/api': {
        target: 'http://localhost:3001',
      },
    },
  },
  build: {
    // Output to server's expected path for production serving
    outDir: 'dist',
    sourcemap: false,
  },
});
