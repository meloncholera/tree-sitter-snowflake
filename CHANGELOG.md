# Changelog

All notable changes to this project will be documented in this file.

## [0.2.0](https://github.com/meloncholic/tree-sitter-snowflake/compare/v0.1.1...v0.2.0) - 2026-09-26

### Fixed

- *(tools)* validate batch exit status and per-file match count in parse-rate ([#26](https://github.com/meloncholic/tree-sitter-snowflake/pull/26))
- *(snowflake-bodies)* make rule IDs a compile-time check and close test gaps
- *(linguist)* mark generated grammar JSON as linguist-generated ([#24](https://github.com/meloncholic/tree-sitter-snowflake/pull/24))
- *(tooling)* hash the leak guard's needle list and fix CI cost and correctness gaps
- *(grammar)* [**breaking**] correct operator precedence, quoted stage paths, and grammar duplication
- *(release)* send a User-Agent header on the crates.io publish check ([#20](https://github.com/meloncholic/tree-sitter-snowflake/pull/20))

### Other

- sync dev from main ([#19](https://github.com/meloncholic/tree-sitter-snowflake/pull/19))
- *(deps)* bump actions/upload-artifact

## [0.1.1](https://github.com/meloncholic/tree-sitter-snowflake/compare/v0.1.0...v0.1.1) - 2026-09-26

### Fixed

- *(release)* validate release artifacts and repair Node metadata

### Other

- remove .npmrc from the tree ([#16](https://github.com/meloncholic/tree-sitter-snowflake/pull/16))
- scope gitattributes and editorconfig to tracked file types ([#15](https://github.com/meloncholic/tree-sitter-snowflake/pull/15))
- sync .gitattributes and .editorconfig with org template ([#14](https://github.com/meloncholic/tree-sitter-snowflake/pull/14))
- harden release and verification workflows ([#10](https://github.com/meloncholic/tree-sitter-snowflake/pull/10))

## 0.1.0

- Initial public release of the Snowflake SQL grammar.
