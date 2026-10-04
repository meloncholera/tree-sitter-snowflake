import { comma_list } from '../helpers.js';

// Snowflake DROP — one shape for every object kind, with CASCADE and
// RESTRICT accepted (and ignored by Snowflake) on tables.
export default {
  _drop_statement: ($) =>
    seq(
      $.keyword_drop,
      $.object_kind,
      optional($._if_exists_clause),
      comma_list(field('name', $.object_reference), true),
      optional(choice($.keyword_cascade, $.keyword_restrict)),
    ),

  // UNDROP {TABLE | SCHEMA | DATABASE | ...} name
  undrop_statement: ($) => seq($.keyword_undrop, $.object_kind, field('name', $.object_reference)),
};
