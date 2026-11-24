import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The Django API (cd backend && python manage.py runserver).
const backend = process.env.RENTEASE_API || 'http://127.0.0.1:8000';

export default defineConfig(({ command }) => ({
  // The production build is served by Django under /static/ (see backend/config/settings.py).
  base: command === 'build' ? '/static/' : '/',
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Forward API calls, uploaded files, and the Django admin to Django, so the browser
    // sees one origin and the session + CSRF cookies just work.
    proxy: {
      '/api': backend,
      '/media': backend,
      '/django-admin': backend,
      '/static': backend,
    },
  },
}));
