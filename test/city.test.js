import test from 'node:test';
import assert from 'node:assert/strict';
import { FLAG, FlagGrid } from '../src/city.js';

test('flag grid stores only exact classifications at shape borders', () => {
  const grid = new FlagGrid();
  grid.fill(FLAG.FREE);
  grid.rect(0, 0, 20, 20, FLAG.PARK);
  grid.line([[-20, -20], [20, 20]], 5, FLAG.ROAD);
  grid.circle(0, 0, 4, FLAG.RESERVED);

  const known = new Set(Object.values(FLAG));
  assert.equal([...grid.data].every((value) => known.has(value)), true);
  assert.equal(grid.data[210 * 420 + 210], FLAG.RESERVED);
});
