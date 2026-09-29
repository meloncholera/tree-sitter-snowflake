import { paren_list, comma_list, wrapped_in_parenthesis } from './helpers.js';

export default {
  _expression: ($) =>
    prec(
      1,
      choice(
        $.literal,
        alias($._qualified_field, $.field),
        $.case,
        $.window_function,
        $.subquery,
        $.cast,
        $.cast_expression,
        $.extract_expression,
        $.lambda_expression,
        $.exists,
        $.invocation,
        $.binary_expression,
        $.unary_expression,
        $.between_expression,
        $.parenthesized_expression,
        $.array_constructor,
        $.semi_structured,
        $.bind_variable,
        $.identifier_function,
      ),
    ),

  // IDENTIFIER($name) / IDENTIFIER(:bind) — an object name resolved at
  // runtime from a session variable or bind. Its own node because the
  // argument is a variable, never an ordinary expression.
  identifier_function: ($) =>
    seq($.keyword_identifier, paren_list(choice($.identifier, $.bind_variable), true)),

  // A named bind or scripting variable reference: :1, :name.
  bind_variable: ($) =>
    prec(1, seq(':', choice($.identifier, alias($._natural_number, $.literal)))),

  // [ expr, expr, ... ] — Snowflake's ARRAY literal. At expression start
  // the bracket is unambiguous with the subscript operator, which always
  // follows an expression.
  array_constructor: ($) => prec(1, seq('[', optional(comma_list($._expression, true)), ']')),

  // v:field.subfield, v['key'], v:"quoted key", v:field[0].sub
  // The `:` path operator and the subscript on a semi-structured value,
  // bound tighter than every other operator so a cast or comparison applies
  // to the whole path, not the head.
  cast_expression: ($) =>
    prec.left('postfix', seq(field('value', $._expression), '::', field('type', $._type))),

  semi_structured: ($) =>
    prec.left(
      'postfix',
      seq(
        field('value', $._expression),
        repeat1(
          choice(
            seq(':', $._semi_structured_key),
            seq('.', $._semi_structured_key),
            seq('[', choice($._expression, alias($._single_quote_string, $.literal)), ']'),
          ),
        ),
      ),
    ),

  // A path key: an identifier, a quoted identifier, or a single-quoted
  // string. The double-quoted spelling stays a hidden token rather than
  // an alias — aliasing it to `identifier` makes the path element
  // ambiguous with a fresh identifier in the enclosing expression.
  _semi_structured_key: ($) =>
    choice($.identifier, $._double_quoted_identifier, alias($._single_quote_string, $.literal)),

  // Up to three parts: database.schema.name.
  object_reference: ($) =>
    choice(
      seq(
        field('database', $.identifier),
        '.',
        field('schema', $.identifier),
        '.',
        field('name', $.identifier),
      ),
      seq(field('schema', $.identifier), '.', field('name', $.identifier)),
      field('name', $.identifier),
    ),

  field: ($) => field('name', $.identifier),

  // t.col or col. Snowflake has no parenthesized-qualifier spelling
  // (`(t).col` is PostgreSQL's, not Snowflake's), and allowing one puts a
  // prec.right `)` right where a plain parenthesized expression has to
  // reduce — every `WHERE (x)` and `GROUP BY (x)` then parsed as a
  // qualifier waiting for its `.` and died on the next clause.
  _qualified_field: ($) => seq(optional(seq($.object_reference, '.')), field('name', $.identifier)),

  // CASE input WHEN value THEN result ... [ELSE result] END
  // CASE WHEN predicate THEN result ... [ELSE result] END
  case: ($) =>
    seq(
      $.keyword_case,
      optional(field('input', $._expression)),
      repeat1($.when_clause),
      optional(seq($.keyword_else, field('else', $._expression))),
      $.keyword_end,
    ),

  when_clause: ($) =>
    seq(
      $.keyword_when,
      field('condition', $._expression),
      $.keyword_then,
      field('result', $._expression),
    ),

  // x -> expr, (x, y) -> expr — the lambda TRANSFORM, FILTER and REDUCE
  // take. No precedence of its own: a number here (or prec.right, the
  // first attempt) statically wins the shift of `)` after `(name)` and
  // kills every plain parenthesized single-column expression — `WHERE
  // (dept)` — because the reduce that would build the parenthesized
  // expression carries lower precedence. At equal precedence the fork is
  // real and declared in grammar.js against parenthesized_expression.
  lambda_expression: ($) =>
    seq(
      choice($.identifier, wrapped_in_parenthesis(comma_list($.lambda_parameter, true))),
      '->',
      field('body', $._expression),
    ),

  // x [INT] — a lambda argument, optionally typed (REDUCE's typed
  // examples: (acc INT, val INT) -> ...).
  lambda_parameter: ($) => seq(field('name', $.identifier), optional($._type)),

  // EXTRACT(part FROM expr) — the field-from-datetime function, whose
  // FROM inside the argument list an ordinary invocation cannot parse.
  extract_expression: ($) =>
    seq(
      $.keyword_extract,
      wrapped_in_parenthesis(
        seq(
          choice($.identifier, alias($._single_quote_string, $.literal)),
          $.keyword_from,
          field('parameter', $._expression),
        ),
      ),
    ),

  // CAST(x AS type) and TRY_CAST(x AS type). The `::` operator is
  // cast_expression above.
  cast: ($) =>
    seq(
      field('name', choice($.keyword_cast, $.keyword_try_cast)),
      wrapped_in_parenthesis(seq(field('parameter', $._expression), $.keyword_as, $._type)),
    ),

  exists: ($) => seq($.keyword_exists, $.subquery),

  // name(args). Arguments may be positional expressions or named
  // (name => value); DISTINCT is accepted before the list, and an ordered
  // aggregate takes WITHIN GROUP (ORDER BY ...) after it.
  invocation: ($) =>
    prec(
      1,
      seq(
        $.object_reference,
        wrapped_in_parenthesis(
          comma_list(
            choice(
              seq(
                optional($.keyword_distinct),
                field('parameter', choice($._expression, $.all_fields, $.keyword_default)),
              ),
              $.named_argument,
            ),
          ),
        ),
        optional(seq($.keyword_within, $.keyword_group, wrapped_in_parenthesis($.order_by))),
      ),
    ),

  // name => value — Snowflake's named-argument syntax for calls such as
  // FLATTEN(INPUT => v) or TASK stored procedures.
  named_argument: ($) => seq(field('name', $.identifier), '=>', field('value', $._expression)),

  parenthesized_expression: ($) => prec(2, wrapped_in_parenthesis($._expression)),

  op_concat: (_) => token('||'),
  op_other: (_) => token(choice('|', '&')),

  binary_expression: ($) =>
    choice(
      ...[
        ['+', 'binary_plus'],
        ['-', 'binary_plus'],
        [$.op_concat, 'binary_plus'],
        ['*', 'binary_times'],
        ['/', 'binary_times'],
        ['%', 'binary_times'],
        ['=', 'binary_relation'],
        ['<', 'binary_relation'],
        ['<=', 'binary_relation'],
        ['!=', 'binary_relation'],
        ['>=', 'binary_relation'],
        ['>', 'binary_relation'],
        ['<>', 'binary_relation'],
        [$.op_other, 'binary_other'],
        [$.keyword_is, 'binary_is'],
        [$.is_not, 'binary_is'],
        [$.keyword_collate, 'postfix'],
        [$.keyword_like, 'pattern_matching'],
        [$.keyword_ilike, 'pattern_matching'],
        [$.keyword_regexp, 'pattern_matching'],
        [$.keyword_rlike, 'pattern_matching'],
        [$.not_like, 'pattern_matching'],
        [$.not_ilike, 'pattern_matching'],
        [$.not_regexp, 'pattern_matching'],
        [$.not_rlike, 'pattern_matching'],
        [$.distinct_from, 'binary_is'],
        [$.not_distinct_from, 'binary_is'],
      ].map(([operator, precedence]) =>
        prec.left(
          precedence,
          seq(
            field('left', $._expression),
            field('operator', operator),
            field('right', $._expression),
          ),
        ),
      ),
      ...[
        [$.keyword_and, 'clause_connective'],
        [$.keyword_or, 'clause_disjunctive'],
      ].map(([operator, precedence]) =>
        prec.left(
          precedence,
          seq(
            field('left', $._expression),
            field('operator', operator),
            field('right', $._expression),
          ),
        ),
      ),
      ...[
        [$.keyword_in, 'binary_in'],
        [$.not_in, 'binary_in'],
      ].map(([operator, precedence]) =>
        prec.left(
          precedence,
          seq(
            field('left', $._expression),
            field('operator', operator),
            field('right', choice($.list, $.subquery)),
          ),
        ),
      ),
    ),

  unary_expression: ($) =>
    choice(
      ...[
        [$.keyword_not, 'unary_not'],
        ['-', 'unary_sign'],
        ['+', 'unary_sign'],
      ].map(([operator, precedence]) =>
        prec.left(precedence, seq(field('operator', operator), field('operand', $._expression))),
      ),
    ),

  between_expression: ($) =>
    choice(
      ...[
        [$.keyword_between, 'between'],
        [seq($.keyword_not, $.keyword_between), 'between'],
      ].map(([operator, precedence]) =>
        prec.left(
          precedence,
          seq(
            field('left', $._expression),
            field('operator', operator),
            field('low', $._expression),
            $.keyword_and,
            field('high', $._expression),
          ),
        ),
      ),
    ),

  not_in: ($) => seq($.keyword_not, $.keyword_in),
  not_like: ($) => seq($.keyword_not, $.keyword_like),
  not_ilike: ($) => seq($.keyword_not, $.keyword_ilike),
  not_regexp: ($) => seq($.keyword_not, $.keyword_regexp),
  not_rlike: ($) => seq($.keyword_not, $.keyword_rlike),
  is_not: ($) => prec.left('binary_is', seq($.keyword_is, $.keyword_not)),
  distinct_from: ($) => seq($.keyword_is, $.keyword_distinct, $.keyword_from),
  not_distinct_from: ($) => seq($.keyword_is, $.keyword_not, $.keyword_distinct, $.keyword_from),

  subquery: ($) => wrapped_in_parenthesis($._dml_read),

  list: ($) => paren_list($._expression),

  literal: ($) =>
    prec(
      2,
      choice(
        $._integer,
        $._decimal_number,
        alias($._single_quote_string, $.literal),
        alias($._dollar_quoted_string, $.literal),
        $.keyword_null,
        $.keyword_true,
        $.keyword_false,
        $.interval,
        '?',
      ),
    ),

  // $$ content $$ — the ordinary dollar-quoted string constant, valid
  // anywhere a string literal is. The three tokens come from the external
  // scanner; the content is optional so `$$ $$` (the empty string)
  // parses.
  _dollar_quoted_string: ($) =>
    seq($._dollar_quote_start, optional($._dollar_quote_content), $._dollar_quote_end),

  // INTERVAL '1 day' / INTERVAL 1 day — the SQL interval literal, which
  // may be written as one quoted string or a number with a unit word.
  interval: ($) =>
    seq(
      $.keyword_interval,
      choice(
        alias($._single_quote_string, $.literal),
        seq(alias($._natural_number, $.literal), $.identifier),
      ),
    ),

  _natural_number: (_) => /\d+/,
  // Decimal and hexadecimal integers.
  _integer: (_) => /(0[xX][0-9A-Fa-f]*)|(\d+)/,
  _decimal_number: (_) => /((\d+\.\d*|\.\d+)([eE][+-]?\d+)?)|(\d+[eE][+-]?\d+)/,

  // Character string. A quote inside is doubled ('') or backslash-escaped;
  // Snowflake accepts both, so the lexer takes either.
  _single_quote_string: (_) => /'([^'\\]|\\.|'')*'/,

  identifier: ($) =>
    choice(
      $._identifier,
      $._double_quoted_identifier,
      $._session_variable,
      $._positional_reference,
    ),
  // A regular unquoted identifier: letters, then letters, digits, `_` and
  // `$` (Snowflake allows `$` anywhere after the first character).
  _identifier: (_) => /[A-Za-z_][0-9A-Za-z_$]*/,
  // "quoted identifier" — a delimited identifier with "" doubling.
  _double_quoted_identifier: (_) => /"([^"]|"")*"/,

  // A session variable reference: $var.
  _session_variable: (_) => /\$[A-Za-z_][0-9A-Za-z_$]*/,
  // A staged-file positional column: $1, $2, ... — `SELECT $1 FROM
  // @stage/file` names the file's Nth column.
  _positional_reference: (_) => /\$[0-9]+/,

  // A stage or path reference: @stage, @db.schema.stage/path, @%table,
  // @~, or a stage-relative path. One token because the internal dots and
  // slashes are not identifier separators.
  stage_reference: (_) => /@[%~]?[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*([\/][^\s'",;)\]]*)?/,

  // file://path — the local-file operand of PUT and GET, written unquoted
  // (the common form) or as a quoted string. One token for the same
  // reason as stage_reference: the slashes are not separators.
  _file_uri: (_) => /file:\/\/[^\s';]+/,
};
