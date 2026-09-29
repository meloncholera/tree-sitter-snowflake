// Snowflake session and account administration: USE, SET/UNSET, SHOW,
// DESCRIBE, CALL, transactions.
import { comma_list, wrapped_in_parenthesis } from '../helpers.js';

export default {
  // USE {DATABASE | SCHEMA | ROLE | WAREHOUSE} name
  // USE SECONDARY ROLES {ALL | NONE}
  use_statement: ($) =>
    seq(
      $.keyword_use,
      choice(
        seq($.keyword_database, $.object_reference),
        seq($.keyword_schema, $.object_reference),
        seq($.keyword_role, $.identifier),
        seq($.keyword_warehouse, $.object_reference),
        seq($.keyword_secondary, $.keyword_roles, choice($.keyword_all, $.keyword_none)),
        $.object_reference,
      ),
    ),

  // SET [session] name = value [, ...] — session variables, and the
  // SET-with-parenthesized-parameters form some tools emit.
  set_statement: ($) =>
    seq(
      $.keyword_set,
      choice(
        seq(
          optional(choice($.keyword_session, $.keyword_global)),
          comma_list($.set_assignment, true),
        ),
        wrapped_in_parenthesis(comma_list($.set_assignment, true)),
      ),
    ),

  set_assignment: ($) =>
    seq(field('name', $.identifier), '=', field('value', choice($._expression, $.list))),

  unset_statement: ($) =>
    seq(
      $.keyword_unset,
      optional(choice($.keyword_session, $.keyword_global)),
      comma_list($.identifier, true),
    ),

  // SHOW <object kind> [LIKE 'pattern'] [IN <kind> <name>] [STARTS WITH
  // '...'] [LIMIT n] [FROM '...'] — the object words (TERSE, PARAMETERS,
  // GRANTS, FUTURE ...) are identifiers, not keywords, and the clause
  // order is Snowflake's documented one: LIKE scopes before IN.
  show_statement: ($) =>
    prec.right(
      seq(
        $.keyword_show,
        optional($.keyword_terse),
        repeat1(choice($.identifier, alias($._single_quote_string, $.literal))),
        optional(seq($.keyword_like, alias($._single_quote_string, $.literal))),
        optional(
          seq(
            $.keyword_in,
            optional(choice($.keyword_database, $.keyword_schema, $.keyword_account)),
            choice($.object_reference, $.keyword_session),
          ),
        ),
        optional(seq($.keyword_starts, $.keyword_with, alias($._single_quote_string, $.literal))),
        optional(seq($.keyword_limit, $.literal)),
      ),
    ),

  // DESCRIBE <object kind> name [(types)] — DESCRIBE PROCEDURE/FUNCTION
  // take the argument *types* to resolve overloads (no names, unlike the
  // CREATE signature), and a zero-argument procedure takes an empty list.
  // prec.right so the optional argument list binds to the DESCRIBE rather
  // than reading as a parenthesized statement following it.
  describe_statement: ($) =>
    prec.right(
      seq(
        $.keyword_describe,
        repeat($.identifier),
        $.object_reference,
        optional(wrapped_in_parenthesis(comma_list($._type, false))),
      ),
    ),

  // COMMENT ON {TABLE | COLUMN | ...} name IS 'text' — the idempotent
  // documentation statement the corpus uses after CREATE TABLE. A column
  // comment names four parts (db.schema.table.column), so the target
  // allows one more identifier than object_reference carries.
  comment_on_statement: ($) =>
    prec.right(
      seq(
        $.keyword_comment,
        $.keyword_on,
        repeat1($.identifier),
        choice($.object_reference, seq($.object_reference, '.', $.identifier)),
        $.keyword_is,
        alias($._single_quote_string, $.literal),
      ),
    ),

  // CALL proc(args)
  call_statement: ($) => seq($.keyword_call, $.invocation),

  // BEGIN [WORK | TRANSACTION] / START TRANSACTION — the transaction
  // statement, distinct from the Snowflake Scripting `block`.
  begin_transaction_statement: ($) =>
    seq(
      choice(
        seq($.keyword_begin, optional(choice($.keyword_work, $.keyword_transaction))),
        seq($.keyword_start, $.keyword_transaction),
      ),
    ),

  commit_statement: ($) => $.keyword_commit,

  rollback_statement: ($) => prec.right(seq($.keyword_rollback, optional($.keyword_work))),
};
