import { defineConfig } from 'vite';
import { shotPlugin } from './scripts/shot-middleware.js';

export default defineConfig({
  plugins: [shotPlugin()],
  // Relative base so the build works from any sub-path (e.g. GitHub Pages
  // serves it from /<repo>/ rather than the domain root).
  base: './',
  // PORT lets a second dev server run alongside the first (agent tooling does
  // this); 5173 stays the default so nothing else has to change.
  server: { port: Number(process.env.PORT) || 5173, open: false },
  build: { target: 'es2020', outDir: 'dist' },
});
