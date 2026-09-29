import { paren_list, wrapped_in_parenthesis } from "../helpers.js";

// Snowflake Cortex semantic model views — the semantic-layer DDL:
//
//   CREATE [OR REPLACE] SEMANTIC VIEW name
//     TABLES ( alias AS table [PRIMARY KEY (cols)] [WITH SYNONYMS ('..')] [COMMENT = '..'] , ... )
//     [RELATIONSHIPS ( name AS alias(cols) REFERENCES alias(cols) , ... )]
//     FACTS ( alias.col AS alias.COL [...] , ... )
//     DIMENSIONS ( alias.col AS alias.COL [...] , ... )
//     METRICS ( name AS ( expr ) [COMMENT = '..'] , ... )
//     [AI_VERIFIED_QUERIES ( name AS ( QUESTION '..' SQL '..' ) , ... )]
//
// WITH SYNONYMS, QUESTION and SQL stay identifiers/strings rather than
// keywords: they are option-shaped names, and keyword extraction keeps
// them usable as ordinary words everywhere else.
export default {

  create_semantic_view: $ => prec.right(seq(
    $.keyword_create,
    optional($._or_replace),
    $.keyword_semantic,
    $.keyword_view,
    field('name', $.object_reference),
    repeat1(choice(
      $.semantic_tables_section,
      $.semantic_relationships_section,
      $.semantic_facts_section,
      $.semantic_dimensions_section,
      $.semantic_metrics_section,
      $.semantic_queries_section,
      $.semantic_view_option,
    )),
  )),

  // View-level COMMENT = '..' and AI_SQL_GENERATION '..' — the sections
  // and these options interleave, so they share one repeat.
  semantic_view_option: $ => choice(
    $.option,
    seq($.identifier, alias($._single_quote_string, $.literal)),
  ),

  semantic_tables_section: $ => seq(
    $.keyword_tables,
    paren_list($.semantic_table, true),
  ),

  semantic_relationships_section: $ => seq(
    $.keyword_relationships,
    paren_list($.semantic_relationship, true),
  ),

  semantic_facts_section: $ => seq(
    $.keyword_facts,
    paren_list($.semantic_attribute, true),
  ),

  semantic_dimensions_section: $ => seq(
    $.keyword_dimensions,
    paren_list($.semantic_attribute, true),
  ),

  semantic_metrics_section: $ => seq(
    $.keyword_metrics,
    paren_list($.semantic_metric, true),
  ),

  semantic_queries_section: $ => seq(
    $.keyword_ai_verified_queries,
    paren_list($.semantic_query, true),
  ),

  // [alias AS] table [PRIMARY KEY (cols)] [WITH SYNONYMS ('..' , ...)]
  // [COMMENT = '..'] — the alias is optional: one generation of scripted
  // semantic views names the table directly.
  semantic_table: $ => prec.right(seq(
    optional(seq(field('alias', $.identifier), $.keyword_as)),
    field('table', $.object_reference),
    optional(seq($.keyword_primary, $.keyword_key, paren_list($.identifier, true))),
    repeat($.semantic_attribute_option),
  )),

  // name AS alias(cols) REFERENCES alias(cols)
  semantic_relationship: $ => seq(
    field('name', $.identifier),
    $.keyword_as,
    seq(
      field('source', $.identifier),
      paren_list($.identifier, true),
    ),
    $.keyword_references,
    seq(
      field('target', $.identifier),
      paren_list($.identifier, true),
    ),
  ),

  // alias.col AS alias.COL [WITH SYNONYMS ('..' , ...)] [COMMENT = '..']
  semantic_attribute: $ => prec.right(seq(
    field('name', alias($._qualified_field, $.field)),
    $.keyword_as,
    field('column', alias($._qualified_field, $.field)),
    repeat($.semantic_attribute_option),
  )),

  // name AS ( expr ) [options] — or, in the alias-less generation,
  // TABLE.COL AS SUM(..) - SUM(..) [options]: a qualified name and an
  // unwrapped expression.
  semantic_metric: $ => prec.right(seq(
    field('name', choice($.identifier, alias($._qualified_field, $.field))),
    $.keyword_as,
    field('value', $._expression),
    repeat($.semantic_attribute_option),
  )),

  // name AS ( QUESTION '..' [ONBOARDING_QUESTION false] SQL '..' )
  // — the attribute values are strings in practice, but booleans and
  // numbers are accepted too (a literal covers all three).
  semantic_query: $ => seq(
    field('name', $.identifier),
    $.keyword_as,
    wrapped_in_parenthesis(
      repeat1(seq($.identifier, $.literal)),
    ),
  ),

  // WITH SYNONYMS ('..' , ...) and COMMENT = '..'
  semantic_attribute_option: $ => choice(
    seq($.keyword_with, $.identifier, optional('='), paren_list(alias($._single_quote_string, $.literal), true)),
    $.option,
  ),

};
