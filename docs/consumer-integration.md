# Consumer integration

This public project provides a Snowflake SQL grammar for editors, source-analysis tools,
linters, and parser test harnesses. The companion
[`snowflake-bodies`](../snowflake-bodies/README.md) crate provides foreign-language body
extraction, position mapping, parsing, and advisory restriction checks. Consumers implement
their own dialect selection, structural profiles, masking, and metric attribution.

## Structural analysis

Configure a Snowflake profile using the grammar's named nodes:

| Purpose | Node kinds |
|---|---|
| Procedure and function definitions | `create_procedure`, `create_function`, `alter_procedure`, `alter_function` |
| Control-flow constructs | `if_statement`, `elseif_clause`, `case_statement`, `while_statement`, `for_statement`, `repeat_statement`, `loop_statement`, `exception_handler` |
| Routine name | `object_reference`, available through the definition's `name` field |
| Parameters | `function_arguments` |
| Body | `function_body`, available through the definition's `body` field |
| Declared language | `sql_language` or `foreign_language`, available through the definition's `language` field when present |

Choose which control-flow constructs contribute to each metric according to your tool's
definition of complexity. Snowflake SQL has no closure form. Match node kinds and fields
against the committed `src/node-types.json` rather than assuming another SQL grammar's
traversal rules apply unchanged.

## Comment and string masking

Tools that distinguish code, comments, and string contents need Snowflake-specific lexical
handling:

- `//` and `--` start line comments; `/* ... */` delimits block comments.
- `$$ ... $$` delimits literal content that can span lines and contain quotes and backslashes.
- Single-quoted strings support doubled apostrophes and backslash escapes.

For a foreign-language handler, apply the embedded language's masking rules to the decoded
body source, then map findings back to the SQL file. Treating the entire handler as a SQL
string hides its identifiers and comments; applying SQL lexical rules to it can misclassify
them. If the embedded language is unsupported, report that analysis gap explicitly.

Test the dialect-specific lookup as well as the masking implementation: a correct masking
mode does not help if `.sql` files still reach a different dialect's mode.

## Differential parser testing

Tools with their own SQL parser can use this grammar as a development-time comparison parser.
Parse the same synthetic corpus with both implementations and compare statement boundaries,
syntax errors, and selected structural nodes. Investigate disagreements against Snowflake's
syntax reference; agreement between two parsers alone does not establish runtime validity.

This approach does not require using tree-sitter as the tool's runtime parser. A formatter
can retain its own lossless syntax tree, comment handling, and recovery rules while using
this grammar to expand its regression coverage.

## Dialect selection

The `.sql` extension does not distinguish Snowflake from other SQL dialects. Use explicit
configuration rather than guessing from keywords. For repositories containing several dialects,
a per-path glob mapping can select Snowflake for `warehouse/**/*.sql` while preserving the
tool's existing default elsewhere. A single-dialect repository can use one catch-all mapping.

Define pattern precedence and unmatched-path behavior in the consuming tool. Ensure that
parser selection, structural analysis, and masking all use the same resolved dialect.

## Foreign-language bodies

Use `snowflake_bodies::Analyzer` to obtain reconstructed source and embedded trees. Reuse the
analyzer across files, and inspect both `Analysis::sql_errors` and each `Body::status`:

- `Parsed` means the embedded syntax parsed successfully.
- `UnavailableLanguage` retains decoded source but has no embedded tree.
- `InvalidBody` retains a partial embedded tree and mapped syntax errors.
- `InvalidSql` or `InvalidEncoding` prevents reliable body reconstruction.

Malformed SQL can prevent a routine from being extracted at all, so checking body statuses
alone is insufficient. SQL-language bodies remain in the SQL tree and are not returned as
foreign-language bodies.

JavaScript and Python parsers are included in the companion crate. Enable its `java` or
`scala` features when those parsers are needed. The crate does not calculate complexity or
implement vocabulary masking. Its queries and rule catalog are reusable independently;
see its README for detection limits and supported escape forms.

### Body text and source positions

The two delimiter forms require different handling:

- **Dollar-quoted foreign bodies (`dollar_quoted_body`).** The `body_content` node excludes
  the delimiters and contains verbatim embedded source. `queries/injections.scm` exposes this
  content to editor hosts. The related `dollar_quoted_script` and `dollar_quoted_expression`
  nodes contain SQL parsed by the Snowflake grammar.
- **Single-quoted bodies (`string_body`).** The SQL text must be decoded before parsing the
  embedded language. A doubled apostrophe represents one apostrophe; backslash escapes can
  also change the text's length. Numeric escapes can span an `escape` node and the following
  `body_content` node, so decoding each child independently is insufficient. The companion
  reconstructs the text and records its mapping back to the original SQL source.

Embedded tree ranges refer to decoded UTF-8 text. Translate them through
`BodySource::source_range`, then use `source_point` on the original SQL text to obtain a
zero-based row and byte column. `Body::findings` already contains absolute SQL ranges.
Tree-sitter injection queries alone cannot decode the single-quoted form.

### Measurement attribution

Measure a handler with its embedded language's structural profile, and attribute that
measurement to the enclosing routine and SQL file exactly once. Counting it again as a
separate language-file total inflates aggregate metrics and can duplicate findings.

Unavailable or invalid bodies are unmeasured, not measured at zero. Preserve that distinction
in reports so an unsupported handler cannot appear to be an empty, low-complexity routine.

## Node kinds are the public API

Consumers often compare node-kind strings at runtime. Renaming or removing a node can therefore
compile successfully while silently changing analysis results. `test/node-kinds.txt` is the
committed, CI-checked snapshot; a node rename or removal requires a major version bump.

After upgrading, run `node tools/node-kinds.mjs` and compare the output with the previous
release's snapshot before updating a structural profile.

## Before adopting a release

Build against the exact tree-sitter version your application uses, and run your own fixtures
before adopting a release. The grammar package's runtime dependency is `tree-sitter-language`;
its `tree-sitter` dependency is used only for development and tests.

The companion supports tree-sitter `>=0.26, <0.28`. Applications exchanging its trees must
resolve the same tree-sitter version. The verification workflow tests 0.27 and separately pins
both workspace members to 0.26 to keep that declared floor honest — not because a consumer
resolves 0.26 today. The generated grammar uses ABI 15, accepted by both versions.

The npm `tree-sitter` runtime binding has a separate version line from the Rust `tree-sitter`
crate and the npm `tree-sitter-cli` package. Consult each package's manifest when selecting
compatible versions; matching version numbers across all three is not required.
