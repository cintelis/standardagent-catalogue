//! Small helpers shared by every module: number formatting, escaping, and the
//! draw.io style string.
//!
//! The Rust code is a port of the Python `drawgen` package, and the tests
//! compare its output with files that the Python code wrote. Several helpers
//! here exist to format a value exactly as Python does.

use serde_json::Value;
use std::collections::HashMap;

/// Formats a geometry value: an integer without ".0", anything else with at
/// most two decimals. Python: `drawgen.diagram._num`.
pub fn num(v: f64) -> String {
    if v.is_finite() && v.fract() == 0.0 {
        format!("{}", v as i64)
    } else {
        format!("{v:.2}").trim_end_matches('0').to_string()
    }
}

/// The value a reader gets back after [`num`] wrote it into the XML.
pub fn round_trip(v: f64) -> f64 {
    num(v).parse().unwrap_or(0.0)
}

/// Formats like Python's `{:g}`: six significant digits, no trailing zeros.
pub fn g(v: f64) -> String {
    if v == 0.0 {
        return if v.is_sign_negative() { "-0" } else { "0" }.to_string();
    }
    if !v.is_finite() {
        return if v.is_nan() {
            "nan"
        } else if v > 0.0 {
            "inf"
        } else {
            "-inf"
        }
        .to_string();
    }
    // The scientific form gives the exponent after rounding to six digits.
    let scientific = format!("{v:.5e}");
    let (mantissa, exponent) = scientific.split_once('e').unwrap_or((&scientific, "0"));
    let exponent: i32 = exponent.parse().unwrap_or(0);

    let strip = |s: &str| -> String {
        if s.contains('.') {
            s.trim_end_matches('0').trim_end_matches('.').to_string()
        } else {
            s.to_string()
        }
    };

    if !(-4..6).contains(&exponent) {
        let sign = if exponent < 0 { '-' } else { '+' };
        format!("{}e{}{:02}", strip(mantissa), sign, exponent.abs())
    } else {
        let decimals = (5 - exponent).max(0) as usize;
        strip(&format!("{v:.decimals$}"))
    }
}

/// Formats like Python's `{:.0f}`.
pub fn f0(v: f64) -> String {
    format!("{v:.0}")
}

/// Python: `html.escape`. With `quote`, also escapes `"` and `'`.
pub fn html_escape(text: &str, quote: bool) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' if quote => out.push_str("&quot;"),
            '\'' if quote => out.push_str("&#x27;"),
            _ => out.push(c),
        }
    }
    out
}

/// Escapes a value for an XML attribute in the mxGraph file.
pub fn attr(text: &str) -> String {
    html_escape(text, true)
}

/// Escapes text for SVG element content. Python: `xml.sax.saxutils.escape`.
pub fn svg_text(text: &str) -> String {
    html_escape(text, false)
}

/// Escapes a value for an SVG attribute.
pub fn svg_attr(text: &str) -> String {
    html_escape(text, false).replace('"', "&quot;")
}

/// Plain text to label HTML: escaped, with each newline as `<br>`.
pub fn label_html(text: &str) -> String {
    text.split('\n')
        .map(|part| html_escape(part, false))
        .collect::<Vec<_>>()
        .join("<br>")
}

/// Turns the entities that [`html_escape`] writes back into characters.
///
/// Every label in a diagram comes from [`label_html`], so these are the only
/// entities a label can hold.
pub fn html_unescape(text: &str) -> String {
    const ENTITIES: [(&str, char); 6] = [
        ("&amp;", '&'),
        ("&lt;", '<'),
        ("&gt;", '>'),
        ("&quot;", '"'),
        ("&#x27;", '\''),
        ("&apos;", '\''),
    ];
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    'outer: while let Some(at) = rest.find('&') {
        out.push_str(&rest[..at]);
        rest = &rest[at..];
        for (entity, c) in ENTITIES {
            if rest.starts_with(entity) {
                out.push(c);
                rest = &rest[entity.len()..];
                continue 'outer;
            }
        }
        out.push('&');
        rest = &rest[1..];
    }
    out.push_str(rest);
    out
}

/// What an XML parser returns for an attribute value written with a tab or a
/// line break in it: each becomes one space.
pub fn attr_round_trip(text: &str) -> String {
    text.replace("\r\n", " ").replace(['\r', '\n', '\t'], " ")
}

/// True when every character may appear in an XML 1.0 document.
pub fn is_valid_xml_text(text: &str) -> bool {
    text.chars().all(|c| {
        matches!(c, '\t' | '\n' | '\r' | '\u{20}'..='\u{D7FF}' | '\u{E000}'..='\u{FFFD}' | '\u{10000}'..='\u{10FFFF}')
    })
}

/// Parses a draw.io style string, such as `rounded=1;fillColor=#FFF;`, into a
/// map. A key without a value, such as `swimlane`, maps to `"1"`.
pub fn parse_style(style: &str) -> HashMap<String, String> {
    let mut out = HashMap::new();
    for part in style.split(';') {
        if part.is_empty() {
            continue;
        }
        match part.split_once('=') {
            Some((key, value)) => out.insert(key.to_string(), value.to_string()),
            None => out.insert(part.to_string(), "1".to_string()),
        };
    }
    out
}

/// Reads a number from a style value, or 0 when it is missing or not a number.
pub fn style_number(style: &HashMap<String, String>, key: &str) -> f64 {
    style
        .get(key)
        .and_then(|v| v.trim().parse().ok())
        .unwrap_or(0.0)
}

/// Like [`style_number`], with a default for a missing or zero value.
pub fn style_number_or(style: &HashMap<String, String>, key: &str, default: f64) -> f64 {
    let v = style_number(style, key);
    if v == 0.0 { default } else { v }
}

/// How Python's `repr` writes a string.
pub fn repr_str(text: &str) -> String {
    let quote = if text.contains('\'') && !text.contains('"') {
        '"'
    } else {
        '\''
    };
    let mut out = String::new();
    out.push(quote);
    for c in text.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if c == quote => {
                out.push('\\');
                out.push(c);
            }
            c => out.push(c),
        }
    }
    out.push(quote);
    out
}

/// How Python's `repr` writes a JSON value. Error messages quote the value a
/// spec gave, so that the model can see what it wrote.
pub fn repr(value: &Value) -> String {
    match value {
        Value::Null => "None".to_string(),
        Value::Bool(true) => "True".to_string(),
        Value::Bool(false) => "False".to_string(),
        Value::Number(n) => {
            if n.is_i64() || n.is_u64() {
                n.to_string()
            } else {
                format!("{:?}", n.as_f64().unwrap_or(0.0))
            }
        }
        Value::String(s) => repr_str(s),
        Value::Array(items) => format!(
            "[{}]",
            items.iter().map(repr).collect::<Vec<_>>().join(", ")
        ),
        Value::Object(map) => format!(
            "{{{}}}",
            map.iter()
                .map(|(k, v)| format!("{}: {}", repr_str(k), repr(v)))
                .collect::<Vec<_>>()
                .join(", ")
        ),
    }
}

/// How Python's `str` writes a JSON value: a string as itself, anything else
/// as [`repr`].
pub fn to_text(value: &Value) -> String {
    match value {
        Value::String(s) => s.clone(),
        other => repr(other),
    }
}

/// How Python's `repr` writes a list of names: `['a', 'b']`.
pub fn repr_names(names: &[&str]) -> String {
    format!(
        "[{}]",
        names
            .iter()
            .map(|n| repr_str(n))
            .collect::<Vec<_>>()
            .join(", ")
    )
}

/// Python truthiness of a JSON value.
pub fn truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().is_some_and(|f| f != 0.0),
        Value::String(s) => !s.is_empty(),
        Value::Array(items) => !items.is_empty(),
        Value::Object(map) => !map.is_empty(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_geometry_like_python() {
        assert_eq!(num(170.0), "170");
        assert_eq!(num(-0.0), "0");
        assert_eq!(num(10.5), "10.5");
        assert_eq!(num(33.333), "33.33");
        // Python strips zeros and keeps the point: f"{1.001:.2f}".rstrip("0").
        assert_eq!(num(1.001), "1.");
        assert_eq!(round_trip(1.001), 1.0);
    }

    #[test]
    fn formats_g_like_python() {
        for (value, expected) in [
            (0.0, "0"),
            (1.0, "1"),
            (1.5, "1.5"),
            (-12.25, "-12.25"),
            (123.456789, "123.457"),
            (0.1 + 0.2, "0.3"),
            (1234567.0, "1.23457e+06"),
            (999999.5, "1e+06"),
            (0.00001234, "1.234e-05"),
            (0.0001, "0.0001"),
            (100000.0, "100000"),
            (62.400000000000006, "62.4"),
        ] {
            assert_eq!(g(value), expected, "{value}");
        }
    }

    #[test]
    fn rounds_half_to_even_like_python() {
        assert_eq!(f0(0.5), "0");
        assert_eq!(f0(1.5), "2");
        assert_eq!(f0(2.5), "2");
        assert_eq!(f0(170.0), "170");
    }

    #[test]
    fn escapes_and_unescapes() {
        assert_eq!(label_html("a < b\nc & d"), "a &lt; b<br>c &amp; d");
        assert_eq!(attr("\"it's\""), "&quot;it&#x27;s&quot;");
        assert_eq!(html_unescape("a &lt; b &amp;amp; c"), "a < b &amp; c");
        assert_eq!(svg_attr("<a href=\"x\">"), "&lt;a href=&quot;x&quot;&gt;");
    }

    #[test]
    fn parses_a_style() {
        let style = parse_style("swimlane;html=1;fillColor=#FFF;;drawgenRole=zone;");
        assert_eq!(style["swimlane"], "1");
        assert_eq!(style["fillColor"], "#FFF");
        assert_eq!(style_number(&style, "html"), 1.0);
        assert_eq!(style_number_or(&style, "startSize", 30.0), 30.0);
    }

    #[test]
    fn writes_python_reprs() {
        assert_eq!(repr(&serde_json::json!("x")), "'x'");
        assert_eq!(repr(&serde_json::json!("it's")), "\"it's\"");
        assert_eq!(repr(&Value::Null), "None");
        assert_eq!(repr(&serde_json::json!(12)), "12");
        assert_eq!(repr(&serde_json::json!(12.0)), "12.0");
        assert_eq!(repr_names(&["a", "b"]), "['a', 'b']");
    }
}
