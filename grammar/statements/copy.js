import { comma_list, paren_list, stage_reference_or_quoted } from "../helpers.js";

// Snowflake staging and data transfer: COPY INTO in both directions,
// PUT/GET, LIST, REMOVE.
export default {

  // COPY INTO <table> FROM <source> or COPY INTO <stage> FROM <table>
  //   [FILE_FORMAT = (...|name)] [copy options ...]
  // The source is a stage/path, a literal path, or a parenthesized
  // SELECT that transforms on the way in.
  copy_into_statement: $ => prec.right(seq(
    $.keyword_copy,
    $.keyword_into,
    choice(
      seq(
        field('target', $.object_reference),
        optional(paren_list($.identifier, true)),
        $.keyword_from,
        choice(
          $.stage_reference,
          alias($._single_quote_string, $.literal),
          $.subquery,
          $.object_reference,
        ),
      ),
      seq(
        field('target', stage_reference_or_quoted($)),
        $.keyword_from,
        choice(
          field('source', $.object_reference),
          $.subquery,
        ),
      ),
    ),
    repeat($.option),
  )),

  // PUT file://path @stage[/path] [options] — the local path may be
  // unquoted (the common form) or a quoted string.
  put_statement: $ => prec.right(seq(
    $.keyword_put,
    choice(alias($._file_uri, $.literal), alias($._single_quote_string, $.literal)),
    stage_reference_or_quoted($),
    repeat($.option),
  )),

  // GET @stage[/path] file://path [options]
  get_statement: $ => prec.right(seq(
    $.keyword_get,
    stage_reference_or_quoted($),
    choice(alias($._file_uri, $.literal), alias($._single_quote_string, $.literal)),
    repeat($.option),
  )),

  // LIST @stage[/path] [PATTERN = '...'] [options]
  list_statement: $ => prec.right(seq(
    $.keyword_list,
    stage_reference_or_quoted($),
    repeat($.option),
  )),

  // REMOVE @stage/path [options]
  remove_statement: $ => prec.right(seq(
    $.keyword_remove,
    stage_reference_or_quoted($),
    repeat($.option),
  )),

};
