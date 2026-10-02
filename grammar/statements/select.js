import {
  comma_list,
  optional_parenthesis,
  paren_list,
  wrapped_in_parenthesis,
} from '../helpers.js';

export default {
  // WITH [RECURSIVE] cte [, ...]
  _cte: ($) => seq($.keyword_with, optional($.keyword_recursive), comma_list($.cte, true)),

  cte: ($) =>
    seq(
      $.identifier,
      optional(paren_list(field('argument', $.identifier))),
      $.keyword_as,
      wrapped_in_parenthesis(alias($._dml_read, $.statement)),
    ),

  set_operation: ($) =>
    seq(
      $._select_statement,
      repeat1(
        seq(
          field(
            'operation',
            choice(
              seq($.keyword_union, optional($.keyword_all)),
              seq($.keyword_union, optional($.keyword_distinct)),
              $.keyword_except,
              $.keyword_minus,
              $.keyword_intersect,
            ),
          ),
          $._select_statement,
        ),
      ),
    ),

  // SELECT ... FROM ... [WHERE] [GROUP BY] [HAVING] [QUALIFY]
  // [WINDOW] [ORDER BY] [LIMIT]
  _select_statement: ($) => optional_parenthesis(seq($.select, optional($.from))),

  select: ($) =>
    seq(
      $.keyword_select,
      optional($.keyword_distinct),
      optional($.top_clause),
      $.select_expression,
      optional($.select_into),
    ),

  // SELECT expr INTO :var [, ...] — Snowflake Scripting's variable
  // capture, valid inside a scripting body.
  select_into: ($) => seq($.keyword_into, comma_list(choice($.bind_variable, $.identifier), true)),

  // TOP n — Snowflake's LIMIT-before-the-columns spelling. The count is a
  // bare literal or parenthesized expression.
  top_clause: ($) =>
    seq(
      $.keyword_top,
      choice(alias($._natural_number, $.literal), wrapped_in_parenthesis($._expression)),
    ),

  // prec.right: a `,` after a term extends the select list rather than
  // ending the SELECT (the comma-separated DECLARE list around a cursor
  // declaration makes both readings reachable).
  select_expression: ($) => prec.right(seq($.term, repeat(seq(',', $.term)))),

  term: ($) => seq(field('value', choice($.all_fields, $._expression)), optional($._alias)),

  // * with the Snowflake star modifiers: * EXCLUDE (a, b),
  // t.* RENAME (a AS b). EXCLUDE and RENAME are keywords only here.
  all_fields: ($) =>
    prec.right(
      seq(
        optional(seq($.object_reference, '.')),
        '*',
        optional(
          choice(
            seq(
              $.keyword_exclude,
              choice(
                alias($._qualified_field, $.field),
                paren_list(alias($._qualified_field, $.field), true),
              ),
            ),
            seq($.keyword_rename, paren_list($.rename_pair, true)),
          ),
        ),
      ),
    ),

  rename_pair: ($) =>
    seq(alias($._qualified_field, $.field), $.keyword_as, field('alias', $.identifier)),

  from: ($) =>
    seq(
      $.keyword_from,
      comma_list($.relation, true),
      repeat(choice($.join, $.cross_join, $.pivot_clause, $.unpivot_clause, $.match_recognize)),
      optional($.where),
      optional($.hierarchy),
      optional($.group_by),
      optional($.having),
      optional($.qualify),
      optional($.named_windows),
      optional($.order_by),
      optional($.limit),
    ),

  // Hierarchical query: START WITH and CONNECT BY, in either order when
  // START WITH is present. PRIOR in the CONNECT BY condition is a unary
  // operator (see unary_expression).
  hierarchy: ($) =>
    choice(seq($.start_with, $.connect_by), seq($.connect_by, optional($.start_with))),

  start_with: ($) => seq($.keyword_start, $.keyword_with, field('condition', $._expression)),

  connect_by: ($) => seq($.keyword_connect, $.keyword_by, field('condition', $._expression)),

  where: ($) => seq($.keyword_where, field('predicate', $._expression)),

  // QUALIFY predicate — Snowflake's post-window-function filter, the one
  // clause that distinguishes the SELECT tail from every other dialect's.
  qualify: ($) => seq($.keyword_qualify, field('predicate', $._expression)),

  // GROUP BY expression [, ...] with the extensions: GROUP BY GROUPING
  // SETS (...), CUBE (...), ROLLUP (...) and GROUP BY ALL. prec.left so
  // `ALL` reads as the GROUP BY ALL spelling rather than a unary
  // operator.
  group_by: ($) =>
    seq(
      $.keyword_group,
      $.keyword_by,
      choice($.keyword_all, comma_list(choice($._expression, $.grouping_sets), true)),
    ),

  grouping_sets: ($) =>
    choice(
      seq(
        $.keyword_grouping,
        $.keyword_sets,
        paren_list(choice($._expression, $.list, $.grouping_sets, $._empty_group), true),
      ),
      seq(
        choice($.keyword_cube, $.keyword_rollup),
        paren_list(choice($._expression, $.list), true),
      ),
    ),

  having: ($) => seq($.keyword_having, $._expression),

  order_by: ($) => prec.right(seq($.keyword_order, $.keyword_by, comma_list($.order_target, true))),

  order_target: ($) => prec.right(seq($._expression, optional($.direction))),

  // ASC/DESC [NULLS FIRST/LAST], or a bare NULLS FIRST/LAST — Snowflake
  // accepts the nulls ordering without an explicit direction.
  direction: ($) =>
    choice(
      seq(
        choice($.keyword_asc, $.keyword_desc),
        optional(seq($.keyword_nulls, choice($.keyword_first, $.keyword_last))),
      ),
      seq($.keyword_nulls, choice($.keyword_first, $.keyword_last)),
    ),

  // LIMIT n [OFFSET m] — Snowflake requires LIMIT before OFFSET, and
  // accepts a negative n (which it treats as unbounded).
  limit: ($) =>
    prec.right(seq($.keyword_limit, $._expression, optional(seq($.keyword_offset, $._expression)))),

  // () — the empty grouping set.
  _empty_group: (_) => '()',

  // WINDOW w AS (spec) [, ...] — named window definitions, after QUALIFY.
  named_windows: ($) => seq($.keyword_window, comma_list($.named_window, true)),

  named_window: ($) => seq(field('name', $.identifier), $.keyword_as, $.window_specification),

  partition_by: ($) => seq($.keyword_partition, $.keyword_by, comma_list($._expression, true)),

  frame_definition: ($) =>
    seq(
      choice(
        seq($.keyword_unbounded, $.keyword_preceding),
        seq(field('start', alias($._integer, $.literal)), $.keyword_preceding),
        seq($.keyword_current, $.keyword_row),
        seq(field('end', alias($._integer, $.literal)), $.keyword_following),
        seq($.keyword_unbounded, $.keyword_following),
      ),
    ),

  window_frame: ($) =>
    seq(
      choice($.keyword_range, $.keyword_rows),
      choice(
        seq($.keyword_between, $.frame_definition, $.keyword_and, $.frame_definition),
        $.frame_definition,
      ),
    ),

  window_specification: ($) =>
    wrapped_in_parenthesis(
      seq(
        optional(choice($.partition_by, field('name', $.identifier))),
        optional($.order_by),
        optional($.window_frame),
      ),
    ),

  window_function: ($) => seq($.invocation, $.keyword_over, $.window_specification),

  _alias: ($) =>
    seq(
      optional($.keyword_as),
      field('alias', choice($.identifier, alias($._single_quote_string, $.literal))),
    ),

  // A row source: a table reference, a subquery, a table function
  // (LATERAL FLATTEN is an invocation with named arguments), a VALUES
  // list, a stage file, or TABLE(...). LATERAL may prefix a subquery or
  // invocation. The alias may carry a column list.
  relation: ($) =>
    prec.right(
      seq(
        choice(
          $.subquery,
          $.invocation,
          seq($.object_reference, optional($._time_travel_clause)),
          seq(optional($.keyword_lateral), choice($.subquery, $.invocation)),
          $.values,
          wrapped_in_parenthesis($.values),
          seq($.keyword_table, wrapped_in_parenthesis($._expression)),
          $.stage_source,
        ),
        optional(seq($._alias, optional(alias($._column_list, $.list)))),
      ),
    ),

  // Time Travel and change tracking on a table reference:
  //   AT | BEFORE (TIMESTAMP | OFFSET | STATEMENT | STREAM => expr)
  //   CHANGES (INFORMATION => DEFAULT | APPEND_ONLY) AT | BEFORE (...) [END (...)]
  _time_travel_clause: ($) => choice($.time_travel, $.changes_clause),

  time_travel: ($) =>
    seq(choice($.keyword_at, $.keyword_before), wrapped_in_parenthesis($.named_argument)),

  changes_clause: ($) =>
    seq(
      $.keyword_changes,
      wrapped_in_parenthesis($.named_argument),
      $.time_travel,
      optional(seq($.keyword_end, wrapped_in_parenthesis($.named_argument))),
    ),

  // @stage/path [(FILE_FORMAT => 'CSV' [, ...])] — querying a staged file
  // directly. The parenthesized options are named arguments; prec.right
  // keeps them with the stage rather than reading as a following
  // parenthesized relation.
  stage_source: ($) =>
    prec.right(
      seq($.stage_reference, optional(wrapped_in_parenthesis(comma_list($.named_argument, true)))),
    ),

  join: ($) =>
    seq(
      optional(
        seq(
          choice(
            seq($.keyword_left, optional($.keyword_outer)),
            seq($.keyword_right, optional($.keyword_outer)),
            seq($.keyword_full, optional($.keyword_outer)),
            $.keyword_inner,
          ),
        ),
      ),
      $.keyword_join,
      $.relation,
      optional($.join),
      choice(
        seq($.keyword_on, field('predicate', $._expression)),
        seq($.keyword_using, paren_list($.identifier, true)),
      ),
    ),

  cross_join: ($) => seq($.keyword_cross, $.keyword_join, $.relation),

  // table_source PIVOT ( aggregate(column) FOR column IN (value [, ...]) ) [AS] alias
  pivot_clause: ($) =>
    prec.right(
      seq(
        $.keyword_pivot,
        wrapped_in_parenthesis(
          seq(
            $.invocation,
            $.keyword_for,
            alias($._qualified_field, $.field),
            $.keyword_in,
            paren_list($._expression, true),
          ),
        ),
        optional($._alias),
      ),
    ),

  // table_source UNPIVOT ( value_column FOR pivot_column IN (column [, ...]) ) [AS] alias
  unpivot_clause: ($) =>
    prec.right(
      seq(
        $.keyword_unpivot,
        wrapped_in_parenthesis(
          seq(
            $.identifier,
            $.keyword_for,
            $.identifier,
            $.keyword_in,
            paren_list(alias($._qualified_field, $.field), true),
          ),
        ),
        optional($._alias),
      ),
    ),

  // MATCH_RECOGNIZE ( PARTITION BY ... ORDER BY ... MEASURES ...
  //   [ONE | ALL ROWS] PER MATCH [AFTER MATCH SKIP ...]
  //   PATTERN (...) DEFINE ... ) [AS] alias
  match_recognize: ($) =>
    prec.right(
      seq(
        $.keyword_match_recognize,
        wrapped_in_parenthesis(
          seq(
            optional($.partition_by),
            optional($.order_by),
            // MEASURES price AS last_price [, ...]
            optional(seq($.keyword_measures, comma_list($.measure_definition, true))),
            // [ONE | ALL ROWS] PER MATCH — ONE and ALL are not row-count
            // keywords everywhere else, so ONE stays an identifier here.
            optional(
              seq(
                optional(choice($.keyword_all, $.identifier)),
                choice($.keyword_row, $.keyword_rows),
                $.keyword_per,
                $.keyword_match,
              ),
            ),
            // AFTER MATCH SKIP {PAST LAST ROW | TO NEXT ROW |
            //   TO FIRST x | TO LAST x | TO x}
            optional(
              seq(
                $.keyword_after,
                $.keyword_match,
                $.keyword_skip,
                choice(
                  seq($.keyword_past, $.keyword_last, $.keyword_row),
                  seq(
                    $.keyword_to,
                    choice(
                      seq($.keyword_next, $.keyword_row),
                      seq(choice($.keyword_first, $.keyword_last), $.identifier),
                      $.identifier,
                    ),
                  ),
                ),
              ),
            ),
            // The row pattern is a small regex-like language of its own
            // (symbol names with +, *, ?, |), opaque to this grammar: none
            // of it is SQL the consumers measure.
            seq($.keyword_pattern, wrapped_in_parenthesis(token(/[^)]*/))),
            $.keyword_define,
            comma_list($.define_argument, true),
          ),
        ),
        optional($._alias),
      ),
    ),

  measure_definition: ($) => seq($._expression, $.keyword_as, field('name', $.identifier)),

  // DEFINE symbol AS predicate
  define_argument: ($) =>
    seq(field('name', $.identifier), $.keyword_as, field('value', $._expression)),

  // VALUES (expr, ...)[, (expr, ...)] — prec.right so a `,` after a row
  // extends the VALUES list rather than reading as the next relation in
  // the FROM's comma list.
  values: ($) => prec.right(seq($.keyword_values, comma_list($.list, true))),
};
