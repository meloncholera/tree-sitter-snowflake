export function make_keyword(word) {
  let str = "";
  for (var i = 0; i < word.length; i++) {
    str = str + "[" + word.charAt(i).toLowerCase() + word.charAt(i).toUpperCase() + "]";
  }
  return new RegExp(str);
}

export function optional_parenthesis(node) {
  return prec.right(
    choice(
      node,
      wrapped_in_parenthesis(node),
    ),
  )
}

export function wrapped_in_parenthesis(node) {
  if (node) {
    return seq("(", node, ")");
  }
  return seq("(", ")");
}

export function comma_list(field, requireFirst) {
  let sequence = seq(field, repeat(seq(',', field)));

  if (requireFirst) {
    return sequence;
  }

  return optional(sequence);
}

export function paren_list(field, requireFirst) {
  return wrapped_in_parenthesis(
    comma_list(field, requireFirst),
  )
}

// The `SET <options> | UNSET <names>` alternative pair every ALTER
// object shares. A plain function, not a named rule, so callers can
// spread it alongside their own alternatives in one surrounding
// `choice`/`repeat1`.
export function set_unset_properties($) {
  return [
    seq($.keyword_set, comma_list($.option, true)),
    seq($.keyword_unset, comma_list($.identifier, true)),
  ];
}

// A stage path, unquoted (the common form) or single-quoted — Snowflake
// requires the quoted form when the internal path contains spaces or
// characters the bare stage_reference token can't lex (PUT/GET/LIST/
// REMOVE/COPY INTO's stage operand, not the SELECT ... FROM @stage form).
export function stage_reference_or_quoted($) {
  return choice(
    $.stage_reference,
    alias($._single_quote_string, $.stage_reference),
  );
}

// `;`-terminated statements — the body shape every scripting block and
// the `$$` script share. Snowflake requires the terminator after each
// scripting statement. A plain function, not a named rule: the empty-body
// case would make a named rule match the empty string, which tree-sitter
// rejects outside the start rule. Keeping the terminator mandatory is
// also what keeps statement-initial keywords (BREAK, LET, RETURN, ...)
// out of the AS-less alias slot — with the terminator optional inside a
// body, the state after any completed statement also accepts a fresh
// statement, and LALR merges that with the alias slot's state. DECLARE
// self-terminates (each declaration carries its own `;`) so it takes no
// separator after it.
export function statement_list($) {
  return repeat(choice(
    $.declare_statement,
    seq($.statement, ';'),
  ))
}
