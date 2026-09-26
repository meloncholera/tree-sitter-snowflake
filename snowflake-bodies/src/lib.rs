//! Shared extraction, parsing, and advisory checks for Snowflake handler bodies.
//! Returned embedded trees use decoded-body byte offsets; translate them through
//! [`BodySource`] before reporting findings in the SQL file. This crate computes
//! no complexity totals. Consumers attribute their measurements to the SQL file.

#![doc = include_str!("../README.md")]

mod checks;
mod extract;
mod source;

pub use checks::{Finding, RULES, Rule, Severity};
pub use source::{BodySource, source_point};
pub use tree_sitter;

use std::{collections::HashMap, fmt, ops::Range};
use tree_sitter::{Parser, Query, Tree};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Language {
    JavaScript,
    Python,
    Java,
    Scala,
}

impl Language {
    pub fn grammar(self) -> Option<tree_sitter::Language> {
        match self {
            Self::JavaScript => Some(tree_sitter_javascript::LANGUAGE.into()),
            Self::Python => Some(tree_sitter_python::LANGUAGE.into()),
            Self::Java => {
                #[cfg(feature = "java")]
                {
                    Some(tree_sitter_java::LANGUAGE.into())
                }
                #[cfg(not(feature = "java"))]
                {
                    None
                }
            }
            Self::Scala => {
                #[cfg(feature = "scala")]
                {
                    Some(tree_sitter_scala::LANGUAGE.into())
                }
                #[cfg(not(feature = "scala"))]
                {
                    None
                }
            }
        }
    }

    /// Queries ship even when the corresponding optional parser is disabled.
    pub fn query(self) -> &'static str {
        match self {
            Self::JavaScript => include_str!("../queries/javascript.scm"),
            Self::Python => include_str!("../queries/python.scm"),
            Self::Java => include_str!("../queries/java.scm"),
            Self::Scala => include_str!("../queries/scala.scm"),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RoutineKind {
    Procedure,
    Function,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExecutionRights {
    Owner,
    Caller,
    Unknown,
    NotApplicable,
}

/// An unavailable/invalid body must never be interpreted as measured at zero.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub enum BodyStatus {
    Parsed,
    UnavailableLanguage,
    InvalidSql,
    InvalidEncoding(String),
    InvalidBody,
}

#[derive(Debug)]
#[non_exhaustive]
pub struct Body {
    pub name: String,
    pub routine_kind: RoutineKind,
    pub language: Language,
    pub rights: ExecutionRights,
    pub routine_range: Range<usize>,
    pub body_range: Range<usize>,
    pub source: Option<BodySource>,
    pub tree: Option<Tree>,
    pub status: BodyStatus,
    /// Embedded syntax errors, translated into absolute SQL byte ranges.
    pub parse_errors: Vec<Range<usize>>,
    pub findings: Vec<Finding>,
}

#[derive(Debug)]
#[non_exhaustive]
pub struct Analysis {
    pub sql_tree: Tree,
    pub sql_errors: Vec<Range<usize>>,
    pub bodies: Vec<Body>,
    /// Cross-statement checks, such as a Scala task without a warehouse.
    pub findings: Vec<Finding>,
}

#[derive(Debug)]
pub struct Error(String);
impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}
impl std::error::Error for Error {}

/// Reuse an analyzer across files to retain compiled parsers and queries.
pub struct Analyzer {
    sql: Parser,
    embedded: HashMap<Language, (Parser, Query)>,
}

impl Analyzer {
    pub fn new() -> Result<Self, Error> {
        let mut sql = Parser::new();
        sql.set_language(&tree_sitter_snowflake::LANGUAGE.into())
            .map_err(|e| Error(e.to_string()))?;
        let mut embedded = HashMap::new();
        for language in [
            Language::JavaScript,
            Language::Python,
            Language::Java,
            Language::Scala,
        ] {
            if let Some(grammar) = language.grammar() {
                let mut parser = Parser::new();
                parser
                    .set_language(&grammar)
                    .map_err(|e| Error(e.to_string()))?;
                let query =
                    Query::new(&grammar, language.query()).map_err(|e| Error(e.to_string()))?;
                embedded.insert(language, (parser, query));
            }
        }
        Ok(Self { sql, embedded })
    }

    pub fn analyze(&mut self, sql: &str) -> Result<Analysis, Error> {
        let sql_tree = self
            .sql
            .parse(sql, None)
            .ok_or_else(|| Error("SQL parse cancelled".into()))?;
        let sql_errors = error_ranges(sql_tree.root_node());
        let mut bodies = extract::bodies(sql, &sql_tree);
        for body in &mut bodies {
            let Some(source) = &body.source else { continue };
            let Some((parser, query)) = self.embedded.get_mut(&body.language) else {
                body.status = BodyStatus::UnavailableLanguage;
                continue;
            };
            let tree = parser
                .parse(source.text(), None)
                .ok_or_else(|| Error("Body parse cancelled".into()))?;
            body.parse_errors = error_ranges(tree.root_node())
                .into_iter()
                .filter_map(|range| source.source_range(range))
                .collect();
            body.status = if tree.root_node().has_error() {
                BodyStatus::InvalidBody
            } else {
                BodyStatus::Parsed
            };
            // Partial trees are exposed for inspection, but are not checked as if valid.
            if body.status == BodyStatus::Parsed {
                body.findings = checks::check(body, &tree, query, &mut self.sql)?;
            }
            body.tree = Some(tree);
        }
        let findings = checks::tasks(sql, &sql_tree, &bodies);
        Ok(Analysis {
            sql_tree,
            sql_errors,
            bodies,
            findings,
        })
    }
}

pub(crate) fn descendants(root: tree_sitter::Node<'_>) -> Vec<tree_sitter::Node<'_>> {
    let mut nodes = Vec::new();
    let mut stack = vec![root];
    while let Some(node) = stack.pop() {
        nodes.push(node);
        let mut cursor = node.walk();
        let children: Vec<_> = node.named_children(&mut cursor).collect();
        stack.extend(children.into_iter().rev());
    }
    nodes
}

fn error_ranges(root: tree_sitter::Node<'_>) -> Vec<Range<usize>> {
    let mut errors = Vec::new();
    let mut stack = vec![root];
    while let Some(node) = stack.pop() {
        if node.is_error() || node.is_missing() {
            errors.push(node.byte_range());
        } else {
            let mut cursor = node.walk();
            stack.extend(node.children(&mut cursor));
        }
    }
    errors.sort_by_key(|r| r.start);
    errors
}
