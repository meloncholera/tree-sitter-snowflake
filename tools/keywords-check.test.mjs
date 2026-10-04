import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { findDuplicateKeywordKeys } from './keywords-check.mjs';

test('findDuplicateKeywordKeys flags a repeated key', () => {
  assert.deepEqual(
    findDuplicateKeywordKeys(
      'export default {\n  keyword_if: _ => 1,\n  keyword_or: _ => 2,\n  keyword_if: _ => 3,\n};\n',
    ),
    ['keyword_if'],
  );
});

test('findDuplicateKeywordKeys is silent on distinct keys', () => {
  assert.deepEqual(
    findDuplicateKeywordKeys(
      'export default {\n  keyword_if: _ => 1,\n  keyword_or: _ => 2,\n};\n',
    ),
    [],
  );
});

test('grammar/keywords.js declares no keyword key twice', () => {
  const source = readFileSync(
    fileURLToPath(new URL('../grammar/keywords.js', import.meta.url)),
    'utf8',
  );
  assert.deepEqual(findDuplicateKeywordKeys(source), []);
});
