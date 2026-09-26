// Small clauses shared across statement families, kept in one place so
// every `IF [NOT] EXISTS` reference resolves to the same rule.
export default {

  _if_not_exists: $ => seq($.keyword_if, $.keyword_not, $.keyword_exists),
  _if_exists_clause: $ => seq($.keyword_if, $.keyword_exists),

};
