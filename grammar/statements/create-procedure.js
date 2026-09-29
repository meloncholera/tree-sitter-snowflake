import { paren_list, statement_list } from "../helpers.js";

// A `$$` script: `;`-terminated statements, or a single statement with
// no terminator (the UDF form — the closing delimiter replaces the `;`).
// The two forms are disjoint: a `;` before `$$` fits the list, its
// absence fits the single statement, and neither allows a statement to
// follow one without a separator — which is what keeps statement-initial
// keywords out of the AS-less alias slot.
function dollar_script_body($) {
  return choice(
    statement_list($),
    prec(-1, seq($.statement)),
    seq(),
  )
}

// Snowflake CREATE [OR REPLACE] PROCEDURE and FUNCTION, with bodies in
// both delimiter forms and the declared language gating the body shape.
//
//   CREATE [OR REPLACE] {PROCEDURE | FUNCTION} name (args)
//     [RETURNS type]
//     [LANGUAGE {SQL | JAVASCRIPT | PYTHON | JAVA | SCALA}]
//     [RUNTIME_VERSION = '..'] [IMPORTS = (...)] [PACKAGES = (...)]
//     [HANDLER = '..'] [EXECUTE AS {CALLER | OWNER}] [COMMENT = '']
//     AS <body>
//
// The body is a `function_body` node in one of three shapes, chosen by
// what the parser has already consumed:
//
//   - `dollar_quoted_script` — `$$ ... $$` after LANGUAGE SQL (or no
//     LANGUAGE clause, which means SQL): the content between the
//     delimiters is parsed structurally as Snowflake statements and
//     Snowflake Scripting.
//   - `dollar_quoted_body` — `$$ ... $$` after a foreign LANGUAGE: the
//     content is a single opaque `body_content` node an injected parser
//     can be pointed at.
//   - `string_body` — `AS '...'` in either language: the content is a
//     sequence of `body_content` chunks with every doubled apostrophe and
//     backslash escape visible as its own node, so a consumer can
//     reconstruct the real text and map positions back to the file.
//
// The three names and the `language` field are the public API the
// consumers' profiles key on; renaming any of them is a breaking change.
export default {

  create_procedure: $ => seq(
    $.keyword_create,
    optional($._or_replace),
    $._procedure_definition,
  ),

  alter_procedure: $ => seq(
    $.keyword_alter,
    $._procedure_definition,
  ),

  create_function: $ => seq(
    $.keyword_create,
    optional($._or_replace),
    $._function_definition,
  ),

  alter_function: $ => seq(
    $.keyword_alter,
    $._function_definition,
  ),

  _procedure_definition: $ => seq(
    $.keyword_procedure,
    field('name', $.object_reference),
    $.function_arguments,
    $.keyword_returns,
    $._type,
    choice(
      // LANGUAGE SQL (or none) — the body is parsed structurally.
      seq(
        optional(field('language', $.sql_language)),
        repeat($.module_option),
        $.keyword_as,
        field('body', alias($._procedure_body_forms, $.function_body)),
      ),
      // A foreign language — the body is opaque content for injection.
      seq(
        field('language', $.foreign_language),
        repeat($.module_option),
        $.keyword_as,
        field('body', alias($._foreign_body_forms, $.function_body)),
      ),
    ),
  ),

  _function_definition: $ => seq(
    $.keyword_function,
    field('name', $.object_reference),
    $.function_arguments,
    $.keyword_returns,
    choice(
      $._type,
      $.keyword_table,
      seq($.keyword_table, $.column_definitions),
    ),
    choice(
      seq(
        optional(field('language', $.sql_language)),
        repeat($.module_option),
        $.keyword_as,
        field('body', alias($._function_body_forms, $.function_body)),
      ),
      seq(
        field('language', $.foreign_language),
        repeat($.module_option),
        $.keyword_as,
        field('body', alias($._foreign_body_forms, $.function_body)),
      ),
    ),
  ),

  // LANGUAGE SQL — the default, selecting the structurally-parsed body.
  sql_language: $ => seq($.keyword_language, $.keyword_sql),

  // LANGUAGE JAVASCRIPT | PYTHON | JAVA | SCALA — the languages whose
  // bodies are not Snowflake SQL, selecting the opaque body shape.
  foreign_language: $ => seq($.keyword_language, choice(
    $.keyword_javascript,
    $.keyword_python,
    $.keyword_java,
    $.keyword_scala,
  )),

  // The header options that may sit between the signature and the body:
  // RUNTIME_VERSION, IMPORTS, PACKAGES, HANDLER, STRICT, CALLED ON NULL
  // INPUT, COMMENT, and the session-parameter flood. Option names are
  // identifiers (never keywords), with EXECUTE AS spelled out because
  // CALLER and OWNER are its values, not option names.
  module_option: $ => choice(
    $.execute_as_clause,
    seq($.keyword_copy, $.keyword_grants),
    $.option,
  ),

  execute_as_clause: $ => seq(
    $.keyword_execute_as,
    $.keyword_as,
    choice(
      $.keyword_caller,
      $.keyword_owner,
      alias($._single_quote_string, $.literal),
    ),
  ),

  // name type [DEFAULT expr] — Snowflake procedure and function
  // arguments, always parenthesized and possibly empty.
  function_argument: $ => seq(
    field('name', $.identifier),
    field('type', $._type),
    optional(seq($.keyword_default, field('default', $._expression))),
  ),

  function_arguments: $ => paren_list($.function_argument, false),

  // AS $$ statements $$ or AS '...' when the language is SQL — a
  // procedure body holds statements.
  _procedure_body_forms: $ => choice(
    $.dollar_quoted_script,
    $.string_body,
  ),

  // AS $$ expression $$, AS $$ statements $$ or AS '...' when the
  // language is SQL — a scalar UDF body is one expression, a table
  // function's is statements.
  _function_body_forms: $ => choice(
    $.dollar_quoted_expression,
    $.dollar_quoted_script,
    $.string_body,
  ),

  // AS '...' or AS $$ ... $$ when the language is not SQL.
  _foreign_body_forms: $ => choice(
    $.string_body,
    $.dollar_quoted_body,
  ),

  // $$ statements $$ — a LANGUAGE SQL body, parsed structurally. The
  // content tokens are the grammar's own; the external scanner produces
  // only the delimiter pair, and its `$$` end tag competes with nothing
  // here because no statement begins with a `$`.
  dollar_quoted_script: $ => prec.right(seq(
    $._dollar_quote_start,
    dollar_script_body($),
    $._dollar_quote_end,
  )),

  // $$ expression $$ — the scalar SQL UDF body: one expression between
  // the delimiters, structurally parsed.
  dollar_quoted_expression: $ => prec.right(seq(
    $._dollar_quote_start,
    $._expression,
    $._dollar_quote_end,
  )),

  // $$ content $$ — a foreign-language body: one `body_content` node
  // between the delimiters, excluding them, so an injected parse starts
  // on real source text rather than on a `$`.
  dollar_quoted_body: $ => prec.right(seq(
    $._dollar_quote_start,
    alias($._dollar_quote_content, $.body_content),
    $._dollar_quote_end,
  )),

  // 'content' with '' doubling — the single-quoted body form Snowflake
  // accepts for procedure and function bodies. The content is a sequence of
  // `body_content` text chunks; each doubled apostrophe is its own
  // `doubled_quote` node and each backslash escape its own `escape`
  // node, so a consumer can reconstruct the embedded text and map a
  // position in it back to a position in the file without re-lexing.
  // The inner tokens are `token.immediate` so no extras (whitespace,
  // comments) are skipped inside the body — every byte between the
  // quotes belongs to exactly one child.
  string_body: $ => seq(
    "'",
    repeat(choice(
      alias(token.immediate(prec(1, /[^'\\]+/)), $.body_content),
      alias(token.immediate("''"), $.doubled_quote),
      alias(token.immediate(/\\./), $.escape),
    )),
    token.immediate("'"),
  ),

};
