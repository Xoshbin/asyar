import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isVersionBelow } from './setup-version.mjs';

test('rejects versions below the required pnpm release', () => {
  assert.equal(isVersionBelow('10.25.9', '10.26'), true);
  assert.equal(isVersionBelow('v9.15.0', '10.26'), true);
});

test('accepts the minimum and newer versions', () => {
  assert.equal(isVersionBelow('10.26.0', '10.26'), false);
  assert.equal(isVersionBelow('10.26.1', '10.26'), false);
  assert.equal(isVersionBelow('11.0.0', '10.26'), false);
});

test('compares missing version parts as zero', () => {
  assert.equal(isVersionBelow('20', '20'), false);
  assert.equal(isVersionBelow('19', '20'), true);
});

test('does not reject an unrecognized successful command response', () => {
  assert.equal(isVersionBelow('unknown', '10.26'), false);
});
