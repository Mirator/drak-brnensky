import test from 'node:test';
import assert from 'node:assert/strict';
import { FLAG, snapFlag } from '../src/city.js';

test('antialiased flag values snap to the nearest known classification', () => {
  assert.equal(snapFlag(0), FLAG.FREE);
  assert.equal(snapFlag(12), FLAG.FREE);
  assert.equal(snapFlag(16), FLAG.ROAD);
  assert.equal(snapFlag(44), FLAG.ROAD);
  assert.equal(snapFlag(46), FLAG.PLAZA);
  assert.equal(snapFlag(119), FLAG.RESERVED);
  assert.equal(snapFlag(255), FLAG.TRACK);
});
