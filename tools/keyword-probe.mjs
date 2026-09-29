#!/usr/bin/env node
// Keyword-slot probe. For every keyword spelled in grammar/keywords.js,
// parses both positions where an ordinary identifier sits:
//   alias slot:   SELECT * FROM db.schema.t <word>
//   column slot:  SELECT <word> FROM t
// A keyword valid in one of those parser states is substituted by keyword
// extraction and breaks the probe. Failures are expected — and correct —
// for two documented classes:
//
//   1. Snowflake's reserved words (they cannot be identifiers in Snowflake
//      either).
//   2. Clause and function keywords that REQUIRE more tokens after them
//      (LIMIT n, PIVOT (...), EXCEPT <query>, MATCH_RECOGNIZE (...),
//      WINDOW w AS (...), TOP n, EXTRACT(...), IDENTIFIER(...),
//      INTERVAL 'n' DAY). Snowflake itself rejects these words bare in
//      the slot, so the grammar erroring is faithful behavior; the corpus
//      has been grepped and none is used as a bare column or alias.
//
// Anything else failing is a regression: a new keyword is eating an
// identifier position. Run this whenever a keyword is added.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { resolveTreeSitterCli, stripAnsi } from './fixture-result.mjs';

const repo = fileURLToPath(new URL('..', import.meta.url));
const cli = resolveTreeSitterCli(repo);

const kwFile = readFileSync(join(repo, 'grammar/keywords.js'), 'utf8');
const words = [
  ...new Set([...kwFile.matchAll(/make_keyword\("([a-z_0-9]+)"/g)].map((m) => m[1])),
].sort();

// Snowflake's documented reserved words.
const reserved = new Set(
  'all alter and any as between by case cast check column connect connection constraint create cross current current_date current_time current_timestamp current_user delete distinct drop else exists false following for from full grant group gscluster having ilike in increment inner insert intersect into is join lateral left like localtime localtimestamp minus natural not null of on or order organization qualify regexp revoke right rlike row rows sample select set some start table tablesample then to trigger true try_cast union unique update using values view when whenever where with'
    .toUpperCase()
    .split(' '),
);

// Clause/function keywords that need more tokens after them (class 2).
const clauseKeywords = new Set([
  'except',
  'limit',
  'match_recognize',
  'pivot',
  'unpivot',
  'window',
  'extract',
  'identifier',
  'interval',
  'top',
]);

const scratch = join(os.tmpdir(), 'kwprobe-' + process.pid);
mkdirSync(scratch, { recursive: true });
process.on('exit', () => rmSync(scratch, { recursive: true, force: true }));
const cases = [];
for (const w of words) {
  cases.push({
    word: w,
    slot: 'alias',
    sql: `SELECT * FROM db.schema.t ${w}\n`,
    wantIdentifiers: 4,
  });
  cases.push({ word: w, slot: 'column', sql: `SELECT ${w} FROM t\n`, wantIdentifiers: 2 });
}
cases.forEach((c, i) => {
  c.file = join(scratch, `${i}.sql`);
  writeFileSync(c.file, c.sql);
});

// Batched through `parse -x` (one process for many files, XML output)
// rather than one `parse` process per case — the same pattern
// tools/parse-rate/parse-rate.mjs uses, and for the same reason: 612
// serial process spawns dominate this probe's run time.
const BATCH = 40;
const failures = [];
for (let i = 0; i < cases.length; i += BATCH) {
  const batch = cases.slice(i, i + BATCH);
  const proc = spawnSync(cli, ['parse', '-x', ...batch.map((c) => c.file)], {
    cwd: repo,
    encoding: 'utf8',
    maxBuffer: 1 << 28,
    env: { ...process.env, CC: 'gcc', CXX: 'g++' },
  });
  if (proc.error) {
    throw new Error(`keyword-probe: could not run ${cli}: ${proc.error.message}`);
  }
  const xml = stripAnsi(proc.stdout);
  const chunks = xml.split('<source name="');
  const matched = new Set();
  for (let ci = 1; ci < chunks.length; ci++) {
    const nl = chunks[ci].indexOf('\n');
    const name = chunks[ci].slice(0, nl).replace(/"?>?$/, '');
    const body = chunks[ci].slice(nl);
    const c =
      batch.find((f) => f.file === name) ||
      batch.find((f) => name.replace(/\\/g, '/').endsWith(f.file.replace(/\\/g, '/')));
    if (!c) {
      throw new Error(
        `keyword-probe: could not match XML <source name="${name}"> to a case in this batch`,
      );
    }
    matched.add(c);
    const err = /ERROR|MISSING/.test(body);
    const ids = (body.match(/<identifier[ >]/g) || []).length;
    if (err || ids !== c.wantIdentifiers) {
      failures.push({
        ...c,
        err,
        ids,
        expected: reserved.has(c.word.toUpperCase()) || clauseKeywords.has(c.word),
      });
    }
  }
  // A CLI or grammar-load failure can exit non-zero with empty stdout
  // (0 chunks) while still not throwing above — a batch that silently
  // matched fewer cases than it was given is a false pass, not a clean
  // run, even though a parse ERROR/MISSING batch is expected to exit
  // non-zero and must not be flagged here.
  if (matched.size !== batch.length) {
    throw new Error(
      `keyword-probe: only matched ${matched.size}/${batch.length} cases in batch starting at index ${i} — the CLI likely failed to run (check gcc/CC and the grammar build)`,
    );
  }
}

const regressions = failures.filter((f) => !f.expected);
console.log(`probed ${cases.length} cases (${words.length} keywords x 2 slots)`);
console.log(
  `failures: ${failures.length}, all in the documented reserved/clause-keyword classes: ${regressions.length === 0}`,
);
for (const r of regressions) {
  console.log(
    `  REGRESSION [${r.slot}] ${r.word}  err=${r.err} identifiers=${r.ids}/${r.wantIdentifiers}`,
  );
}
process.exit(regressions.length ? 1 : 0);
