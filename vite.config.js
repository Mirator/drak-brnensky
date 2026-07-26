import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Dev-only helper: the page can POST a PNG data URL to /__shot and it lands in
 * ./shots/, which makes automated visual checks possible without a visible
 * browser window. Not part of the production build.
 */
function shotPlugin() {
  return {
    name: 'brno-shot',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__shot', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          return res.end('POST only');
        }
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
          try {
            const { name = 'shot', data } = JSON.parse(body);
            const b64 = data.replace(/^data:image\/\w+;base64,/, '');
            const dir = path.resolve(process.cwd(), 'shots');
            fs.mkdirSync(dir, { recursive: true });
            const file = path.join(dir, `${name.replace(/[^\w.-]/g, '_')}.png`);
            fs.writeFileSync(file, Buffer.from(b64, 'base64'));
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: true, file, bytes: b64.length }));
          } catch (err) {
            res.statusCode = 500;
            res.end(String(err));
          }
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [shotPlugin()],
  // Relative base so the build works from any sub-path (e.g. GitHub Pages
  // serves it from /<repo>/ rather than the domain root).
  base: './',
  server: { port: 5173, open: false },
  build: { target: 'es2020', outDir: 'dist' },
});
