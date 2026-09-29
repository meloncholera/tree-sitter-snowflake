import { comma_list, paren_list, wrapped_in_parenthesis } from '../helpers.js';

// Snowflake DDL: CREATE [OR REPLACE] across Snowflake's object families.
// Option floods (warehouse parameters, task
// parameters, file-format options, copy options, stage properties, table
// properties) are the generic `option` shape — `identifier [= value]` —
// because option names are never keywords.
export default {
  _create_statement: ($) =>
    choice(
      $.create_table,
      $.create_view,
      $.create_materialized_view,
      $.create_dynamic_table,
      $.create_stage,
      $.create_file_format,
      $.create_stream,
      $.create_pipe,
      $.create_warehouse,
      $.create_database,
      $.create_schema,
      $.create_role,
      $.create_user,
      $.create_sequence,
      $.create_tag,
      $.create_integration,
      $.create_agent,
      $.create_streamlit,
      $.create_cortex_search,
    ),

  // CREATE [OR REPLACE] CORTEX SEARCH SERVICE name ON column
  //   [options] AS '..' — the vector-index DDL, whose body is a single
  // quoted query string.
  create_cortex_search: ($) =>
    prec.right(
      seq(
        $.keyword_create,
        optional($._or_replace),
        $.keyword_cortex,
        $.keyword_search,
        $.keyword_service,
        field('name', $.object_reference),
        $.keyword_on,
        field('column', alias($._qualified_field, $.field)),
        repeat($.option),
        $.keyword_as,
        choice(wrapped_in_parenthesis($._dml_read), $.string_body),
      ),
    ),

  // CREATE [OR REPLACE] STREAMLIT name ROOT_LOCATION = '..' MAIN_FILE = '..'
  // [QUERY_WAREHOUSE = '..' ... options]
  // The name is an ordinary object reference, or the versioned spelling
  // a warehouse dump scripts (`db.schema.root/versions/live`, whose final
  // segment may carry a stray trailing quote from the dump).
  create_streamlit: ($) =>
    prec.right(
      seq(
        $.keyword_create,
        optional($._or_replace),
        $.keyword_streamlit,
        field('name', choice(alias($._streamlit_versioned_name, $.identifier), $.object_reference)),
        repeat1($.option),
      ),
    ),

  _streamlit_versioned_name: (_) => /[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*(\/[A-Za-z0-9_.']+)+/,

  // CREATE [OR REPLACE] AGENT name profile = '..' FROM SPECIFICATION $yaml$
  // — a Cortex Agent. The specification body is YAML, so it is the opaque
  // dollar-quoted string, not a SQL script.
  create_agent: ($) =>
    prec.right(
      seq(
        $.keyword_create,
        optional($._or_replace),
        $.keyword_agent,
        field('name', $.object_reference),
        repeat($.option),
        $.keyword_from,
        $.keyword_specification,
        alias($._dollar_quoted_string, $.literal),
      ),
    ),

  _or_replace: ($) => seq($.keyword_or, $.keyword_replace),

  // CREATE [OR REPLACE] [TRANSIENT] TABLE [IF NOT EXISTS] name
  //   { ( column_definitions ) [table options]
  //   | [CLUSTER BY (...)] AS query
  //   | LIKE other_table
  //   | CLONE other_table }
  //   [COPY GRANTS] [WITH TAG (...)] ...
  create_table: ($) =>
    prec.right(
      seq(
        $.keyword_create,
        optional($._or_replace),
        optional(choice($.keyword_transient, $.keyword_volatile, $.keyword_temporary)),
        optional($.keyword_external),
        $.keyword_table,
        optional($._if_not_exists),
        field('name', $.object_reference),
        optional($.cluster_by),
        choice(
          seq(
            $.column_definitions,
            repeat($.table_option),
            optional(seq($.keyword_as, $.create_query)),
          ),
          seq(repeat($.table_option), $.keyword_as, $.create_query),
          seq($.keyword_like, $.object_reference),
          seq($.keyword_clone, $.object_reference, repeat($.table_option)),
        ),
      ),
    ),

  // The CTAS query.
  create_query: ($) => $._dml_read,

  // CLUSTER BY (expr, ...), COPY GRANTS, and the identifier = value
  // property tail Snowflake tables carry.
  table_option: ($) =>
    prec.left(
      choice(
        $.cluster_by,
        seq($.keyword_copy, $.keyword_grants),
        seq($.keyword_with, $.keyword_tag, paren_list($.tag_assignment, true)),
        $.option,
      ),
    ),

  cluster_by: ($) => seq($.keyword_cluster, $.keyword_by, paren_list($._expression, true)),

  // CREATE [OR REPLACE] [SECURE] VIEW [IF NOT EXISTS] name [(cols)]
  //   [COPY GRANTS] [COMMENT = '...'] AS query
  // A column list entry may carry its own COMMENT '...'.
  create_view: ($) =>
    prec.right(
      seq(
        $.keyword_create,
        optional($._or_replace),
        optional($.keyword_secure),
        $.keyword_view,
        optional($._if_not_exists),
        field('name', $.object_reference),
        optional(paren_list($.view_column, true)),
        repeat($.view_option),
        $.keyword_as,
        $.create_query,
      ),
    ),

  view_column: ($) =>
    seq(
      field('name', $.identifier),
      optional(seq($.keyword_comment, alias($._single_quote_string, $.literal))),
    ),

  // CREATE [OR REPLACE] MATERIALIZED VIEW name [(cols)]
  //   [COMMENT = ''] [CLUSTER BY (...)] AS query
  create_materialized_view: ($) =>
    prec.right(
      seq(
        $.keyword_create,
        optional($._or_replace),
        $.keyword_materialized,
        $.keyword_view,
        field('name', $.object_reference),
        optional(paren_list($.identifier, true)),
        repeat(choice($.cluster_by, $.view_option)),
        $.keyword_as,
        $.create_query,
      ),
    ),

  // CREATE [OR REPLACE] DYNAMIC TABLE name
  //   TARGET_LAG = '..' WAREHOUSE = '..' [COMMENT = ''] AS query
  create_dynamic_table: ($) =>
    prec.right(
      seq(
        $.keyword_create,
        optional($._or_replace),
        $.keyword_dynamic,
        $.keyword_table,
        field('name', $.object_reference),
        repeat1($.option),
        $.keyword_as,
        $.create_query,
      ),
    ),

  view_option: ($) => choice(seq($.keyword_copy, $.keyword_grants), $.option),

  // CREATE [OR REPLACE] [TEMPORARY] STAGE name
  //   [URL = ''] [STORAGE_INTEGRATION = x] [CREDENTIALS = (...)]
  //   [ENCRYPTION = (...)] [FILE_FORMAT = (...)] [COPY_OPTIONS = (...)]
  //   [COMMENT = '']
  create_stage: ($) =>
    prec.right(
      seq(
        $.keyword_create,
        optional($._or_replace),
        optional($.keyword_temporary),
        $.keyword_stage,
        optional($._if_not_exists),
        field('name', $.object_reference),
        repeat($.option),
      ),
    ),

  // CREATE [OR REPLACE] FILE FORMAT name TYPE = csv [options ...]
  create_file_format: ($) =>
    prec.right(
      seq(
        $.keyword_create,
        optional($._or_replace),
        $.keyword_file,
        $.keyword_format,
        optional($._if_not_exists),
        field('name', $.object_reference),
        repeat1($.option),
      ),
    ),

  // CREATE [OR REPLACE] [TEMPORARY] STREAM name ON TABLE t
  //   [APPEND_ONLY = ...] [INSERT_ONLY = ...] [SHOW_INITIAL_ROWS = ...]
  //   [COMMENT = '']
  create_stream: ($) =>
    prec.right(
      seq(
        $.keyword_create,
        optional($._or_replace),
        optional($.keyword_temporary),
        $.keyword_stream,
        optional($._if_not_exists),
        field('name', $.object_reference),
        $.keyword_on,
        $.keyword_table,
        field('table', $.object_reference),
        repeat($.option),
      ),
    ),

  // CREATE [OR REPLACE] PIPE name [AUTO_INGEST = ...]
  //   [ERROR_INTEGRATION = ...] [COMMENT = ''] AS COPY INTO ...
  create_pipe: ($) =>
    prec.right(
      seq(
        $.keyword_create,
        optional($._or_replace),
        $.keyword_pipe,
        optional($._if_not_exists),
        field('name', $.object_reference),
        repeat($.option),
        $.keyword_as,
        $.copy_into_statement,
      ),
    ),

  // CREATE [OR REPLACE] WAREHOUSE [IF NOT EXISTS] name
  //   [WITH] [WAREHOUSE_SIZE = 'XSMALL' ... options]
  create_warehouse: ($) =>
    prec.right(
      seq(
        $.keyword_create,
        optional($._or_replace),
        $.keyword_warehouse,
        optional($._if_not_exists),
        field('name', $.object_reference),
        optional($.keyword_with),
        repeat($.option),
      ),
    ),

  // CREATE [OR REPLACE | TRANSIENT] DATABASE [IF NOT EXISTS] name
  //   [options]
  create_database: ($) =>
    prec.right(
      seq(
        $.keyword_create,
        optional($._or_replace),
        optional($.keyword_transient),
        $.keyword_database,
        optional($._if_not_exists),
        field('name', $.object_reference),
        repeat($.option),
      ),
    ),

  // CREATE [OR REPLACE] SCHEMA [IF NOT EXISTS] name [options]
  create_schema: ($) =>
    prec.right(
      seq(
        $.keyword_create,
        optional($._or_replace),
        $.keyword_schema,
        optional($._if_not_exists),
        field('name', $.object_reference),
        repeat($.option),
      ),
    ),

  // CREATE [OR REPLACE] ROLE [IF NOT EXISTS] name [options]
  // The scripted role files carry a trailing COMMENT = '...' option.
  create_role: ($) =>
    prec.right(
      seq(
        $.keyword_create,
        optional($._or_replace),
        $.keyword_role,
        optional($._if_not_exists),
        field('name', $.identifier),
        repeat($.option),
      ),
    ),

  // CREATE [OR REPLACE] USER name [PASSWORD = ...] [options]
  create_user: ($) =>
    prec.right(
      seq(
        $.keyword_create,
        optional($._or_replace),
        $.keyword_user,
        optional($._if_not_exists),
        field('name', $.identifier),
        repeat($.option),
      ),
    ),

  // CREATE [OR REPLACE] SEQUENCE [IF NOT EXISTS] name
  //   [WITH] [START [WITH] n] [INCREMENT [BY] n] [options]
  create_sequence: ($) =>
    prec.right(
      seq(
        $.keyword_create,
        optional($._or_replace),
        $.keyword_sequence,
        optional($._if_not_exists),
        field('name', $.object_reference),
        optional($.keyword_with),
        repeat($.option),
      ),
    ),

  // CREATE [OR REPLACE] TAG [IF NOT EXISTS] name
  //   [ALLOWED_VALUES 'a', 'b'] [COMMENT = '']
  // The name is a full object reference: tags are schema objects and may
  // be qualified.
  create_tag: ($) =>
    prec.right(
      seq(
        $.keyword_create,
        optional($._or_replace),
        $.keyword_tag,
        optional($._if_not_exists),
        field('name', $.object_reference),
        optional(seq($.identifier, comma_list(alias($._single_quote_string, $.literal), true))),
        repeat($.option),
      ),
    ),

  // CREATE [OR REPLACE] {STORAGE | API | SECURITY | NOTIFICATION |
  //   EXTERNAL ACCESS} INTEGRATION [IF NOT EXISTS] name [options]
  create_integration: ($) =>
    prec.right(
      seq(
        $.keyword_create,
        optional($._or_replace),
        choice(
          $.keyword_storage,
          $.keyword_api,
          $.keyword_security,
          $.keyword_notification,
          seq($.keyword_external, $.keyword_access),
        ),
        $.keyword_integration,
        optional($._if_not_exists),
        field('name', $.identifier),
        repeat1($.option),
      ),
    ),
};
