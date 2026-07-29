import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decodePngDataUrl,
  isAllowedShotOrigin,
  sanitizeShotName,
} from '../scripts/shot-middleware.js';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function pngHeader(width = 1280, height = 720) {
  const header = Buffer.alloc(33);
  PNG_MAGIC.copy(header);
  header.writeUInt32BE(13, 8);
  header.write('IHDR', 12, 'ascii');
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  header[24] = 8;
  header[25] = 6;
  return header;
}
const png = pngHeader();
const pngUrl = `data:image/png;base64,${png.toString('base64')}`;

test('shot origin requires an exact loopback host and origin match', () => {
  assert.equal(isAllowedShotOrigin({
    host: '127.0.0.1:5173',
    origin: 'http://127.0.0.1:5173',
  }), true);
  assert.equal(isAllowedShotOrigin({
    host: 'localhost:5173',
    origin: 'http://localhost:5173',
  }), true);
  assert.equal(isAllowedShotOrigin({
    host: '[::1]:5173',
    origin: 'http://[::1]:5173',
  }), true);
  assert.equal(isAllowedShotOrigin({
    host: '127.0.0.1:5173',
    origin: 'https://attacker.example',
  }), false);
  assert.equal(isAllowedShotOrigin({
    host: 'localhost.evil:5173',
    origin: 'http://localhost.evil:5173',
  }), false);
  assert.equal(isAllowedShotOrigin({ host: 'localhost:5173' }), false);
});

test('PNG decoder requires a strict data URL and plausible IHDR', () => {
  assert.deepEqual(decodePngDataUrl(pngUrl), png);
  assert.equal(decodePngDataUrl(`data:image/jpeg;base64,${png.toString('base64')}`), null);
  assert.equal(decodePngDataUrl('data:image/png;base64,not base64'), null);
  assert.equal(
    decodePngDataUrl(`data:image/png;base64,${Buffer.from('not png').toString('base64')}`),
    null,
  );
  assert.equal(
    decodePngDataUrl(`data:image/png;base64,${PNG_MAGIC.toString('base64')}`),
    null,
  );
  assert.equal(
    decodePngDataUrl(`data:image/png;base64,${pngHeader(0, 720).toString('base64')}`),
    null,
  );
});

test('shot names cannot escape the shots directory', () => {
  assert.equal(sanitizeShotName('../../outside'), '.._.._outside');
  assert.equal(sanitizeShotName('boss wave 5'), 'boss_wave_5');
  assert.equal(sanitizeShotName('...'), 'shot');
  assert.equal(sanitizeShotName(null), 'shot');
  assert.equal(sanitizeShotName('con'), '_con');
  assert.equal(sanitizeShotName('NUL.capture'), '_NUL.capture');
  assert.equal(sanitizeShotName('com9'), '_com9');
});
