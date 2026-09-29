import assert from 'node:assert/strict';
import test from 'node:test';
import { decode } from './parse-rate.mjs';
import { Buffer } from 'node:buffer';

const SAMPLE = 'SELECT 1;';

test('decode reads a UTF-8 BOM file', () => {
  const buf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(SAMPLE, 'utf8')]);
  const [encoding, text] = decode(buf);
  assert.equal(encoding, 'utf-8');
  assert.equal(text, SAMPLE);
});

test('decode reads a UTF-16LE BOM file without corrupting it', () => {
  const buf = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(SAMPLE, 'utf16le')]);
  const [encoding, text] = decode(buf);
  assert.equal(encoding, 'utf-16le');
  assert.equal(text, SAMPLE);
});

test('decode reads a UTF-16BE BOM file', () => {
  const le = Buffer.from(SAMPLE, 'utf16le');
  const be = Buffer.from(le);
  be.swap16();
  const buf = Buffer.concat([Buffer.from([0xfe, 0xff]), be]);
  const [encoding, text] = decode(buf);
  assert.equal(encoding, 'utf-16be');
  assert.equal(text, SAMPLE);
});

test('decode reads a BOM-less UTF-16LE file from its NUL-byte shape', () => {
  const padded = SAMPLE + ' '.repeat(64);
  const buf = Buffer.from(padded, 'utf16le');
  const [encoding, text] = decode(buf);
  assert.equal(encoding, 'utf-16le');
  assert.equal(text, padded);
});

test('decode reads a BOM-less UTF-16BE file from its NUL-byte shape', () => {
  const padded = SAMPLE + ' '.repeat(64);
  const buf = Buffer.from(padded, 'utf16le');
  buf.swap16();
  const [encoding, text] = decode(buf);
  assert.equal(encoding, 'utf-16be');
  assert.equal(text, padded);
});

test('decode reads a plain UTF-8 file with no BOM', () => {
  const [encoding, text] = decode(Buffer.from(SAMPLE, 'utf8'));
  assert.equal(encoding, 'utf-8');
  assert.equal(text, SAMPLE);
});
