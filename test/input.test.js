import test from 'node:test';
import assert from 'node:assert/strict';
import { isFormControl } from '../src/input.js';

test('form controls retain their standard keyboard behaviour', () => {
  const input = { matches: (selector) => selector.includes('input'), isContentEditable: false };
  const canvas = { matches: () => false, isContentEditable: false };
  const editor = { matches: () => false, isContentEditable: true };

  assert.equal(isFormControl(input), true);
  assert.equal(isFormControl(editor), true);
  assert.equal(isFormControl(canvas), false);
  assert.equal(isFormControl(null), false);
});
