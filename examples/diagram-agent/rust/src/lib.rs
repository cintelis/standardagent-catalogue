//! The drawgen core for the Diagram Designer sample agent: a diagram spec in,
//! a draw.io file, a check report, and an editable SVG out.
//!
//! The modules are a port of the Python `drawgen` package:
//!
//! | Module    | Does                                              |
//! |-----------|---------------------------------------------------|
//! | `theme`   | Component kinds, zone colours, edge styles        |
//! | `spec`    | Validates a JSON spec and lays out the page       |
//! | `diagram` | Builds the mxGraph XML that draw.io reads         |
//! | `check`   | Reports overlaps, off-page shapes, clipped labels |
//! | `render`  | Draws the SVG                                     |
//! | `util`    | Number formatting and escaping                    |
//!
//! [`handle`] is the one function TypeScript calls. It takes a JSON request
//! and returns a JSON response, so the boundary carries two strings and the
//! `ffi` module at the bottom stays small.

pub mod check;
pub mod diagram;
pub mod render;
pub mod spec;
pub mod theme;
pub mod util;

use serde_json::{Value, json};

/// Everything made from one spec.
pub struct Built {
    /// The `.drawio` file.
    pub xml: String,
    /// One SVG for each page, with the `.drawio` file embedded.
    pub svgs: Vec<String>,
    pub report: check::Report,
}

/// Builds, checks, and renders a spec. `path` is the name the report shows.
pub fn create(spec: &Value, path: &str) -> Result<Built, String> {
    let document = spec::build(spec)?;
    let xml = document.xml()?;
    let report = check::check(&document.pages, path);
    let svgs = document
        .pages
        .iter()
        .map(|page| render::render_svg(page, Some(&xml)))
        .collect();
    Ok(Built { xml, svgs, report })
}

/// The spec format and the theme, for the model to read before it writes a
/// spec.
pub fn reference() -> Value {
    json!({
        "spec_format": spec::SPEC_FORMAT,
        "kinds": theme::KINDS.iter().map(|k| json!({
            "kind": k.name,
            "label": k.label,
            "shape": k.shape,
        })).collect::<Vec<_>>(),
        "zone_colours": theme::ZONE_COLOURS.iter().map(|c| c.0).collect::<Vec<_>>(),
        "edge_styles": theme::EDGE_STYLES.iter().map(|s| json!({
            "style": s.name,
            "label": s.label,
        })).collect::<Vec<_>>(),
        "default_node_size": [theme::NODE_W, theme::NODE_H],
    })
}

/// Answers a JSON request with a JSON response.
///
/// - `{"op": "reference"}` returns `{"ok": true, "reference": {...}}`.
/// - `{"op": "create", "spec": {...}, "path": "name"}` returns
///   `{"ok": true, "xml": "...", "svgs": ["..."], "check": {...}}`.
/// - A failure returns `{"ok": false, "error": "..."}`.
pub fn handle(request: &str) -> String {
    let fail = |message: String| json!({ "ok": false, "error": message });
    let response = match serde_json::from_str::<Value>(request) {
        Err(e) => fail(format!("the request is not valid JSON: {e}")),
        Ok(request) => match request.get("op").and_then(Value::as_str) {
            Some("reference") => json!({ "ok": true, "reference": reference() }),
            Some("create") => {
                let path = request
                    .get("path")
                    .and_then(Value::as_str)
                    .unwrap_or("<memory>");
                match create(request.get("spec").unwrap_or(&Value::Null), path) {
                    Ok(built) => json!({
                        "ok": true,
                        "xml": built.xml,
                        "svgs": built.svgs,
                        "check": built.report.to_json(),
                    }),
                    Err(e) => fail(e),
                }
            }
            _ => fail("op must be \"reference\" or \"create\"".to_string()),
        },
    };
    response.to_string()
}

/// The boundary between JavaScript and Rust.
///
/// WebAssembly functions take and return only numbers, so a string crosses as
/// a pointer and a length into the module's memory:
///
/// 1. JavaScript calls `drawgen_alloc(len)` and copies the request there.
/// 2. JavaScript calls `drawgen_handle(ptr, len)`, which returns where the
///    response is: the pointer in the high 32 bits, the length in the low 32.
/// 3. JavaScript copies the response out and calls `drawgen_free` on both
///    buffers.
#[cfg(target_arch = "wasm32")]
mod ffi {
    use std::alloc::{Layout, alloc, dealloc};

    /// Reserves `len` bytes, or returns null when the allocation fails.
    #[unsafe(no_mangle)]
    pub extern "C" fn drawgen_alloc(len: usize) -> *mut u8 {
        if len == 0 {
            return std::ptr::NonNull::dangling().as_ptr();
        }
        match Layout::array::<u8>(len) {
            // SAFETY: the layout has a non-zero size.
            Ok(layout) => unsafe { alloc(layout) },
            Err(_) => std::ptr::null_mut(),
        }
    }

    /// Releases a buffer.
    ///
    /// # Safety
    ///
    /// `ptr` and `len` must come from `drawgen_alloc` or `drawgen_handle`, and
    /// the buffer must not be freed twice.
    #[unsafe(no_mangle)]
    pub unsafe extern "C" fn drawgen_free(ptr: *mut u8, len: usize) {
        if len == 0 || ptr.is_null() {
            return;
        }
        if let Ok(layout) = Layout::array::<u8>(len) {
            // SAFETY: the caller promises the buffer was allocated with this layout.
            unsafe { dealloc(ptr, layout) };
        }
    }

    /// Answers the UTF-8 JSON request at `ptr`.
    ///
    /// # Safety
    ///
    /// `ptr` must point to `len` readable bytes.
    #[unsafe(no_mangle)]
    pub unsafe extern "C" fn drawgen_handle(ptr: *const u8, len: usize) -> u64 {
        let bytes: &[u8] = if len == 0 {
            &[]
        } else {
            // SAFETY: the caller promises `ptr` points to `len` readable bytes.
            unsafe { std::slice::from_raw_parts(ptr, len) }
        };
        let response = super::handle(&String::from_utf8_lossy(bytes));
        // A boxed slice has exactly `len` bytes of capacity, which is what
        // `drawgen_free` expects. `leak` hands ownership to the caller.
        let out: &'static mut [u8] = Box::leak(response.into_bytes().into_boxed_slice());
        ((out.as_mut_ptr() as u64) << 32) | (out.len() as u64)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    fn fixtures() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../test/fixtures")
    }

    /// Every spec in `test/fixtures/specs` gives the same output as the Python
    /// `drawgen` package, which wrote the files in `test/fixtures/expected`.
    #[test]
    fn matches_the_python_drawgen_output() {
        let expected = fixtures().join("expected");
        let read = |name: String| {
            fs::read_to_string(expected.join(&name)).unwrap_or_else(|_| panic!("missing {name}"))
        };
        let mut specs: Vec<PathBuf> = fs::read_dir(fixtures().join("specs"))
            .expect("specs")
            .map(|entry| entry.unwrap().path())
            .collect();
        specs.sort();
        assert!(specs.len() >= 8, "found only {} specs", specs.len());

        for path in specs {
            let name = path.file_stem().unwrap().to_string_lossy().to_string();
            let spec: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
            match create(&spec, &name) {
                Err(error) => {
                    assert_eq!(
                        error,
                        read(format!("{name}.error.txt")),
                        "{name}: error message"
                    );
                }
                Ok(built) => {
                    assert_eq!(
                        built.xml,
                        read(format!("{name}.drawio")),
                        "{name}: drawio XML"
                    );
                    let report: Value =
                        serde_json::from_str(&read(format!("{name}.check.json"))).unwrap();
                    assert_eq!(built.report.to_json(), report, "{name}: check report");
                    for (i, svg) in built.svgs.iter().enumerate() {
                        assert_eq!(
                            *svg,
                            read(format!("{name}.p{}.svg", i + 1)),
                            "{name}: SVG page {}",
                            i + 1
                        );
                    }
                }
            }
        }
    }

    #[test]
    fn answers_requests() {
        let reference: Value = serde_json::from_str(&handle(r#"{"op":"reference"}"#)).unwrap();
        assert_eq!(reference["ok"], true);
        assert_eq!(
            reference["reference"]["kinds"].as_array().unwrap().len(),
            14
        );

        let created: Value = serde_json::from_str(&handle(
            r#"{"op":"create","path":"t","spec":{"title":"T","layout":"auto","nodes":[{"id":"a","label":"A"}]}}"#,
        ))
        .unwrap();
        assert_eq!(created["ok"], true);
        assert!(created["xml"].as_str().unwrap().starts_with("<mxfile"));
        assert_eq!(created["svgs"].as_array().unwrap().len(), 1);
        assert_eq!(created["check"]["errors"], 0);

        for bad in [
            "not json",
            "{}",
            r#"{"op":"create"}"#,
            r#"{"op":"create","spec":{"nodes":[]}}"#,
        ] {
            let response: Value = serde_json::from_str(&handle(bad)).unwrap();
            assert_eq!(response["ok"], false, "{bad}");
            assert!(!response["error"].as_str().unwrap().is_empty(), "{bad}");
        }
    }

    #[test]
    fn refuses_text_that_xml_does_not_allow() {
        let spec = json!({"title": "T", "nodes": [{"id": "a", "label": "bad \u{0001} char", "x": 40, "y": 80}]});
        assert!(create(&spec, "t").is_err_and(|e| e.contains("control character")));
    }
}
