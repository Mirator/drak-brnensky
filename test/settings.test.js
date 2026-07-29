import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, loadSettings, normalizeSettings, saveSettings } from '../src/settings.js';

function memoryStorage(initial = null) {
  let value = initial;
  return {
    getItem: () => value,
    setItem: (_key, next) => { value = next; },
    value: () => value,
  };
}

test('settings are normalized to supported values', () => {
  assert.deepEqual(normalizeSettings({
    sensitivity: 9,
    invertY: true,
    volume: -2,
  }), {
    sensitivity: 2,
    invertY: true,
    volume: 0,
  });
});

test('invalid persisted settings fall back safely', () => {
  assert.deepEqual(loadSettings(memoryStorage('{broken')), DEFAULT_SETTINGS);
});

test('unavailable storage falls back without throwing', () => {
  assert.deepEqual(loadSettings(null), DEFAULT_SETTINGS);
  assert.equal(saveSettings(DEFAULT_SETTINGS, null), false);
});

test('a throwing localStorage getter cannot abort module startup', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get: () => { throw new DOMException('denied', 'SecurityError'); },
  });
  try {
    assert.deepEqual(loadSettings(), DEFAULT_SETTINGS);
    assert.equal(saveSettings(DEFAULT_SETTINGS), false);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else delete globalThis.localStorage;
  }
});

test('settings round-trip through storage', () => {
  const storage = memoryStorage();
  const expected = { sensitivity: 1.35, invertY: true, volume: 0.25 };

  assert.equal(saveSettings(expected, storage), true);
  assert.deepEqual(loadSettings(storage), expected);
});
