use crate::{Body, Error, ExecutionRights, Language, RoutineKind, descendants};
use std::ops::Range;
use tree_sitter::{Node, Parser, Query, QueryCursor, StreamingIterator, Tree};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum Severity {
    /// A documented restriction matched syntactically; symbol identity is unproven.
    Warning,
    /// A proxy that requires review, not proof of a runtime violation.
    Advisory,
}

#[derive(Debug, Clone, Copy)]
pub struct Rule {
    pub id: &'static str,
    pub message: &'static str,
    pub severity: Severity,
}

// One `const` per rule ID, referenced both in `RULES` below and at every
// `finding_by_rule()` call site — a renamed or mistyped ID is then a
// compile error at the call site, rather than a string that
// type-checks but panics inside `finding_by_rule()`'s `.unwrap()` on
// ordinary input.
pub const JS_EVAL: &str = "js-eval";
pub const JS_IMPORT: &str = "js-import";
pub const JS_HOST_API: &str = "js-host-api";
pub const PYTHON_PROCESS: &str = "python-process";
pub const CONCURRENCY: &str = "concurrency";
pub const SESSION_BUILDER: &str = "session-builder";
pub const JDBC_CONNECTION: &str = "jdbc-connection";
pub const PYTHON_PUT_GET: &str = "python-put-get";
pub const PYTHON_GET_PATTERN: &str = "python-get-pattern";
pub const LOCAL_WRITE_PATH: &str = "local-write-path";
pub const OWNER_TEMP_OBJECT: &str = "owner-temp-object";
pub const SCALA_TASK_WAREHOUSE: &str = "scala-task-warehouse";

pub const RULES: &[Rule] = &[
    Rule {
        id: JS_EVAL,
        message: "Snowflake JavaScript does not provide eval; review this call's binding.",
        severity: Severity::Warning,
    },
    Rule {
        id: JS_IMPORT,
        message: "Snowflake JavaScript has no external library import mechanism.",
        severity: Severity::Warning,
    },
    Rule {
        id: JS_HOST_API,
        message: "This browser/network API is not provided by the Snowflake JavaScript engine.",
        severity: Severity::Advisory,
    },
    Rule {
        id: PYTHON_PROCESS,
        message: "Process creation is unsupported in Python stored procedures; review this call's binding.",
        severity: Severity::Warning,
    },
    Rule {
        id: CONCURRENCY,
        message: "Review concurrency: concurrent queries are unsupported; this construct alone does not prove concurrent queries.",
        severity: Severity::Advisory,
    },
    Rule {
        id: SESSION_BUILDER,
        message: "Creating a new Snowpark session is unsupported in Java/Scala stored procedures; review this builder use.",
        severity: Severity::Advisory,
    },
    Rule {
        id: JDBC_CONNECTION,
        message: "Access to the Snowpark session JDBC connection is unsupported in stored procedures.",
        severity: Severity::Warning,
    },
    Rule {
        id: PYTHON_PUT_GET,
        message: "Python stored procedures cannot execute PUT/GET through SQL APIs.",
        severity: Severity::Warning,
    },
    Rule {
        id: PYTHON_GET_PATTERN,
        message: "Snowpark file.get in a Python stored procedure does not support stage-path pattern matching.",
        severity: Severity::Warning,
    },
    Rule {
        id: LOCAL_WRITE_PATH,
        message: "Java/Scala procedure file downloads must write within /tmp; review this literal destination.",
        severity: Severity::Warning,
    },
    Rule {
        id: OWNER_TEMP_OBJECT,
        message: "Named temporary objects are unsupported in owner-rights Snowpark procedures, including default owner rights.",
        severity: Severity::Warning,
    },
    Rule {
        id: SCALA_TASK_WAREHOUSE,
        message: "This task calls a locally declared Scala procedure but has no warehouse; confirm name resolution and task configuration.",
        severity: Severity::Advisory,
    },
];

#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub struct Finding {
    pub rule_id: &'static str,
    pub message: &'static str,
    pub severity: Severity,
    /// Absolute half-open byte range in the original SQL source.
    pub range: Range<usize>,
}

// `name` here is a tree-sitter query capture name, not necessarily a rule
// ID — the caller falls through to its own non-rule capture handling
// (`"sql"`, `"stage-path"`, ...) when this returns `None`, so a lookup
// miss is an expected, ordinary outcome, not a programming error.
fn finding(name: &str, range: Range<usize>) -> Option<Finding> {
    RULES.iter().find(|r| r.id == name).map(|rule| Finding {
        rule_id: rule.id,
        message: rule.message,
        severity: rule.severity,
        range,
    })
}

// Builds a `Finding` for one of this module's own `RULES` entries. Takes
// the rule's `const` (not an arbitrary `&str`) so a renamed or mistyped
// ID fails to compile at the call site instead of panicking here or,
// worse, silently doing nothing the way an `Option`-swallowing call site
// could.
fn finding_by_rule(id: &'static str, range: Range<usize>) -> Finding {
    let rule = RULES
        .iter()
        .find(|r| r.id == id)
        .unwrap_or_else(|| panic!("internal error: no RULES entry for id {id:?}"));
    Finding {
        rule_id: rule.id,
        message: rule.message,
        severity: rule.severity,
        range,
    }
}

pub(crate) fn check(
    body: &Body,
    tree: &Tree,
    query: &Query,
    sql_parser: &mut Parser,
) -> Result<Vec<Finding>, Error> {
    let source = body.source.as_ref().unwrap();
    let text = source.text();
    let mut cursor = QueryCursor::new();
    let mut matches = cursor.matches(query, tree.root_node(), text.as_bytes());
    let mut findings = Vec::new();
    while let Some(matched) = matches.next() {
        for (name, node) in query
            .capture_names()
            .iter()
            .enumerate()
            .flat_map(|(index, &name)| {
                matched
                    .nodes_for_capture_index(index as u32)
                    .map(move |node| (name, node))
            })
        {
            // The references for Snowpark rules describe procedures, not UDFs.
            if body.routine_kind == RoutineKind::Function && body.language != Language::JavaScript {
                continue;
            }
            let Some(range) = source.source_range(node.byte_range()) else {
                continue;
            };
            if let Some(diagnostic) = finding(name, range.clone()) {
                findings.push(diagnostic);
                continue;
            }
            match name {
                "sql" => {
                    if let Some(sql) = literal(node, text, body.language) {
                        check_sql(&sql, body, range, sql_parser, &mut findings)?;
                    }
                }
                "stage-path" => {
                    if literal(node, text, body.language)
                        .is_some_and(|s| s.chars().any(|c| "*?[]".contains(c)))
                    {
                        findings.push(finding_by_rule(PYTHON_GET_PATTERN, range));
                    }
                }
                "local-path"
                    if literal(node, text, body.language).is_some_and(|s| !within_tmp(&s)) =>
                {
                    findings.push(finding_by_rule(LOCAL_WRITE_PATH, range));
                }
                _ => {}
            }
        }
    }
    if cursor.did_exceed_match_limit() {
        return Err(Error("Restriction query match limit exceeded".into()));
    }
    findings.sort_by_key(|f| (f.range.start, f.range.end, f.rule_id));
    findings.dedup();
    Ok(findings)
}

fn check_sql(
    sql: &str,
    body: &Body,
    range: Range<usize>,
    parser: &mut Parser,
    findings: &mut Vec<Finding>,
) -> Result<(), Error> {
    let tree = parser
        .parse(sql, None)
        .ok_or_else(|| Error("Literal SQL parse cancelled".into()))?;
    if tree.root_node().has_error() {
        return Ok(());
    }
    for node in descendants(tree.root_node()) {
        if matches!(node.kind(), "put_statement" | "get_statement") {
            if body.language == Language::Python {
                findings.push(finding_by_rule(PYTHON_PUT_GET, range.clone()));
            } else if node.kind() == "get_statement" {
                // GET's local destination is the only write path. PUT reads a
                // local source, so a non-/tmp PUT source is not a write violation.
                let local = descendants(node)
                    .into_iter()
                    .find(|n| n.kind() == "literal");
                if let Some(local) = local {
                    let path = sql[local.byte_range()].trim_matches('\'');
                    if !within_tmp(path) {
                        findings.push(finding_by_rule(LOCAL_WRITE_PATH, range.clone()));
                    }
                }
            }
        }
        if body.rights == ExecutionRights::Owner && node.kind().starts_with("create_") {
            let mut cursor = node.walk();
            if node
                .named_children(&mut cursor)
                .any(|n| n.kind() == "keyword_temporary")
            {
                findings.push(finding_by_rule(OWNER_TEMP_OBJECT, range.clone()));
            }
        }
    }
    Ok(())
}

fn within_tmp(path: &str) -> bool {
    let path = path.strip_prefix("file://").unwrap_or(path);
    if !path.starts_with('/') || path.contains('\\') {
        return false;
    }
    let mut segments = Vec::new();
    for part in path.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                segments.pop();
            }
            _ => segments.push(part),
        }
    }
    segments.first() == Some(&"tmp")
}

/// Decode a conservative subset of each embedded language's literal syntax.
/// Dynamic/interpolated strings and unsupported escapes are deliberately skipped.
fn literal(node: Node<'_>, text: &str, language: Language) -> Option<String> {
    if descendants(node)
        .iter()
        .any(|n| matches!(n.kind(), "interpolation" | "template_substitution"))
    {
        return None;
    }
    let mut raw = &text[node.byte_range()];
    let mut raw_string = false;
    if language == Language::Python {
        let prefix_end = raw.find(['\'', '"'])?;
        let prefix = raw[..prefix_end].to_ascii_lowercase();
        if !matches!(prefix.as_str(), "" | "u" | "r") {
            return None;
        }
        raw_string = prefix == "r";
        raw = &raw[prefix_end..];
    }
    let delimiter = if raw.starts_with("\"\"\"") {
        "\"\"\""
    } else if raw.starts_with("'''") {
        "'''"
    } else if raw.starts_with('"') {
        "\""
    } else if raw.starts_with('\'') {
        "'"
    } else {
        return None;
    };
    let inner = raw.strip_prefix(delimiter)?.strip_suffix(delimiter)?;
    if raw_string || (language == Language::Scala && delimiter.len() == 3) {
        return Some(inner.to_owned());
    }
    let mut result = String::new();
    let mut chars = inner.chars();
    while let Some(c) = chars.next() {
        if c != '\\' {
            result.push(c);
            continue;
        }
        let escaped = chars.next()?;
        result.push(match escaped {
            'n' => '\n',
            'r' => '\r',
            't' => '\t',
            'b' => '\u{8}',
            'f' => '\u{c}',
            '\\' => '\\',
            '\'' => '\'',
            '"' => '"',
            'u' | 'x' => {
                if escaped == 'x' && matches!(language, Language::Java | Language::Scala) {
                    return None;
                }
                let count = if escaped == 'u' { 4 } else { 2 };
                let digits: String = chars.by_ref().take(count).collect();
                if digits.len() != count {
                    return None;
                }
                char::from_u32(u32::from_str_radix(&digits, 16).ok()?)?
            }
            _ => return None,
        });
    }
    Some(result)
}

pub(crate) fn tasks(sql: &str, tree: &Tree, bodies: &[Body]) -> Vec<Finding> {
    let mut result = Vec::new();
    let declarations: Vec<_> = descendants(tree.root_node())
        .into_iter()
        .filter(|n| matches!(n.kind(), "create_procedure" | "alter_procedure"))
        .filter_map(|n| n.child_by_field_name("name"))
        .map(|n| canonical_name(&sql[n.byte_range()]))
        .collect();
    for task in descendants(tree.root_node())
        .into_iter()
        .filter(|n| n.kind() == "create_task" && !n.has_error())
    {
        let Some(task_body) = task.child_by_field_name("body") else {
            continue;
        };
        let warehouse = descendants(task).iter().any(|n| {
            n.kind() == "task_option"
                && n.end_byte() < task_body.start_byte()
                && n.child_by_field_name("warehouse").is_some()
        });
        if warehouse {
            continue;
        }
        for call in descendants(task_body)
            .into_iter()
            .filter(|n| n.kind() == "call_statement")
        {
            let reference = descendants(call)
                .into_iter()
                .find(|n| n.kind() == "object_reference");
            let Some(reference) = reference else { continue };
            let name = canonical_name(&sql[reference.byte_range()]);
            // Same-file exact qualification only. Multiple overloads are ambiguous.
            let candidates: Vec<_> = bodies
                .iter()
                .filter(|b| {
                    b.routine_kind == RoutineKind::Procedure && canonical_name(&b.name) == name
                })
                .collect();
            if candidates.len() == 1
                && candidates[0].language == Language::Scala
                && candidates[0].source.is_some()
                && declarations.iter().filter(|n| **n == name).count() == 1
            {
                result.push(finding_by_rule(SCALA_TASK_WAREHOUSE, call.byte_range()));
            }
        }
    }
    result
}

fn canonical_name(name: &str) -> String {
    // Preserve quoted identifiers exactly, including dots and doubled quotes.
    let mut quoted = false;
    name.chars()
        .flat_map(|c| {
            if c == '"' {
                quoted = !quoted;
            }
            if quoted || c == '"' {
                vec![c]
            } else if c.is_whitespace() {
                Vec::new()
            } else {
                c.to_uppercase().collect()
            }
        })
        .collect()
}
