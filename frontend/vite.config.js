import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The RentEase API (cd backend && npm start).
const backend = process.env.RENTEASE_API || 'http://127.0.0.1:8000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Forward API calls and uploaded files to the API server, so the browser
    // sees one origin and the session + CSRF cookies just work.
    proxy: {
      '/api': backend,
      '/media': backend,
    },
  },
});
