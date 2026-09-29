import assert from 'node:assert/strict';
import test from 'node:test';
import { fixtureResult } from './fixture-result.mjs';

const valid = { status: 0, signal: null, stdout: '(program [0, 0] - [1, 0])', stderr: '' };

test('fixture validation rejects process failures and missing output', () => {
  assert.deepEqual(fixtureResult(valid), { errors: 0, zeroWidth: 0 });
  for (const change of [
    { error: new Error('ENOENT') },
    { status: 1, stdout: '', stderr: 'Failed to load language' },
    { status: null, signal: 'SIGTERM' },
    { stdout: '' },
    { stdout: 'No language found' },
  ])
    assert.throws(() => fixtureResult({ ...valid, ...change }));
});

test('fixture validation retains ERROR, MISSING, and zero-width checks', () => {
  assert.deepEqual(
    fixtureResult({
      ...valid,
      stdout:
        '(program [0, 0] - [1, 0]\n (ERROR [0, 0] - [0, 1])\n (MISSING identifier [0, 1] - [0, 1]))',
    }),
    { errors: 2, zeroWidth: 1 },
  );
});
