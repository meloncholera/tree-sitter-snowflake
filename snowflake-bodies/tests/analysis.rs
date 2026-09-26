use snowflake_bodies::{Analyzer, BodyStatus, ExecutionRights, Language, Severity, source_point};

fn sql(language: &str, content: &str) -> String {
    format!("CREATE PROCEDURE p() RETURNS STRING LANGUAGE {language} AS $${content}$$;")
}

fn ids(analysis: &snowflake_bodies::Analysis) -> Vec<&str> {
    analysis
        .bodies
        .iter()
        .flat_map(|b| b.findings.iter().map(|f| f.rule_id))
        .collect()
}

#[test]
fn decodes_quotes_escapes_unicode_and_maps_ranges() {
    let sql = "-- é\r\nCREATE PROCEDURE p() RETURNS STRING LANGUAGE JAVASCRIPT AS 'let x = ''é'';\\n\\u0065val(''a'');';";
    let result = Analyzer::new().unwrap().analyze(sql).unwrap();
    assert!(result.sql_errors.is_empty());
    let body = &result.bodies[0];
    assert_eq!(body.status, BodyStatus::Parsed);
    let source = body.source.as_ref().unwrap();
    assert_eq!(source.text(), "let x = 'é';\neval('a');");
    let f = &body.findings[0];
    assert_eq!(f.rule_id, "js-eval");
    assert_eq!(&sql[f.range.clone()], "\\u0065val(''a'')");
    assert_eq!(source_point(sql, f.range.start).unwrap().row, 1);
    let quote = source.text().find('\'').unwrap();
    assert_eq!(&sql[source.source_range(quote..quote + 1).unwrap()], "''");
    let eof = sql.rfind("';").unwrap();
    assert_eq!(source.source_offset(source.text().len()), Some(eof));
    assert_eq!(
        source.source_range(source.text().len()..source.text().len()),
        Some(eof..eof)
    );
    assert_eq!(source.source_offset(source.text().len() + 1), None);
    assert_eq!(source.source_range(5..usize::MAX), None);
}

#[test]
fn numeric_and_unknown_escapes_and_empty_bodies() {
    let input = r#"CREATE FUNCTION f() RETURNS STRING LANGUAGE JAVASCRIPT AS 'return "\041\x21\u26c4\z\0";';"#;
    let result = Analyzer::new().unwrap().analyze(input).unwrap();
    let source = result.bodies[0].source.as_ref().unwrap();
    assert_eq!(source.text(), "return \"!!⛄z\0\";");
    let snowman = source.text().find('⛄').unwrap();
    for offset in snowman..snowman + 3 {
        assert_eq!(source.source_offset(offset), input.find(r"\u26c4"));
    }
    assert_eq!(
        &input[source.source_range(snowman..snowman + 3).unwrap()],
        r"\u26c4"
    );
    for quoted in ["''", "$$ $$"] {
        let input = format!("CREATE FUNCTION f() RETURNS STRING LANGUAGE JAVASCRIPT AS {quoted};");
        let analysis = Analyzer::new().unwrap().analyze(&input).unwrap();
        assert!(
            analysis.sql_errors.is_empty(),
            "{}",
            analysis.sql_tree.root_node().to_sexp()
        );
        assert_eq!(
            analysis.bodies[0].source.as_ref().unwrap().text().trim(),
            ""
        );
        assert_eq!(analysis.bodies[0].status, BodyStatus::Parsed);
    }

    // A three-digit octal escape and a two-digit hex escape both decode to
    // 'A' (0o101 == 0x41 == 65), each mapping back to its own source range.
    let input = r#"CREATE FUNCTION f() RETURNS STRING LANGUAGE JAVASCRIPT AS '\101\x41';"#;
    let result = Analyzer::new().unwrap().analyze(input).unwrap();
    let source = result.bodies[0].source.as_ref().unwrap();
    assert_eq!(source.text(), "AA");
    assert_eq!(&input[source.source_range(0..1).unwrap()], r"\101");
    assert_eq!(&input[source.source_range(1..2).unwrap()], r"\x41");

    // The grammar rejects a completely empty dollar body with no content at
    // all between the delimiters (unlike "$$ $$", which has whitespace) —
    // see the README's "Only Parsed bodies..." paragraph. This library
    // preserves that grammar behavior rather than working around it.
    let input = "CREATE FUNCTION f() RETURNS STRING LANGUAGE JAVASCRIPT AS $$$$;";
    let analysis = Analyzer::new().unwrap().analyze(input).unwrap();
    assert!(!analysis.sql_errors.is_empty());
}

#[test]
fn preserves_dollar_body_and_reports_javascript_rules() {
    let text = "// eval('ignored')\nconst s = 'require(1)';\neval('1'); require('x'); import('x'); fetch('x');";
    let input = sql("JAVASCRIPT", text);
    let result = Analyzer::new().unwrap().analyze(&input).unwrap();
    assert_eq!(result.bodies[0].source.as_ref().unwrap().text(), text);
    assert_eq!(
        ids(&result),
        ["js-eval", "js-import", "js-import", "js-host-api"]
    );
    let result = Analyzer::new()
        .unwrap()
        .analyze(&sql("JAVASCRIPT", "import x from 'x';"))
        .unwrap();
    assert_eq!(ids(&result), ["js-import"]);
}

#[test]
fn distinguishes_syntax_failure_unavailable_and_invalid_encoding() {
    let mut analyzer = Analyzer::new().unwrap();
    let result = analyzer.analyze(&sql("JAVASCRIPT", "let = ;")).unwrap();
    assert_eq!(result.bodies[0].status, BodyStatus::InvalidBody);
    assert!(!result.bodies[0].parse_errors.is_empty());
    assert!(result.bodies[0].findings.is_empty());
    for (name, language) in [("JAVA", Language::Java), ("SCALA", Language::Scala)] {
        let result = analyzer.analyze(&sql(name, "class Handler {} ")).unwrap();
        if language.grammar().is_none() {
            assert_eq!(result.bodies[0].status, BodyStatus::UnavailableLanguage);
            assert!(result.bodies[0].tree.is_none());
            assert!(result.bodies[0].source.is_some());
        } else {
            assert_eq!(result.bodies[0].status, BodyStatus::Parsed);
        }
    }
    let result = analyzer
        .analyze(r"CREATE PROCEDURE p() RETURNS STRING LANGUAGE JAVASCRIPT AS '\uD800';")
        .unwrap();
    assert!(matches!(
        result.bodies[0].status,
        BodyStatus::InvalidEncoding(_)
    ));
    assert!(result.bodies[0].source.is_none());
    let result = analyzer
        .analyze("CREATE PROCEDURE p( RETURNS STRING LANGUAGE JAVASCRIPT AS 'eval(1)';")
        .unwrap();
    assert!(!result.sql_errors.is_empty());
    assert!(result.bodies.iter().all(|b| b.status != BodyStatus::Parsed));
}

#[test]
fn python_restrictions_are_scoped_to_procedures_and_literal_calls() {
    let content = "import subprocess\nimport threading\nsubprocess.run(['x'])\nthreading.Thread(target=run)\nsession.sql('PUT file:///x @s')\nsession.file.get('@s/*.csv', '/tmp')\nsession.sql('CREATE TEMPORARY TABLE t (x INT)')\n";
    let mut analyzer = Analyzer::new().unwrap();
    let result = analyzer.analyze(&sql("PYTHON", content)).unwrap();
    assert_eq!(result.bodies[0].status, BodyStatus::Parsed);
    assert_eq!(
        ids(&result),
        [
            "python-process",
            "concurrency",
            "python-put-get",
            "python-get-pattern",
            "owner-temp-object"
        ]
    );
    assert_eq!(result.bodies[0].rights, ExecutionRights::Owner);
    assert_eq!(result.bodies[0].findings[1].severity, Severity::Advisory);
    let caller = sql("PYTHON", content).replace(" AS $$", " EXECUTE AS CALLER AS $$");
    let result = analyzer.analyze(&caller).unwrap();
    assert_eq!(result.bodies[0].rights, ExecutionRights::Caller);
    assert!(!ids(&result).contains(&"owner-temp-object"));
    let udf = sql("PYTHON", content).replace("PROCEDURE", "FUNCTION");
    assert!(ids(&analyzer.analyze(&udf).unwrap()).is_empty());
    let safe = "# subprocess.run()\ns = 'PUT file:///x @s'\nsession.sql(f'GET {stage} file:///x')\nsession.sql(query)\nsession.file.get('@s/exact.csv', '/tmp')\nsession.sql('CREATE TABLE t (x INT)')\n";
    assert!(ids(&analyzer.analyze(&sql("PYTHON", safe)).unwrap()).is_empty());
}

#[test]
fn does_not_extract_sql_bodies_or_body_like_text_in_comments() {
    let input = "-- CREATE PROCEDURE fake() RETURNS STRING LANGUAGE JAVASCRIPT AS 'eval(1)';\nCREATE PROCEDURE p() RETURNS INT LANGUAGE SQL AS $$ BEGIN RETURN 1; END $$;";
    let result = Analyzer::new().unwrap().analyze(input).unwrap();
    assert!(result.sql_errors.is_empty());
    assert!(result.bodies.is_empty());
}

#[test]
fn all_escape_boundaries_and_invalid_encodings_are_explicit() {
    let mut analyzer = Analyzer::new().unwrap();
    for escaped in [
        r"\x", r"\xGG", r"\xFF", r"\u12", r"\uZZZZ", r"\uDFFF", r"\777", r"\12",
    ] {
        let input =
            format!("CREATE FUNCTION f() RETURNS STRING LANGUAGE JAVASCRIPT AS '{escaped}';");
        let result = analyzer.analyze(&input).unwrap();
        assert!(
            matches!(result.bodies[0].status, BodyStatus::InvalidEncoding(_)),
            "{escaped}"
        );
    }
    let content = r#"return "\b\f\n\r\t\0\\\"\'";"#;
    let input = format!("CREATE FUNCTION f() RETURNS STRING LANGUAGE JAVASCRIPT AS '{content}';");
    let result = analyzer.analyze(&input).unwrap();
    let source = result.bodies[0].source.as_ref().unwrap();
    assert_eq!(source.text(), "return \"\u{8}\u{c}\n\r\t\0\\\"'\";");
    let offsets: Vec<_> = (0..=source.text().len())
        .map(|i| source.source_offset(i).unwrap())
        .collect();
    assert!(offsets.windows(2).all(|w| w[0] <= w[1]));
    assert_eq!(
        source_point("é\r\n雪", 7).unwrap(),
        snowflake_bodies::tree_sitter::Point::new(1, 3)
    );
    assert_eq!(source_point("x", 2), None);
    let invalid_range = std::ops::Range { start: 5, end: 2 };
    assert_eq!(source.source_range(invalid_range), None);
}

#[test]
fn multiple_routines_and_feature_independent_task_context() {
    let mut analyzer = Analyzer::new().unwrap();
    let input = format!(
        "{} {} CREATE TASK t AS CALL p();",
        sql("SCALA", "object Handler {}"),
        sql("JAVASCRIPT", "return 1;").replace("p()", "other()")
    );
    let result = analyzer.analyze(&input).unwrap();
    assert_eq!(result.bodies.len(), 2);
    assert_eq!(result.findings.len(), 1);
    let overloaded = format!(
        "{input} CREATE PROCEDURE p(x INT) RETURNS INT LANGUAGE SQL AS $$ BEGIN RETURN x; END $$;"
    );
    assert!(analyzer.analyze(&overloaded).unwrap().findings.is_empty());
    let warehouse = input.replace("TASK t AS", "TASK t WAREHOUSE=w AS");
    assert!(analyzer.analyze(&warehouse).unwrap().findings.is_empty());
    let input = sql("PYTHON", "session.sql('CREATE TEMP TABLE t (x INT)')")
        .replace(" AS $$", " EXECUTE AS OWNER AS $$");
    assert_eq!(
        ids(&analyzer.analyze(&input).unwrap()),
        ["owner-temp-object"]
    );
}

#[cfg(feature = "java")]
#[test]
fn java_queries_and_literal_destination_checks() {
    let content = r#"class Handler { String run() {
        new Thread(); Session.builder(); session.jdbcConnection();
        session.sql("GET @s file:///outside");
        session.sql("GET @s file:///tmp/../outside");
        session.sql("GET @s file:///tmp/safe");
        session.sql("PUT file:///outside @s");
        session.file().get("@s", "/outside");
        session.sql("CREATE TEMP TABLE t (x INT)");
        return "ok";
    }}"#;
    let result = Analyzer::new()
        .unwrap()
        .analyze(&sql("JAVA", content))
        .unwrap();
    assert_eq!(result.bodies[0].status, BodyStatus::Parsed);
    assert_eq!(
        ids(&result),
        [
            "concurrency",
            "session-builder",
            "jdbc-connection",
            "local-write-path",
            "local-write-path",
            "local-write-path",
            "owner-temp-object"
        ]
    );
}

#[cfg(feature = "scala")]
#[test]
fn scala_queries_and_tasks() {
    let content = r#"object Handler { def run(): String = {
        new Thread(); Session.builder(); session.jdbcConnection
        val x = List(1).par
        session.sql("GET @s file:///outside")
        session.file.get("@s", "/outside")
        "ok"
    }}"#;
    let input = format!(
        "{} CREATE TASK t AS CALL p(); CREATE TASK t2 WAREHOUSE=w AS CALL p();",
        sql("SCALA", content)
    );
    let result = Analyzer::new().unwrap().analyze(&input).unwrap();
    assert!(result.sql_errors.is_empty());
    assert_eq!(result.bodies[0].status, BodyStatus::Parsed);
    assert_eq!(
        ids(&result),
        [
            "concurrency",
            "session-builder",
            "jdbc-connection",
            "concurrency",
            "local-write-path",
            "local-write-path"
        ]
    );
    assert_eq!(result.findings.len(), 1);
    assert_eq!(result.findings[0].rule_id, "scala-task-warehouse");
    assert_eq!(&input[result.findings[0].range.clone()], "CALL p()");
}
