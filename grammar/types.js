import { comma_list, wrapped_in_parenthesis } from './helpers.js';

// Snowflake's data types. Anything not listed here — a custom type written
// by an account admin — is a `custom_type`: an identifier
// with an optional parameter list.
export default {
  _type: ($) =>
    prec.left(
      choice(
        $.number,
        $.keyword_int,
        $.keyword_float,
        $.keyword_double,
        $.keyword_double_prec_only,
        $.keyword_boolean,
        $.keyword_char,
        $.varchar,
        $.keyword_string,
        $.binary,
        $.keyword_date,
        $.keyword_datetime,
        $.time,
        $.timestamp,
        $.keyword_variant,
        $.keyword_object,
        $.keyword_array,
        $.keyword_geography,
        $.keyword_geometry,
        $.vector,
        $.custom_type,
      ),
    ),

  // NUMBER[(precision[, scale])] — the spelling NUMBER/NUMERIC/DECIMAL/DEC
  // all name the same type; the corpus writes both bare and parameterized.
  number: ($) =>
    prec.right(
      choice(
        $.keyword_number,
        seq($.keyword_number, wrapped_in_parenthesis(comma_list($.literal, true))),
      ),
    ),

  // VARCHAR with an optional length: VARCHAR(16777216). Snowflake ignores
  // the length for most purposes, but the corpus writes it constantly.
  varchar: ($) =>
    prec.right(
      choice($.keyword_varchar, seq($.keyword_varchar, wrapped_in_parenthesis($.literal))),
    ),

  // BINARY(n) — the fixed-length binary type with its size.
  binary: ($) =>
    prec.right(choice($.keyword_binary, seq($.keyword_binary, wrapped_in_parenthesis($.literal)))),

  // TIME(p) / TIMESTAMP[(p)] — Snowflake's timestamps carry no precision
  // by default and at most a scale when they do.
  time: ($) =>
    prec.right(choice($.keyword_time, seq($.keyword_time, wrapped_in_parenthesis($.literal)))),

  timestamp: ($) =>
    prec.right(
      choice($.keyword_timestamp, seq($.keyword_timestamp, wrapped_in_parenthesis($.literal))),
    ),

  // VECTOR(TYPE, count) — the embedding column type, whose parameters are
  // an element type and a fixed dimension.
  vector: ($) =>
    prec.right(seq($.keyword_vector, wrapped_in_parenthesis(seq($._type, ',', $.literal)))),

  // A user-defined or vendor type with an optional parameter list.
  custom_type: ($) =>
    prec.right(
      seq(
        $.identifier,
        optional(wrapped_in_parenthesis(comma_list(choice($.literal, $.identifier), true))),
      ),
    ),
};
