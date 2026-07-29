import fs from 'node:fs';
import path from 'node:path';

const MAX_SHOT_BODY_BYTES = 5 * 1024 * 1024;
const PNG_PREFIX = 'data:image/png;base64,';
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const WINDOWS_DEVICE_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

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
      (origin.protocol === 'http:' || origin.protocol === 'https:')
      && LOCAL_HOSTS.has(origin.hostname.toLowerCase())
      && origin.host.toLowerCase() === authority.host
    );
  } catch {
    return false;
  }
}

export function decodePngDataUrl(data) {
  if (typeof data !== 'string' || !data.startsWith(PNG_PREFIX)) return null;
  const encoded = data.slice(PNG_PREFIX.length);
  if (
    encoded.length === 0
    || encoded.length % 4 !== 0
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)
  ) {
    return null;
  }

  const bytes = Buffer.from(encoded, 'base64');
  if (
    bytes.length < 33
    || !bytes.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)
    || bytes.readUInt32BE(8) !== 13
    || bytes.toString('ascii', 12, 16) !== 'IHDR'
  ) {
    return null;
  }

  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  return width > 0 && height > 0 && width <= 32768 && height <= 32768 ? bytes : null;
}

export function sanitizeShotName(value) {
  const source = typeof value === 'string' ? value.slice(0, 64) : 'shot';
  const safe = source.replace(/[^A-Za-z0-9_.-]/g, '_').replace(/^\.+$/, '') || 'shot';
  return WINDOWS_DEVICE_NAME.test(safe) ? `_${safe}` : safe;
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('x-content-type-options', 'nosniff');
  res.end(JSON.stringify(payload));
}

function parsePayload(chunks, received) {
  try {
    const payload = JSON.parse(Buffer.concat(chunks, received).toString('utf8'));
    return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null;
  } catch {
    return null;
  }
}

/**
 * Dev-only helper: the page can POST a PNG data URL to /__shot and it lands in
 * ./shots/. This middleware is only registered by Vite's development server.
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
          const payload = parsePayload(chunks, received);
          if (!payload) return sendJson(res, 400, { ok: false, error: 'Invalid request' });

          const png = decodePngDataUrl(payload.data);
          if (!png) return sendJson(res, 400, { ok: false, error: 'Invalid PNG data' });

          const dir = path.resolve(process.cwd(), 'shots');
          const filename = `${sanitizeShotName(payload.name)}.png`;
          const file = path.resolve(dir, filename);
          if (path.dirname(file) !== dir) {
            return sendJson(res, 400, { ok: false, error: 'Invalid filename' });
          }

          try {
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(file, png, { flag: 'w' });
            return sendJson(res, 200, { ok: true, file: filename, bytes: png.length });
          } catch (error) {
            console.error('Failed to save screenshot', error);
            return sendJson(res, 500, { ok: false, error: 'Unable to save screenshot' });
          }
        });
        req.on('error', () => {
          if (!res.writableEnded) sendJson(res, 400, { ok: false, error: 'Invalid request' });
        });
      });
    },
  };
}
