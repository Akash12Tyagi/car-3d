import { defineConfig } from 'vite';

// Relative base so the built site works from any folder (GitHub Pages, Netlify, a USB stick for the pitch).
export default defineConfig({
  base: './',
  build: { chunkSizeWarningLimit: 900 },
});
