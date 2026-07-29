import { defineConfig } from 'vite';
import { shotPlugin } from './scripts/shot-middleware.js';

export default defineConfig({
  plugins: [shotPlugin()],
  // Relative base so the build works from any sub-path (e.g. GitHub Pages
  // serves it from /<repo>/ rather than the domain root).
  base: './',
  server: { port: 5173, open: false },
  build: { target: 'es2020', outDir: 'dist' },
});
