import { comma_list, paren_list } from '../helpers.js';

// Snowflake DML: INSERT [OVERWRITE], UPDATE ... FROM, DELETE [USING],
// MERGE — all may be prefixed by a CTE.
export default {
  _dml_write: ($) =>
    seq(
      optional($._cte),
      choice(
        $.insert_statement,
        $.update_statement,
        $.delete_statement,
        $.truncate_statement,
        $.merge_statement,
      ),
    ),

  // TRUNCATE [TABLE] [IF EXISTS] t — statement-level delete-all.
  truncate_statement: ($) =>
    prec.right(
      seq(
        $.keyword_truncate,
        optional($.keyword_table),
        optional($._if_exists_clause),
        field('table', $.object_reference),
      ),
    ),

  // INSERT [OVERWRITE] INTO t [(cols)] { VALUES (...) | query }
  insert_statement: ($) =>
    prec.right(
      seq(
        $.keyword_insert,
        optional($.keyword_overwrite),
        $.keyword_into,
        field('table', $.object_reference),
        optional(paren_list($.identifier, true)),
        choice($.values, alias($._dml_read, $.statement)),
      ),
    ),

  // UPDATE t SET col = expr [, ...] [FROM ...] [WHERE ...]
  // A single WHERE home after the optional FROM tail — putting it inside
  // the FROM as well (as the select's `from` does) leaves it with two
  // homes when a FROM is present, and generate cannot settle it.
  update_statement: ($) =>
    prec.right(
      seq(
        $.keyword_update,
        field('table', $.object_reference),
        optional($._alias),
        $.keyword_set,
        comma_list($.assignment, true),
        optional(
          seq($.keyword_from, comma_list($.relation, true), repeat(choice($.join, $.cross_join))),
        ),
        optional($.where),
      ),
    ),

  // DELETE FROM t [USING ...] [WHERE ...]
  delete_statement: ($) =>
    prec.right(
      seq(
        $.keyword_delete,
        $.keyword_from,
        field('table', $.object_reference),
        optional($._alias),
        optional(seq($.keyword_using, comma_list($.relation, true))),
        optional($.where),
      ),
    ),

  // MERGE INTO target USING source ON condition
  //   WHEN MATCHED [AND cond] THEN {UPDATE SET ... | DELETE}
  //   WHEN NOT MATCHED [AND cond] THEN INSERT [(cols)] VALUES (...)
  merge_statement: ($) =>
    prec.right(
      seq(
        $.keyword_merge,
        $.keyword_into,
        field('target', $.relation),
        $.keyword_using,
        field('source', $.relation),
        $.keyword_on,
        field('condition', $._expression),
        repeat1($.merge_action),
      ),
    ),

  merge_action: ($) =>
    seq(
      $.keyword_when,
      optional($.keyword_not),
      $.keyword_matched,
      optional(seq($.keyword_and, field('condition', $._expression))),
      $.keyword_then,
      choice(
        seq($.keyword_update, $.keyword_set, comma_list($.assignment, true)),
        $.keyword_delete,
        seq($.keyword_insert, optional(paren_list($.identifier, true)), $.keyword_values, $.list),
      ),
    ),

  // col = expr — SET and MERGE's UPDATE assignment.
  assignment: ($) =>
    seq(field('name', alias($._qualified_field, $.field)), '=', field('value', $._expression)),
};
