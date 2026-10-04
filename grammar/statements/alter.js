// Snowflake ALTER statements. The table takes a detailed action list; the
// other objects share one shape — SET options, UNSET names, RENAME TO,
// and the object's own resume/suspend verbs — generated from a plain
// function rather than a shared named rule, because a named rule whose
// every segment is optional matches the empty string and `generate`
// rejects it.
import { comma_list, paren_list, set_unset_properties } from '../helpers.js';

function alter_object(keyword, actions = []) {
  return ($) =>
    seq(
      $.keyword_alter,
      keyword($),
      optional($._if_exists_clause),
      field('name', $.object_reference),
      choice(
        ...actions.map((action) => action($)),
        ...set_unset_properties($),
        seq($.keyword_rename, $.keyword_to, $.object_reference),
      ),
    );
}
export default {
  _alter_statement: ($) =>
    choice(
      $.alter_table,
      $.alter_view,
      $.alter_task,
      $.alter_warehouse,
      $.alter_database,
      $.alter_schema,
      $.alter_stage,
      $.alter_stream,
      $.alter_sequence,
      $.alter_role,
      $.alter_user,
      $.alter_pipe,
      $.alter_integration,
      $.alter_session,
      $.alter_account,
    ),

  alter_table: ($) =>
    prec.right(
      seq(
        $.keyword_alter,
        $.keyword_table,
        optional($._if_exists_clause),
        field('name', $.object_reference),
        repeat1(
          choice(
            $.add_column_action,
            $.drop_column_action,
            $.rename_column_action,
            $.alter_column_action,
            $.constraint_action,
            $.cluster_by,
            seq($.keyword_drop, $.keyword_cluster, $.keyword_by),
            seq($.keyword_swap, $.keyword_with, $.object_reference),
            seq($.keyword_add, $.keyword_search, $.keyword_optimization, optional($.keyword_on)),
            seq($.keyword_drop, $.keyword_search, $.keyword_optimization),
            ...set_unset_properties($),
          ),
        ),
      ),
    ),

  add_column_action: ($) =>
    seq(
      $.keyword_add,
      $.keyword_column,
      optional($._if_not_exists),
      comma_list($.column_definition, true),
    ),

  drop_column_action: ($) =>
    seq(
      $.keyword_drop,
      $.keyword_column,
      optional($._if_exists_clause),
      comma_list($.identifier, true),
    ),

  rename_column_action: ($) =>
    seq($.keyword_rename, $.keyword_column, $.identifier, $.keyword_to, $.identifier),

  // ALTER COLUMN name {SET DATA TYPE t | UNSET DATA TYPE |
  //   SET DEFAULT expr | DROP DEFAULT | [SET] NOT NULL | DROP NOT NULL |
  //   SET MASKING POLICY p [USING (...)] | UNSET MASKING POLICY}
  alter_column_action: ($) =>
    seq(
      $.keyword_alter,
      $.keyword_column,
      optional($._if_exists_clause),
      $.identifier,
      choice(
        seq($.keyword_set, $.keyword_data, $.keyword_type, $._type),
        seq($.keyword_unset, $.keyword_data, $.keyword_type),
        seq($.keyword_set, $.keyword_default, $._expression),
        seq($.keyword_drop, $.keyword_default),
        seq(optional($.keyword_set), $._not_null),
        seq($.keyword_drop, $._not_null),
        seq(
          $.keyword_set,
          $.keyword_masking,
          $.keyword_policy,
          $.object_reference,
          optional(seq($.keyword_using, paren_list($.identifier, true))),
        ),
        seq($.keyword_unset, $.keyword_masking, $.keyword_policy),
        seq($.keyword_with, $.keyword_tag, paren_list($.tag_assignment, true)),
        seq($.keyword_unset, $.keyword_tag),
      ),
    ),

  constraint_action: ($) =>
    seq(
      $.keyword_add,
      optional(seq($.keyword_constraint, $.identifier)),
      choice(
        seq(
          seq($.keyword_primary, $.keyword_key),
          paren_list($.identifier, true),
          optional($.keyword_not_enforced),
        ),
        seq($.keyword_unique, paren_list($.identifier, true), optional($.keyword_not_enforced)),
        seq($.keyword_foreign, $.keyword_key, paren_list($.identifier, true), $.referential_clause),
      ),
    ),

  alter_view: ($) =>
    prec.right(
      seq(
        $.keyword_alter,
        $.keyword_view,
        optional($._if_exists_clause),
        field('name', $.object_reference),
        repeat1(
          choice(
            seq($.keyword_rename, $.keyword_to, $.object_reference),
            ...set_unset_properties($),
            seq(
              $.keyword_add,
              $.keyword_row,
              $.keyword_access,
              $.keyword_policy,
              $.object_reference,
            ),
            seq($.keyword_drop, $.keyword_row, $.keyword_access, $.keyword_policy),
            $.keyword_secure,
          ),
        ),
      ),
    ),

  alter_warehouse: alter_object(
    ($) => $.keyword_warehouse,
    [
      ($) => $.keyword_suspend,
      ($) => seq($.keyword_resume, $.keyword_if, $.keyword_suspended),
      ($) => seq($.keyword_abort, $.keyword_all, $.keyword_queries),
    ],
  ),

  alter_database: alter_object(
    ($) => $.keyword_database,
    [
      ($) => seq($.keyword_swap, $.keyword_with, $.object_reference),
      ($) => seq($.keyword_enable, $.keyword_failsafe),
      ($) => seq($.keyword_disable, $.keyword_failsafe),
    ],
  ),

  alter_schema: alter_object(
    ($) => $.keyword_schema,
    [($) => seq($.keyword_swap, $.keyword_with, $.object_reference)],
  ),

  alter_stage: alter_object(($) => $.keyword_stage, []),
  alter_stream: alter_object(($) => $.keyword_stream, []),
  alter_sequence: alter_object(($) => $.keyword_sequence, []),
  alter_role: alter_object(($) => $.keyword_role, []),
  alter_user: alter_object(($) => $.keyword_user, []),
  alter_pipe: alter_object(
    ($) => $.keyword_pipe,
    [
      ($) => seq($.keyword_set, $.keyword_comment, '=', alias($._single_quote_string, $.literal)),
      ($) => $.keyword_refresh,
    ],
  ),
  alter_integration: alter_object(
    ($) => $.keyword_integration,
    [($) => seq($.keyword_set, comma_list($.option, true))],
  ),

  alter_session: ($) =>
    prec.right(seq($.keyword_alter, $.keyword_session, choice(...set_unset_properties($)))),

  // ALTER ACCOUNT SET <parameter> = value [, ...] — the account-level
  // parameter statements Snowflake scripts as one-liners.
  alter_account: ($) =>
    prec.right(seq($.keyword_alter, $.keyword_account, choice(...set_unset_properties($)))),
};
