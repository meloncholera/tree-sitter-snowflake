#!/usr/bin/env node
// Leak grep: asserts every tracked text file (except this tool) contains
// none of the real identifiers, names, and paths observed in the source
// repositories the fixture shapes were mined from. Run whenever a fixture
// is added or edited. A hit means the scrub failed; fix the source file,
// not this list.
//
// The repository is public, so the needle list stores SHA-256 hashes of
// each real identifier instead of the plaintext — the guard itself must
// not be the thing that discloses what it exists to keep out. A scanned
// file is tokenized into words, and every contiguous 1-, 2-, and 3-word
// run (joined with `_`, matching how the source identifiers are spelled)
// is hashed and checked against the needle set, so a needle spelled
// `acme_bank` in the source is caught whether a scanned file spells it
// `acme_bank` or `acme bank`; a single word out of a multi-word needle
// (a bare `acme`) is not, by itself, a hash the needle set contains.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const repo = fileURLToPath(new URL('..', import.meta.url));
const self = fileURLToPath(import.meta.url);

// Real names observed in the source corpora, stored as SHA-256 hashes of
// the lowercase identifier: databases, schemas, warehouses, roles,
// integrations, storage accounts, business and vendor words. Generic
// Snowflake/system vocabulary (SYSADMIN, INFORMATION_SCHEMA,
// CURRENT_TIMESTAMP, ...) is deliberately absent.
//
// Five of the original plaintext needles were bare, everyday English
// words (live, dev, test, locally, reporting) that this file's own
// prose, and the repo's docs and workflow YAML, use constantly with no
// connection to the private corpus. A repo-wide scan against them is
// pure noise: measured against this checkout, they fired 39 times with
// zero real leaks, while every multi-word or proper-noun needle fired
// zero times outside the fixtures they were mined from. Those five stay
// scoped to `test/fixtures/*.sql`, the same narrow scope this check
// always ran in; every other needle now runs against the whole
// repository.
const fixtureOnlyNeedleHashes = new Set([
  '247610f4dedd4ab7247d07dbda19c81ca9817f85820742cad49d407ffae9e4ed', // live
  'ef260e9aa3c673af240d17a2660480361a8e081d1ffeca2a5ed0e3219fc18567', // dev
  '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08', // test
  '6f1eb246f9c696c2949931afafec18fea76beb0210d240f5baccbbd9a076a2f2', // locally
  '637d7becb9983937d58f53af972dc87373f3b7a2010cfb6805880f1463fcef8d', // reporting
]);

const broadNeedleHashes = new Set([
  '3f76c910dbcc58fe67879927204fd2d8477d1b72c51d151456573955af32e993',
  'cb3bf2a589f9d3889fefc40933fb919364b99bc171fbf29f97b8f0f916cf34cd',
  '2896cc1b4204c7e64482f8c1726321dd0f12ef8f3f8f68bebfddbac53d7e08b0',
  '3ccbd9105a45d8fcd4a0101c6532c599f6f59cfa4d4ce378792f547a869a4bea',
  '18097e8d7df0996b560a3ee081e6f167bf3b9273528ba2b73ae5bbd7cff0966c',
  'd60d9195446fb1f38074df3791cd0d915b085ad2e43ac6f15d9768dd04c3793e',
  '47fb98ae08563b05d63cfaf1c84f4144b0de753be03e853ce371dc8ab297d5b8',
  '8265324164adf2e9aa3b46be993ae04938ec3ae0645386ed23d5b50c34578a50',
  '9261ceef0b969e70ac20f1510f07a1e0d8db05f20c75161a2ef43b4eba27a7aa',
  '2206dbc62ccfa17b531e8d4d581677e0ec6452655c6b88140aa604a78d300418',
  '2aa46ef834e8d2f453daaa22b0cd6a0d1be923c594d228e6ffba4ca5a58bfe75',
  'c90b8be5faa8b23fd44205e4125d0f0d9c64a497195c80dd03389ae774e37511',
  '1a75b9283430e98d53a31bb858237c5eec0ba8a7099f174e8fdbd09c4b21f2ba',
  'b32b06f9b780175417f1c965b42c98a13739a255542d8420cd5c11919bf9e3b7',
  '1d43cb5b990e3f23fcfd909fd4d53eb4e8c4760c81c2aa834f9f45305ebb57b5',
  '16f3c31b44437bea8174fe8b58089e9c93776192b7d1b0e7aa7224f76f2bad63',
  '54ab8d0ee559f623c7fb5733dcfeb6803d00f8c578844bfc9a1361902a45ec50',
  '0210c955f797c3a03252d1fc703cd7ec5f3f6b97dac17a05cb1307ac43cff9d6',
  'b6f8d434a847fb0f0c1a8d9b936b8ca952e224f205a55f4ba9b2c20f88fdc9e7',
  '6a0da33e42e56de46a7f6a9e99c6ac4d6fbc9960a1941d10c17df8a6c61cc62f',
  '1677da7b371dc2f6791b1412b8cc7b42ecf1af4d748f3ee7f2f033595a94fba8',
  '0bc0719c5438725728bfc2ba833965a6be8f91613c95e916c00241d3b9e7b4ec',
  '0a47bef46ece8828ffa954afd1ef72e5b8b42db9cba5638cda6ba17efc7ecc63',
  'f76b51304e5ed1299588aac5dada57bde927c0d5de7b44c7b35c345aaecaa945',
  '3045099a9cd6cf1cd05761f7c6ef9b0559783f92f816cfb22d1e2f75cb0c39cf',
  '3fd3b6d511e349cc23fdd2fd4420f38b1fd3a4f25bd0abe40b468354a619752c',
  '45c06a24fbd885eb1d794a65eb66b953a4386564bd9cd249938e38834e703912',
  'd2a3bc0f5af77babd12b5aeb5e56e816c1e4d5bb779e5490cb1aa6b781b9113c',
  '3abdae75474b462a562c568bb6df620ff7d53edab8cd23747872597081e55145',
  '8a2e8f546c1e162f225c719e4ccfb75fd3050cd0bcfba9e218e19c9f48f8da26',
  'faa3e7730b54ea48eff4c3910c23d1f159fa84a4b62dd0a9be30c30df27a6f49',
  '9496dbbccc74f488afee54ddaed73817ab0ef6b80ab68265778979eda1aa6889',
  'b695de9bcecc68416fbbc357f0468d8af023dc3f2527acf896fdac0168418310',
  'a55b0caa960a1e32f76b4de9546027597eb3602c807637f5912cd834f16336aa',
  '51246a5d9ba657e6de7e1dbba573bcb35f298184453f932c62402c4f76248f23',
]);

// Generated files (regenerated wholesale from grammar/ source on every
// `tree-sitter generate`) and dependency lockfiles carry no authored
// content of their own, so scanning them only spends time re-checking
// text this tool already covers via its source, or vendored dependency
// metadata that was never derived from the private corpus.
const skip = new Set([
  'src/parser.c',
  'src/grammar.json',
  'src/node-types.json',
  'package-lock.json',
  'Cargo.lock',
]);

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

function isBinary(buffer) {
  return buffer.subarray(0, 8000).includes(0);
}

function ngramHashes(text) {
  const words = text.toLowerCase().match(/[a-z0-9]+/g) || [];
  const hashes = new Set();
  for (let n = 1; n <= 3; n++) {
    for (let i = 0; i + n <= words.length; i++) {
      hashes.add(sha256(words.slice(i, i + n).join('_')));
    }
  }
  return hashes;
}

const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: repo, encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);

let hits = 0;
let scanned = 0;
for (const relPath of tracked) {
  if (skip.has(relPath)) continue;
  const fullPath = join(repo, relPath);
  if (fullPath === self) continue;
  const stat = statSync(fullPath, { throwIfNoEntry: false });
  if (!stat || !stat.isFile()) continue;
  const buffer = readFileSync(fullPath);
  if (isBinary(buffer)) continue;
  scanned++;
  const found = ngramHashes(buffer.toString('utf8'));
  const applicable =
    relPath.startsWith('test/fixtures/') && relPath.endsWith('.sql')
      ? [...broadNeedleHashes, ...fixtureOnlyNeedleHashes]
      : broadNeedleHashes;
  for (const hash of applicable) {
    if (found.has(hash)) {
      console.log(`LEAK ${relPath}: matches needle hash ${hash.slice(0, 12)}...`);
      hits++;
    }
  }
}

console.log(
  hits
    ? `${hits} leak(s) found`
    : `clean: ${scanned} tracked files scanned, no source-corpus identifiers`,
);
process.exit(hits ? 1 : 0);
