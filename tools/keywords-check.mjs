// Finds repeated `keyword_*` object keys in grammar/keywords.js. JavaScript
// silently keeps the later declaration, so a duplicate key is a correctness
// bug: an edit to the earlier copy has no effect on the grammar.
export function findDuplicateKeywordKeys(source) {
  const seen = new Set();
  const duplicates = new Set();
  for (const match of source.matchAll(/^\s*(keyword_[A-Za-z0-9_]*)\s*:/gm)) {
    const key = match[1];
    if (seen.has(key)) duplicates.add(key);
    seen.add(key);
  }
  return [...duplicates];
}
