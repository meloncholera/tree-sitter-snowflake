// Snowflake tasks — the scheduled-statement object.
//
//   CREATE [OR REPLACE] TASK [IF NOT EXISTS] name
//     [WAREHOUSE = w | USER_TASK_MANAGED_INITIAL_WAREHOUSE_SIZE = '...']
//     [SCHEDULE = '...' | AFTER task [, ...]]
//     [WHEN boolean-expr]
//     [session-parameter options ...]
//     AS <single sql statement>
//
//   ALTER TASK name {RESUME | SUSPEND | SET ... | UNSET ... |
//     MODIFY AS <statement> | ADD AFTER t | REMOVE AFTER t}
import { comma_list } from "../helpers.js";

export default {

  create_task: $ => prec.right(seq(
    $.keyword_create,
    optional($._or_replace),
    $.keyword_task,
    optional($._if_not_exists),
    field('name', $.object_reference),
    repeat($.task_option),
    $.keyword_as,
    field('body', $.statement),
  )),

  // Task options: the WAREHOUSE/SCHEDULE/AFTER/WHEN clauses carry
  // structure a consumer wants, everything else is a session parameter.
  task_option: $ => choice(
    seq($.keyword_warehouse, '=', field('warehouse', choice($.object_reference, alias($._single_quote_string, $.literal)))),
    seq($.keyword_schedule, '=', alias($._single_quote_string, $.literal)),
    seq($.keyword_after, comma_list($.object_reference, true)),
    seq($.keyword_when, field('condition', $._expression)),
    $.option,
  ),

  alter_task: $ => prec.right(seq(
    $.keyword_alter,
    $.keyword_task,
    optional($._if_exists_clause),
    field('name', $.object_reference),
    choice(
      $.keyword_resume,
      $.keyword_suspend,
      seq($.keyword_modify, $.keyword_as, field('body', $.statement)),
      seq($.keyword_add, $.keyword_after, comma_list($.object_reference, true)),
      seq($.keyword_remove, $.keyword_after, $.object_reference),
      seq($.keyword_set, repeat($.task_option)),
      seq($.keyword_unset, comma_list($.identifier, true)),
    ),
  )),

};
