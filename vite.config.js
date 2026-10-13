import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    // Proxy các request /api:
    // - Mặc định sang thẳng Cloudflare Pages Functions & D1 production.
    // - Khi chạy dev full-stack local (npm run dev:full), trỏ sang server local
    //   qua biến môi trường VITE_API_TARGET=http://localhost:8788
    proxy: {
      '/api': {
        target: process.env.VITE_API_TARGET || 'https://phong-chi-tieu.pages.dev',
        changeOrigin: true,
        secure: true,
      },
    },
  },
});
