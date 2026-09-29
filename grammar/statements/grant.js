import { comma_list, wrapped_in_parenthesis } from '../helpers.js';

// Snowflake GRANT and REVOKE, including future grants and role grants.
// The privilege vocabulary is large and partly non-reserved; the words
// that are already keywords (SELECT, INSERT, USAGE, CREATE ...) are
// matched as keywords and everything else (OWNERSHIP, MONITOR, OPERATE,
// READ, WRITE, EVOLVE ...) lexes as an identifier, which keyword
// extraction keeps working in exactly this position.
export default {
  // prec.right: the trailing WITH GRANT OPTION / GRANTED BY clauses bind
  // to the grant rather than reading as a following statement's WITH.
  grant_statement: ($) =>
    prec.right(
      seq(
        $.keyword_grant,
        choice(
          alias($._grant_privilege_core, $.grant_core),
          seq($.keyword_role, comma_list(field('role', $.identifier), true), $._granted_to),
        ),
        optional(seq($.keyword_with, $.keyword_grant, $.keyword_option)),
        optional(seq($.keyword_granted, $.keyword_by, $.keyword_role, $.identifier)),
      ),
    ),

  revoke_statement: ($) =>
    seq(
      $.keyword_revoke,
      optional(seq($.keyword_grant, $.keyword_option, $.keyword_for)),
      choice(
        alias($._grant_privilege_core, $.grant_core),
        seq($.keyword_role, comma_list(field('role', $.identifier), true), $._revoked_from),
      ),
      optional(choice($.keyword_cascade, $.keyword_restrict)),
    ),

  // <privileges> ON [ALL | FUTURE] <object kind> [<ref> | IN <database|schema> <ref>]
  // shared by GRANT and REVOKE through the alias above. The kind may be
  // any plural or future object word — the keyword kinds cover the ones
  // the grammar knows, an identifier covers the rest (TABLES, STREAMLITS,
  // ...).
  _grant_privilege_core: ($) =>
    seq(
      choice(
        $.privilege_list,
        seq($.keyword_all, optional($.keyword_privileges)),
        $.keyword_ownership,
      ),
      $.keyword_on,
      choice(
        seq(
          optional(choice($.keyword_all, $.keyword_future)),
          $.object_kind,
          optional(
            seq(
              $.keyword_in,
              optional(choice($.keyword_database, $.keyword_schema)),
              $.object_reference,
            ),
          ),
          // PROCEDURE and FUNCTION grants name the signature, not just the
          // object: ON PROCEDURE db.s.p(VARCHAR, NUMBER). A FUTURE ... IN
          // <schema> grant carries no object reference at all.
          optional(
            seq($.object_reference, optional(wrapped_in_parenthesis(comma_list($._type, false)))),
          ),
        ),
        $.object_reference,
      ),
      choice($._granted_to, $._revoked_from),
    ),

  privilege_list: ($) => comma_list($.privilege, true),

  // A privilege, with trailing identifier words the multi-word
  // privileges carry (EVOLVE SCHEMA, CREATE DATABASE ROLE, IMPORTED
  // PRIVILEGES, ERROR TABLE, ...).
  privilege: ($) =>
    prec.right(
      seq(
        choice(
          $.keyword_select,
          $.keyword_insert,
          $.keyword_update,
          $.keyword_delete,
          $.keyword_references,
          $.keyword_usage,
          $.keyword_monitor,
          $.keyword_operate,
          $.keyword_evolve,
          $.keyword_create,
          $.keyword_imported,
          $.keyword_ownership,
          $.identifier,
        ),
        repeat($.identifier),
      ),
    ),

  // The object kinds a privilege may name. The single-word kinds are
  // keywords already; FILE FORMAT is two.
  object_kind: ($) =>
    choice(
      $.keyword_table,
      $.keyword_view,
      $.keyword_materialized_view,
      $.keyword_stage,
      $.keyword_file_format,
      $.keyword_function,
      $.keyword_procedure,
      $.keyword_sequence,
      $.keyword_stream,
      $.keyword_task,
      $.keyword_pipe,
      $.keyword_integration,
      $.keyword_database,
      $.keyword_schema,
      $.keyword_warehouse,
      $.keyword_role,
      $.keyword_user,
      $.keyword_streamlit,
      $.keyword_agent,
      $.identifier,
    ),

  keyword_materialized_view: ($) => seq($.keyword_materialized, $.keyword_view),
  keyword_file_format: ($) => seq($.keyword_file, $.keyword_format),

  _granted_to: ($) => seq($.keyword_to, comma_list($.grantee, true)),

  _revoked_from: ($) => seq($.keyword_from, comma_list($.grantee, true)),

  // ROLE r | USER u | SHARE s | PUBLIC | a bare role name
  grantee: ($) =>
    choice(
      seq($.keyword_role, $.identifier),
      seq($.keyword_user, $.identifier),
      seq($.keyword_share, $.identifier),
      $.keyword_public,
      $.identifier,
    ),
};
