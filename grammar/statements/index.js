import create_rules from './create.js';
import procedure_rules from './create-procedure.js';
import task_rules from './task.js';
import alter_rules from './alter.js';
import drop_rules from './drop.js';
import select_rules from './select.js';
import dml_rules from './dml.js';
import copy_rules from './copy.js';
import grant_rules from './grant.js';
import admin_rules from './admin.js';
import semantic_rules from './semantic.js';
import clause_rules from '../clauses.js';
import { optional_parenthesis } from '../helpers.js';

export default {
  // A Snowflake script: statements separated by mandatory `;`, with the
  // final statement's terminator optional. Snowflake requires the
  // separator between statements, which keeps statement-initial keywords
  // from ever contending with an AS-less alias — do not make it optional.
  statement: ($) =>
    choice(
      $._ddl_statement,
      $._dml_write,
      $._dml_read,
      $.block,
      $.if_statement,
      $.case_statement,
      $.while_statement,
      $.for_statement,
      $.repeat_statement,
      $.loop_statement,
      $.break_statement,
      $.continue_statement,
      $.return_statement,
      $.raise_statement,
      $.declare_statement,
      $.let_statement,
      $.assignment_statement,
      $.open_cursor_statement,
      $.close_cursor_statement,
      $.fetch_cursor_statement,
      $.execute_immediate_statement,
      $.use_statement,
      $.set_statement,
      $.unset_statement,
      $.show_statement,
      $.describe_statement,
      $.explain_statement,
      $.comment_on_statement,
      $.call_statement,
      $.put_statement,
      $.get_statement,
      $.list_statement,
      $.remove_statement,
      $.begin_transaction_statement,
      $.commit_statement,
      $.rollback_statement,
    ),

  _ddl_statement: ($) =>
    choice(
      $._create_statement,
      $.create_semantic_view,
      $.create_procedure,
      $.create_function,
      $.create_task,
      $._alter_statement,
      $.alter_procedure,
      $.alter_function,
      $._drop_statement,
      $.undrop_statement,
      $.copy_into_statement,
      $.grant_statement,
      $.revoke_statement,
    ),

  _dml_read: ($) =>
    optional_parenthesis(seq(optional($._cte), choice($._select_statement, $.set_operation))),

  ...create_rules,
  ...procedure_rules,
  ...task_rules,
  ...alter_rules,
  ...drop_rules,
  ...select_rules,
  ...dml_rules,
  ...copy_rules,
  ...grant_rules,
  ...admin_rules,
  ...semantic_rules,
  ...clause_rules,
};
