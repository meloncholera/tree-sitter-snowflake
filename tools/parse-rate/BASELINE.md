# Parse-rate baseline

The parse-rate budget: a committed record of the error rate over real
Snowflake sources, re-measured whenever the grammar changes. The ratio of
`ERROR` and `MISSING` nodes must stay at or below the recorded baseline —
the baseline only ratchets down.

The source corpora are private (they carry real database, schema, table and
column names), so they are provided locally and only the resulting numbers
are committed. An outside contributor cannot reproduce this check; that is
an accepted trade for a grammar written for in-house tooling.

## How to measure

```bash
node tools/parse-rate/parse-rate.mjs <path-to-corpus>   # add --json for per-file data
```

## Baseline (2026-09-08)

| Corpus | Files | Error-free | Bytes in errors |
|---|---|---|---|
| `snowflake` | 823 | 821 (99.8%) | 0.0% |
| `snowflake-dw` | 162 | 162 (100%) | 0.0% |

The two failing `snowflake` files contain a Streamlit `root_location='...`
string literal that is genuinely unterminated in the source; erroring on
them is correct behavior, not a grammar gap.

### Pre-fork reference (2026-09-02, `tree-sitter-sequel-tsql` 0.4.2)

| Corpus | Error-free | Bytes in errors |
|---|---|---|
| `snowflake` | 0.1% | 59.3% |
| `snowflake-dw` | 17.4% | 23.4% |
