import assert from "node:assert";
import { test } from "node:test";
import Parser from "tree-sitter";

test("can load grammar", async () => {
  const parser = new Parser();
  await assert.doesNotReject(async () => {
    const { default: language } = await import("./index.js");
    parser.setLanguage(language);
  });
});

test("exports node type metadata", async () => {
  const { default: language } = await import("./index.js");
  assert(Array.isArray(language.nodeTypeInfo));
  assert(language.nodeTypeInfo.some((node) => node.type === "program"));
});

test("exports the snowflake language name", async () => {
  const { default: language } = await import("./index.js");
  assert.equal(language.name, "snowflake");
});

test("parses a dollar-quoted body without error", async () => {
  const { default: language } = await import("./index.js");
  const parser = new Parser();
  parser.setLanguage(language);
  const tree = parser.parse("CREATE PROCEDURE p() RETURNS STRING LANGUAGE JAVASCRIPT AS $$return 1;$$;");
  assert.equal(tree.rootNode.hasError, false);
});
