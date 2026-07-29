import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decodePngDataUrl,
  isAllowedShotOrigin,
  sanitizeShotName,
} from '../vite.config.js';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const pngUrl = `data:image/png;base64,${PNG_MAGIC.toString('base64')}`;

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

test('PNG decoder requires a strict PNG data URL and signature', () => {
  assert.deepEqual(decodePngDataUrl(pngUrl), PNG_MAGIC);
  assert.equal(decodePngDataUrl(`data:image/jpeg;base64,${PNG_MAGIC.toString('base64')}`), null);
  assert.equal(decodePngDataUrl('data:image/png;base64,not base64'), null);
  assert.equal(
    decodePngDataUrl(`data:image/png;base64,${Buffer.from('not png').toString('base64')}`),
    null,
  );
});

test('shot names cannot escape the shots directory', () => {
  assert.equal(sanitizeShotName('../../outside'), '.._.._outside');
  assert.equal(sanitizeShotName('boss wave 5'), 'boss_wave_5');
  assert.equal(sanitizeShotName('...'), 'shot');
  assert.equal(sanitizeShotName(null), 'shot');
});
