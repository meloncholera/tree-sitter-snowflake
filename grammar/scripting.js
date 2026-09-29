import { comma_list, paren_list, wrapped_in_parenthesis, statement_list } from './helpers.js';

// Snowflake Scripting — the procedural language inside a `$$ ... $$`
// procedure body, an EXECUTE IMMEDIATE block, or a SnowSQL script file.
//
//   DECLARE ...; LET x := 1;
//   BEGIN ... [EXCEPTION WHEN name THEN ...] END
//   IF ... THEN ... [ELSEIF ... THEN ...] [ELSE ...] END IF
//   CASE WHEN ... THEN ... [ELSE ...] END
//   FOR v IN c | (query) | [REVERSE] 1 TO n DO ... END FOR
//   WHILE ... DO ... END WHILE
//   REPEAT ... UNTIL ... END REPEAT
//   LOOP ... END LOOP; BREAK; CONTINUE;
//   RETURN [expr]; RAISE [name];
//   OPEN c; FETCH c INTO :v; CLOSE c; c := (SELECT ...);
//
// The node names here are the public API measurement and linting tools
// key on (if_statement, elseif_clause, case_statement, while_statement,
// for_statement, repeat_statement, loop_statement, exception_handler) —
// renaming any of them is a breaking change.
export default {
  // A labeled or bare BEGIN ... END block with an optional exception
  // section. This is the Snowflake Scripting block, not a transaction; a
  // transaction is begin_transaction_statement.
  block: ($) =>
    seq(
      optional($._label),
      $.keyword_begin,
      statement_list($),
      optional($.exception_section),
      $.keyword_end,
    ),

  _label: (_) => /<<[^>]+>>/,

  exception_section: ($) => seq($.keyword_exception, repeat1($.exception_handler)),

  // WHEN name [OR name ...] THEN statements
  exception_handler: ($) =>
    seq(
      $.keyword_when,
      comma_list(choice($.identifier, $.keyword_other), true),
      $.keyword_then,
      statement_list($),
    ),

  if_statement: ($) =>
    seq(
      $.keyword_if,
      field('condition', $._expression),
      $.keyword_then,
      statement_list($),
      repeat($.elseif_clause),
      optional($.else_clause),
      $.keyword_end,
      $.keyword_if,
    ),

  elseif_clause: ($) =>
    seq($.keyword_elseif, field('condition', $._expression), $.keyword_then, statement_list($)),

  else_clause: ($) => seq($.keyword_else, statement_list($)),

  // Scripting CASE: branches are statement lists, not expressions, and
  // there is no input expression — a SQL CASE expression is `case` in
  // grammar/expressions.js. The two share the CASE token; the branch
  // contents settle which is which a token later.
  case_statement: ($) =>
    seq($.keyword_case, repeat1($.case_when_clause), optional($.else_clause), $.keyword_end),

  case_when_clause: ($) =>
    seq($.keyword_when, field('condition', $._expression), $.keyword_then, statement_list($)),

  // FOR v IN c DO / FOR v IN (SELECT ...) DO / FOR v IN [REVERSE] 1 TO n DO
  for_statement: ($) =>
    seq(
      $.keyword_for,
      field('variable', $.identifier),
      $.keyword_in,
      field(
        'source',
        choice(
          $.identifier,
          $.subquery,
          seq(optional($.keyword_reverse), $._expression, $.keyword_to, $._expression),
        ),
      ),
      $.keyword_do,
      statement_list($),
      $.keyword_end,
      $.keyword_for,
    ),

  while_statement: ($) =>
    seq(
      $.keyword_while,
      field('condition', $._expression),
      $.keyword_do,
      statement_list($),
      $.keyword_end,
      $.keyword_while,
    ),

  repeat_statement: ($) =>
    seq(
      $.keyword_repeat,
      statement_list($),
      $.keyword_until,
      field('condition', $._expression),
      $.keyword_end,
      $.keyword_repeat,
    ),

  loop_statement: ($) => seq($.keyword_loop, statement_list($), $.keyword_end, $.keyword_loop),

  // BREAK [label] — prec.right so an identifier after BREAK reads as the
  // label rather than the start of the next, unterminated item.
  break_statement: ($) => prec.right(seq($.keyword_break, optional($.identifier))),
  continue_statement: ($) => prec.right(seq($.keyword_continue, optional($.identifier))),

  return_statement: ($) => prec.right(seq($.keyword_return, optional($._expression))),

  raise_statement: ($) => prec.right(seq($.keyword_raise, optional($.identifier))),

  // DECLARE introduces variables, cursors, resultsets and exception
  // declarations; each kind is a named node so a consumer can tell them
  // apart without re-reading the body. Each declaration is terminated by
  // its own `;` (Snowflake separates DECLARE items with semicolons, not
  // commas), and a cursor declaration stands alone — which keeps the
  // terminator out of the position where the cursor's SELECT could
  // otherwise continue.
  // prec.right: after a declaration's `;` the next identifier continues
  // the DECLARE section (a variable declaration may be as bare as
  // `name;`), rather than ending it for a statement the section cannot
  // contain anyway — only BEGIN ends a DECLARE, and no declaration
  // begins with it.
  declare_statement: ($) =>
    prec.right(
      seq(
        $.keyword_declare,
        repeat1(
          seq(
            choice(
              $.variable_declaration,
              $.exception_declaration,
              $.resultset_declaration,
              $.cursor_declaration,
            ),
            ';',
          ),
        ),
      ),
    ),

  // name [type] [:= expr | DEFAULT expr] — prec.right so a following
  // identifier extends the type (a custom type is an identifier) rather
  // than ending the declaration.
  variable_declaration: ($) =>
    prec.right(
      seq(
        field('name', $.identifier),
        optional($._type),
        optional(seq(choice(':=', $.keyword_default), field('value', $._expression))),
      ),
    ),

  // name CURSOR FOR select
  cursor_declaration: ($) =>
    seq(field('name', $.identifier), $.keyword_cursor, $.keyword_for, $._dml_read),

  // name EXCEPTION [(-20000, 'message')] — prec(1) so `name EXCEPTION`
  // resolves to this declaration rather than a variable declaration of
  // `name` followed by an EXCEPTION section keyword; prec.right so the
  // optional code/message pair binds to the declaration.
  exception_declaration: ($) =>
    prec.right(
      1,
      seq(
        field('name', $.identifier),
        $.keyword_exception,
        optional(wrapped_in_parenthesis(seq($._expression, ',', $._expression))),
      ),
    ),

  // name RESULTSET [DEFAULT | :=] (query | CALL proc(...)) — the
  // initializer is a parenthesized query in practice, not a general
  // expression.
  resultset_declaration: ($) =>
    seq(
      field('name', $.identifier),
      $.keyword_resultset,
      optional(
        seq(
          choice(':=', $.keyword_default),
          field('value', choice($.subquery, $.call_statement, $._expression)),
        ),
      ),
    ),

  // LET name [type] [:= expr | DEFAULT expr]
  let_statement: ($) =>
    prec.right(
      seq(
        $.keyword_let,
        field('name', $.identifier),
        optional($._type),
        optional(seq(choice(':=', $.keyword_default), field('value', $._expression))),
      ),
    ),

  // x := expr — scripting assignment. The target is a plain identifier
  // (session and bind variables lex as identifiers already).
  assignment_statement: ($) => seq($.identifier, ':=', field('value', $._expression)),

  open_cursor_statement: ($) => seq($.keyword_open, $.identifier),
  close_cursor_statement: ($) => seq($.keyword_close, $.identifier),

  // FETCH c INTO :v [, :v ...] — the targets are bind-style references.
  fetch_cursor_statement: ($) =>
    seq(
      $.keyword_fetch,
      $.identifier,
      $.keyword_into,
      comma_list(choice($.bind_variable, $.identifier), true),
    ),

  // EXECUTE IMMEDIATE <source> [USING (args)] [INTO (targets)]
  // The source is a dollar-quoted script (parsed structurally), a string
  // literal, a variable, or a concatenation of those building the
  // statement at runtime. A general expression is deliberately not
  // allowed here: it would fork the `$$` between the script and the plain
  // dollar-quoted literal, and the literal reading then swallows the
  // script.
  execute_immediate_statement: ($) =>
    seq(
      $.keyword_execute,
      $.keyword_immediate,
      field(
        'source',
        choice(
          $.dollar_quoted_script,
          $.sql_text_expression,
          alias($._single_quote_string, $.literal),
          choice($.identifier, $.bind_variable),
        ),
      ),
      optional(
        seq(
          $.keyword_using,
          paren_list(choice($.named_argument, $.bind_variable, $._expression), true),
        ),
      ),
      optional(seq($.keyword_into, paren_list(choice($.identifier, $.bind_variable), true))),
    ),

  // 'a' || v || 'b' — SQL text assembled at runtime, the EXECUTE
  // IMMEDIATE source shape a general expression must not cover (its
  // operands stay literals, names and record fields so an invocation's
  // `(` never forks against the source variable reading).
  sql_text_expression: ($) =>
    prec.right(seq($._sql_text_operand, repeat1(seq('||', $._sql_text_operand)))),

  _sql_text_operand: ($) =>
    choice(alias($._single_quote_string, $.literal), $.bind_variable, $._qualified_field),
};
