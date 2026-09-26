import keyword_rules from "./grammar/keywords.js";
import type_rules from "./grammar/types.js";
import column_list_rules from "./grammar/column-lists.js";
import expression_rules from "./grammar/expressions.js";
import scripting_rules from "./grammar/scripting.js";
import statement_rules from "./grammar/statements/index.js";

export default grammar({
  name: 'snowflake',

  extras: $ => [
    /\s/,
    $.comment,
    $.marginalia,
  ],

  externals: $ => [
    $._dollar_quote_start,
    $._dollar_quote_content,
    $._dollar_quote_end,
  ],

  // Every entry arbitrates a real fork the parser must carry a few tokens
  // before it can settle; tree-sitter reports any that stop being needed
  // as "unnecessary conflicts" on generate, and those are removed.
  conflicts: $ => [
    // `a.b` — the prefix of a qualified column vs. an object reference.
    [$.object_reference, $._qualified_field],
    // `a.b.c` — how many parts belong to the reference.
    [$.object_reference],
    // `x BETWEEN a AND b` vs. `x BETWEEN (a AND b)`.
    [$.between_expression, $.binary_expression],
    // `v -> w IN (...)` — the lambda body vs. the arrow's right operand
    // continuing as an IN or a BETWEEN; settled by the token after the
    // body.
    [$.lambda_expression, $.binary_expression],
    [$.lambda_expression, $.between_expression],
    [$.lambda_expression, $.binary_expression, $.between_expression],
    [$.lambda_expression, $.semi_structured],
    [$.lambda_expression, $.cast_expression],
    // `(dept)` — a parenthesized expression or a lambda parameter list;
    // settled by whether `->` follows the `)`.
    [$._qualified_field, $.lambda_parameter],
    // `v:"key"` — a quoted path key may reduce as the key or as a fresh
    // identifier, one token into the path.
    [$._semi_structured_key, $.identifier],
    // `T.COL AS SUM(..) - SUM(..)` — a semantic metric's qualified-field
    // name vs. the same shape starting its expression value.
    [$._qualified_field, $.semantic_metric],
    // `GRANT ... ON <kind> <ref>` — the kind may be an identifier, which
    // is also how a bare reference begins.
    [$.object_reference, $.object_kind],
    // `$$ DECLARE ... $$` — a self-terminated DECLARE closes the `;`
    // list or stands as the script's single statement; the trees are
    // identical either way.
    [$.statement, $.dollar_quoted_script],
  ],

  precedences: $ => [
    [
      'postfix',
      'unary_sign',
      'binary_exp',
      'binary_times',
      'binary_plus',
      'unary_other',
      'binary_other',
      'binary_in',
      'binary_compare',
      'binary_relation',
      'binary_is',
      'pattern_matching',
      'between',
      'unary_not',
      'clause_connective',
      'clause_disjunctive',
    ],
  ],

  word: $ => $._identifier,

  rules: {
    // A Snowflake script: statements separated by a mandatory `;`, with
    // the terminator optional only on the final statement. Snowflake
    // requires the separator between statements, and keeping it mandatory
    // is what keeps statement-initial keywords from contending with the
    // AS-less alias slot — do not make it optional for convenience.
    program: $ => seq(
      repeat(seq($.statement, ';')),
      optional($.statement),
    ),

    // `--` and `//` line comments; Snowflake accepts both spellings.
    comment: _ => token(choice(/--[^\n]*/, /\/\/[^\n]*/)),
    // The block comment is a plain regex because Snowflake's block
    // comments do NOT nest — the first `*/` closes the comment — unlike
    // T-SQL's, which is why this grammar needs no external scanner for
    // them. (Verified against Snowflake's documentation.)
    marginalia: _ => token(/\/\*([^*]|\*+[^*/])*\*+\//),

    ...keyword_rules,
    ...type_rules,
    ...column_list_rules,
    ...expression_rules,
    ...scripting_rules,
    ...statement_rules,
  }
});
