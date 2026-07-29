import test from 'node:test';
import assert from 'node:assert/strict';
import { Rng, mulberry32 } from '../src/rng.js';

test('mulberry32 produces a repeatable sequence for a seed', () => {
  const first = mulberry32(1337);
  const second = mulberry32(1337);

  assert.deepEqual(
    Array.from({ length: 8 }, () => first()),
    Array.from({ length: 8 }, () => second()),
  );
});

test('integer values stay inside the inclusive range', () => {
  const rng = new Rng(42);

  for (let i = 0; i < 1000; i++) {
    const value = rng.int(-3, 7);
    assert.ok(value >= -3 && value <= 7);
  }
});

test('pick only returns values from the supplied collection', () => {
  const rng = new Rng(99);
  const values = ['svoboda', 'petrov', 'spilberk'];

  for (let i = 0; i < 100; i++) {
    assert.ok(values.includes(rng.pick(values)));
  }
});

test('reset reproduces the original sequence without replacing the RNG', () => {
  const rng = new Rng(42);
  const first = [rng.next(), rng.next(), rng.next()];
  rng.reset(42);
  assert.deepEqual([rng.next(), rng.next(), rng.next()], first);
});
