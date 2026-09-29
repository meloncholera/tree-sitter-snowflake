#!/usr/bin/env node
// Fixture check: parses every test/fixtures/*.sql and reports, per file,
// ERROR/MISSING node counts and zero-width nodes (equal start and end
// positions), which the error grep cannot see. Exits non-zero if any file
// has either. Zero ERROR/MISSING is not proof a fixture is valid Snowflake
// (a parser has no semantic layer), but it is the regression signal.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { fixtureResult, resolveTreeSitterCli } from './fixture-result.mjs';

const repo = fileURLToPath(new URL('..', import.meta.url));
const cli = resolveTreeSitterCli(repo);
const fixtures = readdirSync(join(repo, 'test/fixtures')).filter((f) => f.endsWith('.sql'));
assert(fixtures.length > 0, 'No SQL fixtures found');

let bad = 0;
for (const f of fixtures) {
  const proc = spawnSync(cli, ['parse', join('test/fixtures', f)], {
    cwd: repo,
    encoding: 'utf8',
    maxBuffer: 1 << 26,
    env: { ...process.env, CC: 'gcc', CXX: 'g++' },
  });
  try {
    const { errors, zeroWidth } = fixtureResult(proc);
    if (errors || zeroWidth) {
      bad++;
      console.log(`${f}: errors=${errors} zero-width=${zeroWidth}`);
    }
  } catch (error) {
    bad++;
    console.error(`${f}: ${error.message}`);
  }
}
console.log(
  bad
    ? `${bad}/${fixtures.length} fixture files with problems`
    : `all ${fixtures.length} fixtures parse clean (no ERROR/MISSING, no zero-width nodes)`,
);
process.exit(bad ? 1 : 0);
