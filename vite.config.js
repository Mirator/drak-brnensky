import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

const MAX_SHOT_BODY_BYTES = 5 * 1024 * 1024;
const PNG_PREFIX = 'data:image/png;base64,';
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function parseAuthority(value) {
  try {
    const url = new URL(`http://${value}`);
    return { host: url.host.toLowerCase(), hostname: url.hostname.toLowerCase() };
  } catch {
    return null;
  }
}

export function isAllowedShotOrigin(headers) {
  const authority = parseAuthority(headers.host);
  if (!authority || !LOCAL_HOSTS.has(authority.hostname)) return false;

  try {
    const origin = new URL(headers.origin);
    return (
      (origin.protocol === 'http:' || origin.protocol === 'https:') &&
      LOCAL_HOSTS.has(origin.hostname.toLowerCase()) &&
      origin.host.toLowerCase() === authority.host
    );
  } catch {
    return false;
  }
}

export function decodePngDataUrl(data) {
  if (typeof data !== 'string' || !data.startsWith(PNG_PREFIX)) return null;
  const encoded = data.slice(PNG_PREFIX.length);
  if (
    encoded.length === 0 ||
    encoded.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)
  ) {
    return null;
  }
  const bytes = Buffer.from(encoded, 'base64');
  return bytes.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC) ? bytes : null;
}

export function sanitizeShotName(value) {
  const source = typeof value === 'string' ? value.slice(0, 64) : 'shot';
  const safe = source.replace(/[^A-Za-z0-9_.-]/g, '_').replace(/^\.+$/, '');
  return safe || 'shot';
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('x-content-type-options', 'nosniff');
  res.end(JSON.stringify(payload));
}

/**
 * Dev-only helper: the page can POST a PNG data URL to /__shot and it lands in
 * ./shots/, which makes automated visual checks possible without a visible
 * browser window. Not part of the production build.
 */
export function shotPlugin() {
  return {
    name: 'brno-shot',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__shot', (req, res) => {
        if (req.method !== 'POST') {
          res.setHeader('allow', 'POST');
          return sendJson(res, 405, { ok: false, error: 'Method not allowed' });
        }
        if (!isAllowedShotOrigin(req.headers)) {
          return sendJson(res, 403, { ok: false, error: 'Forbidden' });
        }
        const contentType = String(req.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase();
        if (contentType !== 'application/json') {
          return sendJson(res, 415, { ok: false, error: 'Expected application/json' });
        }
        const declaredLength = Number(req.headers['content-length']);
        if (Number.isFinite(declaredLength) && declaredLength > MAX_SHOT_BODY_BYTES) {
          req.resume();
          return sendJson(res, 413, { ok: false, error: 'Request too large' });
        }

        const chunks = [];
        let received = 0;
        let rejected = false;
        req.on('data', (chunk) => {
          if (rejected) return;
          received += chunk.length;
          if (received > MAX_SHOT_BODY_BYTES) {
            rejected = true;
            chunks.length = 0;
            sendJson(res, 413, { ok: false, error: 'Request too large' });
            return;
          }
          chunks.push(chunk);
        });
        req.on('end', () => {
          if (rejected) return;
          try {
            const payload = JSON.parse(Buffer.concat(chunks, received).toString('utf8'));
            if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
              return sendJson(res, 400, { ok: false, error: 'Invalid request' });
            }
            const png = decodePngDataUrl(payload.data);
            if (!png) return sendJson(res, 400, { ok: false, error: 'Invalid PNG data' });

            const dir = path.resolve(process.cwd(), 'shots');
            fs.mkdirSync(dir, { recursive: true });
            const filename = `${sanitizeShotName(payload.name)}.png`;
            const file = path.resolve(dir, filename);
            if (path.dirname(file) !== dir) {
              return sendJson(res, 400, { ok: false, error: 'Invalid filename' });
            }
            fs.writeFileSync(file, png, { flag: 'w' });
            return sendJson(res, 200, { ok: true, file: filename, bytes: png.length });
          } catch {
            return sendJson(res, 400, { ok: false, error: 'Invalid request' });
          }
        });
        req.on('error', () => {
          if (!res.writableEnded) sendJson(res, 400, { ok: false, error: 'Invalid request' });
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
