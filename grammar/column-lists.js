import { comma_list, paren_list, wrapped_in_parenthesis } from './helpers.js';

// Column definitions, constraints and option lists, shared by CREATE
// TABLE, ALTER TABLE ... ADD, and the option-driven DDL (stages, tasks,
// warehouses, file formats, copy options, session parameters).
export default {
  _column_list: ($) => paren_list(alias($._column, $.column), true),

  _column: ($) => $.identifier,

  // ( column | constraint [, ...] ) — a table-level constraint may appear
  // anywhere in the list, between columns as well as at the end.
  column_definitions: ($) => paren_list(choice($.column_definition, $.table_constraint), true),

  // name [type] [constraint ...] — the type is optional so the same rule
  // covers a CTAS column list (`CREATE TABLE t (a, b) AS SELECT ...`),
  // where Snowflake takes the types from the query.
  column_definition: ($) =>
    prec.left(
      seq(field('name', $._column), optional(field('type', $._type)), repeat($._column_constraint)),
    ),

  _column_constraint: ($) =>
    prec.right(
      choice(
        $.keyword_null,
        $._not_null,
        seq(
          optional(seq($.keyword_constraint, field('name', $.identifier))),
          choice(
            seq($.keyword_default, $._expression),
            seq(
              choice(
                seq($.keyword_primary, $.keyword_key),
                $.keyword_unique,
                seq($.keyword_foreign, $.keyword_key),
              ),
              optional(wrapped_in_parenthesis(comma_list($.identifier, true))),
              optional($.referential_clause),
            ),
          ),
        ),
        seq(
          $.keyword_autoincrement,
          optional(
            wrapped_in_parenthesis(
              seq(field('start', $._expression), ',', field('increment', $._expression)),
            ),
          ),
          // START 1 INCREMENT 1 NOORDER — the bare sequence-parameter
          // spelling autoincrement columns take.
          repeat(
            choice(
              seq($.keyword_start, alias($._natural_number, $.literal)),
              seq($.keyword_increment, alias($._natural_number, $.literal)),
              $.identifier,
            ),
          ),
        ),
        seq($.keyword_collate, alias($._single_quote_string, $.literal)),
        seq($.keyword_comment, alias($._single_quote_string, $.literal)),
        // AS (expr) — the virtual (computed) column, which follows the type.
        seq($.keyword_as, field('expression', wrapped_in_parenthesis($._expression))),
        seq(
          $.keyword_masking,
          $.keyword_policy,
          $.object_reference,
          optional(seq($.keyword_using, paren_list($.identifier, true))),
        ),
        seq($.keyword_with, $.keyword_tag, paren_list($.tag_assignment, true)),
        $.keyword_not_enforced,
      ),
    ),

  _not_null: ($) => seq($.keyword_not, $.keyword_null),

  keyword_not_enforced: ($) => seq($.keyword_not, $.keyword_enforced),

  // REFERENCES t [(cols)] [[NOT] ENFORCED] [RELY | NORELY]
  // Snowflake accepts and ignores referential constraints; it never
  // enforces them, and CHECK constraints are not part of the dialect at
  // all, so they are deliberately absent. prec.right keeps the trailing
  // ENFORCED/RELY suffixes with the clause.
  referential_clause: ($) =>
    prec.right(
      seq(
        $.keyword_references,
        $.object_reference,
        optional(paren_list($.identifier, true)),
        optional($.keyword_not_enforced),
        optional(choice($.keyword_rely, seq($.keyword_no, $.keyword_rely))),
      ),
    ),

  // Table-level constraint, also the shape ALTER TABLE ... ADD accepts.
  table_constraint: ($) =>
    prec.right(
      seq(
        optional(seq($.keyword_constraint, field('name', $.identifier))),
        choice(
          seq(
            choice(seq($.keyword_primary, $.keyword_key), $.keyword_unique),
            paren_list($.identifier, true),
            optional($.keyword_not_enforced),
            optional(choice($.keyword_rely, seq($.keyword_no, $.keyword_rely))),
          ),
          seq(
            $.keyword_foreign,
            $.keyword_key,
            paren_list($.identifier, true),
            $.referential_clause,
          ),
          seq($.keyword_check, wrapped_in_parenthesis($._expression)),
        ),
      ),
    ),

  tag_assignment: ($) =>
    seq(field('name', $.identifier), '=', alias($._single_quote_string, $.literal)),

  // The option list most Snowflake DDL takes, parenthesized:
  // `COPY_OPTIONS = (ON_ERROR = 'ABORT', PURGE = TRUE)` or a file
  // format's `(TYPE = CSV FIELD_DELIMITER = '|', SKIP_HEADER = 1)` — the
  // separator inside the parentheses is a space, a comma, or both, so the
  // comma is optional rather than the join. Option names are identifiers —
  // Snowflake has hundreds across warehouses, tasks, stages, file formats,
  // copy options and session parameters, and nothing downstream needs them
  // distinguished.
  _paren_options: ($) =>
    wrapped_in_parenthesis(seq($.option, repeat(seq(optional(','), $.option)))),

  // The bare, unparenthesized spelling the warehouse/task/stage DDL uses:
  // `WAREHOUSE_SIZE = 'XSMALL' AUTO_RESUME = TRUE`.
  with_clause: ($) => prec.right(seq(optional($.keyword_with), repeat1($.option))),

  option: ($) =>
    prec.right(
      seq(
        field('name', $.identifier),
        optional(
          choice(
            seq('=', field('value', $._option_value)),
            $._paren_options,
            seq('=', $._paren_options),
          ),
        ),
      ),
    ),

  _option_value: ($) =>
    prec.right(
      choice(
        seq(
          // object_reference covers single- and multi-part names alike; a
          // separate identifier alternative here would fork every dotted
          // option value (FILE_FORMAT = db.schema.FF1) into a reduce/shift
          // conflict.
          choice($.keyword_on, $.keyword_off, $.object_reference),
          optional($._paren_options),
        ),
        $.literal,
        // ('a', 'b', ...) — a parenthesized literal list, e.g. a storage
        // integration's STORAGE_ALLOWED_LOCATIONS or a UDF's PACKAGES.
        wrapped_in_parenthesis(comma_list($.literal, true)),
      ),
    ),
};
