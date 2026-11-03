import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `base: './'` keeps asset paths relative, so the build works when served from
// https://prithviramg-nd.github.io/massive-video-reviewer/ (or any other sub-path).
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    port: 5173,
  },
  preview: {
    port: 4173,
  },
});
