//! Checks a diagram for the problems that make a generated diagram look wrong.
//! A port of `drawgen/check.py`.
//!
//! Errors (the file is broken or misleading):
//!   duplicate-id, missing-parent, dangling-edge, out-of-page, overlap
//! Warnings (it opens, and it reads badly):
//!   edge-through-shape, label-overflow
//!
//! The two warnings are estimates. draw.io routes an orthogonal edge itself
//! when it draws the diagram, so the checker approximates the route from the
//! ports and the waypoints. It has no font metrics, so it estimates the width
//! of text from the number of characters. Both lean towards reporting.

use crate::diagram::{Cell, Diagram, Shape};
use crate::util::{
    attr_round_trip, f0, html_unescape, parse_style, repr_names, repr_str, style_number,
    style_number_or,
};
use serde_json::{Value, json};
use std::collections::{HashMap, HashSet};

pub type Point = (f64, f64);

pub struct Issue {
    pub page: String,
    /// "error" or "warning".
    pub severity: &'static str,
    pub code: &'static str,
    pub cell: String,
    pub message: String,
}

pub struct Report {
    pub path: String,
    pub pages: usize,
    pub cells: usize,
    pub issues: Vec<Issue>,
}

impl Report {
    pub fn to_json(&self) -> Value {
        let count = |severity: &str| {
            self.issues
                .iter()
                .filter(|i| i.severity == severity)
                .count()
        };
        json!({
            "path": self.path,
            "pages": self.pages,
            "cells": self.cells,
            "errors": count("error"),
            "warnings": count("warning"),
            "issues": self.issues.iter().map(|i| json!({
                "page": i.page,
                "severity": i.severity,
                "code": i.code,
                "cell": i.cell,
                "message": i.message,
            })).collect::<Vec<_>>(),
        })
    }
}

/// A vertex with absolute page coordinates.
#[derive(Clone)]
pub struct Vertex {
    pub id: String,
    pub parent: String,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub role: String,
    pub style: HashMap<String, String>,
    pub value: String,
}

impl Vertex {
    fn rect(&self, inset: f64) -> (f64, f64, f64, f64) {
        (
            self.x + inset,
            self.y + inset,
            self.x + self.w - inset,
            self.y + self.h - inset,
        )
    }
}

/// The role of a cell: from the `drawgenRole=` style key when it is present,
/// and from the style otherwise.
fn role(style: &HashMap<String, String>, raw: &str) -> String {
    if let Some(role) = style.get("drawgenRole") {
        return role.clone();
    }
    if raw.starts_with("text;") || style.get("text").is_some_and(|v| v == "1") {
        return "text".to_string();
    }
    let is = |key: &str| style.get(key).is_some_and(|v| v == "1");
    if style.contains_key("swimlane") || is("container") || is("group") {
        return "zone".to_string();
    }
    "node".to_string()
}

/// The vertices of a page, in cell order, with absolute coordinates. Children
/// of a vertex are stored relative to it.
pub fn vertices(cells: &[Cell]) -> Vec<Vertex> {
    let mut raw: Vec<Vertex> = Vec::new();
    for cell in cells {
        if let Shape::Vertex { x, y, w, h } = cell.shape {
            let style = parse_style(&cell.style);
            raw.push(Vertex {
                id: cell.id.clone(),
                parent: cell.parent.clone(),
                x,
                y,
                w,
                h,
                role: role(&style, &cell.style),
                style,
                value: cell.value.clone(),
            });
        }
    }
    let index: HashMap<&str, usize> = raw
        .iter()
        .enumerate()
        .map(|(i, v)| (v.id.as_str(), i))
        .collect();
    let mut out = raw.clone();
    for vertex in &mut out {
        let mut parent = vertex.parent.as_str();
        // The depth limit stops a file whose parents form a loop.
        for _ in 0..50 {
            let Some(&i) = index.get(parent) else { break };
            vertex.x += raw[i].x;
            vertex.y += raw[i].y;
            parent = raw[i].parent.as_str();
        }
    }
    out
}

/// Checks every page of a document.
pub fn check(pages: &[Diagram], path: &str) -> Report {
    let mut issues = Vec::new();
    let mut cells = 0;
    for page in pages {
        // Cells 0 and 1 are the two root cells that every draw.io page has.
        cells += page.cells.len() + 2;
        issues.extend(check_page(&attr_round_trip(&page.name), page));
    }
    Report {
        path: path.to_string(),
        pages: pages.len(),
        cells,
        issues,
    }
}

fn check_page(name: &str, page: &Diagram) -> Vec<Issue> {
    let mut out: Vec<Issue> = Vec::new();
    let mut issue = |severity: &'static str, code: &'static str, cell: &str, message: String| {
        out.push(Issue {
            page: name.to_string(),
            severity,
            code,
            cell: cell.to_string(),
            message,
        });
    };
    let (pw, ph) = (page.width as f64, page.height as f64);

    let mut ids: HashSet<&str> = HashSet::from(["0", "1"]);
    for cell in &page.cells {
        if !ids.insert(cell.id.as_str()) {
            issue(
                "error",
                "duplicate-id",
                &cell.id,
                "two cells share this id; draw.io keeps one".to_string(),
            );
        }
    }
    for cell in &page.cells {
        if !ids.contains(cell.parent.as_str()) {
            issue(
                "error",
                "missing-parent",
                &cell.id,
                format!("parent {} does not exist", repr_str(&cell.parent)),
            );
        }
    }

    let verts = vertices(&page.cells);
    let by_id: HashMap<&str, &Vertex> = verts.iter().map(|v| (v.id.as_str(), v)).collect();
    let ancestors = |id: &str| -> HashSet<&str> {
        let mut seen = HashSet::new();
        let mut current = by_id.get(id);
        while let Some(v) = current {
            if !by_id.contains_key(v.parent.as_str()) || !seen.insert(v.parent.as_str()) {
                break;
            }
            current = by_id.get(v.parent.as_str());
        }
        seen
    };

    // Bounds.
    if pw != 0.0 && ph != 0.0 {
        for v in &verts {
            if v.x < -0.5 || v.y < -0.5 || v.x + v.w > pw + 0.5 || v.y + v.h > ph + 0.5 {
                issue(
                    "error",
                    "out-of-page",
                    &v.id,
                    format!(
                        "({},{} {}x{}) is outside the {}x{} page",
                        f0(v.x),
                        f0(v.y),
                        f0(v.w),
                        f0(v.h),
                        f0(pw),
                        f0(ph)
                    ),
                );
            }
        }
    }

    // Overlaps between solid shapes. A container holds things by design, text
    // and legend parts sit on other cells by design, and a cell never overlaps
    // its own ancestors.
    let solid: Vec<&Vertex> = verts
        .iter()
        .filter(|v| matches!(v.role.as_str(), "node" | "entity" | "shape" | "legend-box"))
        .collect();
    for (i, a) in solid.iter().enumerate() {
        for b in &solid[i + 1..] {
            if ancestors(&b.id).contains(a.id.as_str()) || ancestors(&a.id).contains(b.id.as_str())
            {
                continue;
            }
            let ox = (a.x + a.w).min(b.x + b.w) - a.x.max(b.x);
            let oy = (a.y + a.h).min(b.y + b.h) - a.y.max(b.y);
            if ox > 4.0 && oy > 4.0 {
                issue(
                    "error",
                    "overlap",
                    &format!("{},{}", a.id, b.id),
                    format!("shapes overlap by {}x{}px", f0(ox), f0(oy)),
                );
            }
        }
    }

    // Edges.
    for cell in &page.cells {
        let Shape::Edge {
            source,
            target,
            points,
            ..
        } = &cell.shape
        else {
            continue;
        };
        let (Some(src), Some(tgt)) = (source.as_deref(), target.as_deref()) else {
            if source.is_none() && target.is_none() {
                continue; // A free-standing line, such as a legend swatch.
            }
            let present = source
                .as_deref()
                .or(target.as_deref())
                .filter(|id| !ids.contains(id));
            let missing = match present {
                Some(id) => format!("[None, {}]", repr_str(id)),
                None => "[None]".to_string(),
            };
            issue(
                "error",
                "dangling-edge",
                &cell.id,
                format!("endpoint(s) {missing} do not exist; the edge floats or vanishes"),
            );
            continue;
        };
        let missing: Vec<&str> = [src, tgt]
            .into_iter()
            .filter(|id| !ids.contains(id))
            .collect();
        if !missing.is_empty() {
            issue(
                "error",
                "dangling-edge",
                &cell.id,
                format!(
                    "endpoint(s) {} do not exist; the edge floats or vanishes",
                    repr_names(&missing)
                ),
            );
            continue;
        }
        let (Some(s), Some(t)) = (by_id.get(src), by_id.get(tgt)) else {
            continue;
        };
        let path = route(s, t, &parse_style(&cell.style), points);
        let (src_up, tgt_up) = (ancestors(src), ancestors(tgt));
        for v in &solid {
            let id = v.id.as_str();
            let up = ancestors(id);
            if id == src || id == tgt || src_up.contains(id) || tgt_up.contains(id) {
                continue;
            }
            if up.contains(src) || up.contains(tgt) {
                continue;
            }
            let rect = v.rect(3.0);
            if path
                .windows(2)
                .any(|leg| segment_hits(leg[0], leg[1], rect))
            {
                issue(
                    "warning",
                    "edge-through-shape",
                    &cell.id,
                    format!("{src} -> {tgt} likely crosses {id}; add waypoints or set exit/entry"),
                );
            }
        }
    }

    // Label fit.
    for v in &verts {
        if matches!(v.role.as_str(), "legend" | "legend-box" | "title")
            || v.value.is_empty()
            || v.w <= 0.0
            || v.h <= 0.0
        {
            continue;
        }
        if let Some(message) = label_overflow(v) {
            issue("warning", "label-overflow", &v.id, message);
        }
    }
    out
}

fn port(v: &Vertex, fx: f64, fy: f64) -> Point {
    (v.x + v.w * fx, v.y + v.h * fy)
}

/// Approximates the drawn route of an edge: the two ports, the waypoints, and
/// orthogonal elbows between them.
///
/// The first leg leaves along the side it exits from, and the last leg arrives
/// perpendicular to the side it enters. That is what draw.io's orthogonal
/// router does, and it is what makes an arrowhead point into the shape.
pub fn route(
    s: &Vertex,
    t: &Vertex,
    style: &HashMap<String, String>,
    waypoints: &[Point],
) -> Vec<Point> {
    let pinned = |key: &str| -> Option<Point> {
        let (x, y) = (format!("{key}X"), format!("{key}Y"));
        (style.contains_key(&x) && style.contains_key(&y))
            .then(|| (style_number(style, &x), style_number(style, &y)))
    };
    // True for a port on the left or right side, which an edge leaves
    // horizontally.
    let on_side = |(fx, fy): Point| (fx == 0.0 || fx == 1.0) && !(fy == 0.0 || fy == 1.0);

    let end = |v: &Vertex, key: &str, other: &Vertex, other_key: &str| -> (Point, bool) {
        if let Some(fixed) = pinned(key) {
            return (port(v, fixed.0, fixed.1), on_side(fixed));
        }
        let (tx, ty) = match pinned(other_key) {
            Some(other_fixed) => {
                // Leave toward the other end's pinned port, in the direction
                // that port faces. Comparing centres instead picks a side that
                // runs the edge through its neighbours.
                let (ox, oy) = port(other, other_fixed.0, other_fixed.1);
                if on_side(other_fixed) {
                    if ox >= v.x + v.w {
                        return (port(v, 1.0, 0.5), true);
                    }
                    if ox <= v.x {
                        return (port(v, 0.0, 0.5), true);
                    }
                } else {
                    if oy >= v.y + v.h {
                        return (port(v, 0.5, 1.0), false);
                    }
                    if oy <= v.y {
                        return (port(v, 0.5, 0.0), false);
                    }
                }
                (ox, oy)
            }
            None => (other.x + other.w / 2.0, other.y + other.h / 2.0),
        };
        let (dx, dy) = (tx - (v.x + v.w / 2.0), ty - (v.y + v.h / 2.0));
        if dx.abs() >= dy.abs() {
            (port(v, if dx > 0.0 { 1.0 } else { 0.0 }, 0.5), true)
        } else {
            (port(v, 0.5, if dy > 0.0 { 1.0 } else { 0.0 }), false)
        }
    };

    let (a, a_horizontal) = end(s, "exit", t, "entry");
    let (b, b_horizontal) = end(t, "entry", s, "exit");
    let mut points = vec![a];
    points.extend_from_slice(waypoints);
    points.push(b);
    if style.get("edgeStyle").is_none_or(|v| v == "none") {
        return points;
    }

    let mut out = vec![a];
    for (i, &q) in points.iter().enumerate().skip(1) {
        let p = out[out.len() - 1];
        if (p.0 - q.0).abs() > 1.0 && (p.1 - q.1).abs() > 1.0 {
            let (first, last) = (i == 1, i == points.len() - 1);
            let leave = if first {
                a_horizontal
            } else {
                (q.0 - p.0).abs() >= (q.1 - p.1).abs()
            };
            let arrive = if last { b_horizontal } else { leave };
            if leave && arrive {
                let mx = (p.0 + q.0) / 2.0;
                out.push((mx, p.1));
                out.push((mx, q.1));
            } else if !leave && !arrive {
                let my = (p.1 + q.1) / 2.0;
                out.push((p.0, my));
                out.push((q.0, my));
            } else if leave {
                out.push((q.0, p.1));
            } else {
                out.push((p.0, q.1));
            }
        }
        out.push(q);
    }
    out
}

/// Liang-Barsky clipping: does the segment from `p` to `q` pass through the
/// inside of the rectangle?
fn segment_hits(p: Point, q: Point, (x0, y0, x1, y1): (f64, f64, f64, f64)) -> bool {
    if x1 <= x0 || y1 <= y0 {
        return false;
    }
    let (dx, dy) = (q.0 - p.0, q.1 - p.1);
    let (mut t0, mut t1) = (0.0_f64, 1.0_f64);
    for (pk, qk) in [
        (-dx, p.0 - x0),
        (dx, x1 - p.0),
        (-dy, p.1 - y0),
        (dy, y1 - p.1),
    ] {
        if pk == 0.0 {
            if qk < 0.0 {
                return false;
            }
            continue;
        }
        let r = qk / pk;
        if pk < 0.0 {
            t0 = t0.max(r);
        } else {
            t1 = t1.min(r);
        }
        if t0 > t1 {
            return false;
        }
    }
    t1 - t0 > 1e-6
}

// Measured against draw.io 31 renders of Helvetica labels: mixed-case text runs
// about 0.44 to 0.49 em for each character, and bold a little wider. With the
// 5% tolerance below, a warning means "probably clipped", not "might be tight".
const EM_REGULAR: f64 = 0.46;
const EM_BOLD: f64 = 0.5;
pub const LINE_HEIGHT: f64 = 1.2;

pub fn text_width(text: &str, size: f64, bold: bool) -> f64 {
    text.chars().count() as f64 * size * if bold { EM_BOLD } else { EM_REGULAR }
}

fn starts_with_ignore_case(text: &str, prefix: &str) -> bool {
    text.len() >= prefix.len()
        && text.as_bytes()[..prefix.len()].eq_ignore_ascii_case(prefix.as_bytes())
}

/// The length of a line break at the start of `text`: `<br>`, `<br/>`,
/// `<br />`, `</div>`, or `</p>`, in any case.
fn line_break_len(text: &str) -> Option<usize> {
    for closing in ["</div>", "</p>"] {
        if starts_with_ignore_case(text, closing) {
            return Some(closing.len());
        }
    }
    if !starts_with_ignore_case(text, "<br") {
        return None;
    }
    let rest = &text[3..];
    let spaces = rest.len() - rest.trim_start().len();
    let rest = &rest[spaces..];
    let slash = usize::from(rest.starts_with('/'));
    rest[slash..]
        .starts_with('>')
        .then_some(3 + spaces + slash + 1)
}

/// Splits label HTML into its lines.
pub fn split_lines(html: &str) -> Vec<&str> {
    let mut lines = Vec::new();
    let mut start = 0;
    let mut i = 0;
    while i < html.len() {
        if html.as_bytes()[i] == b'<'
            && let Some(len) = line_break_len(&html[i..])
        {
            lines.push(&html[start..i]);
            i += len;
            start = i;
            continue;
        }
        i += 1;
    }
    lines.push(&html[start..]);
    lines
}

/// Removes every `<...>` tag.
fn strip_tags(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut rest = html;
    while let Some(open) = rest.find('<') {
        out.push_str(&rest[..open]);
        match rest[open + 1..].find('>') {
            // A tag has at least one character between the brackets.
            Some(close) if close > 0 => rest = &rest[open + close + 2..],
            _ => {
                out.push('<');
                rest = &rest[open + 1..];
            }
        }
    }
    out.push_str(rest);
    out
}

/// Finds `font-size: <number>px` in a piece of HTML and returns the number.
pub fn font_size_px(html: &str, ignore_case: bool) -> Option<f64> {
    let needle = "font-size:";
    let mut from = 0;
    while from + needle.len() <= html.len() {
        let here = &html[from..];
        let found = if ignore_case {
            starts_with_ignore_case(here, needle)
        } else {
            here.starts_with(needle)
        };
        if found {
            let rest = here[needle.len()..].trim_start();
            let digits = rest.bytes().take_while(u8::is_ascii_digit).count();
            let mut len = digits;
            if digits > 0 && rest[len..].starts_with('.') {
                let decimals = rest[len + 1..]
                    .bytes()
                    .take_while(u8::is_ascii_digit)
                    .count();
                if decimals > 0 {
                    len += 1 + decimals;
                }
            }
            let unit = &rest[len..];
            let has_unit = if ignore_case {
                starts_with_ignore_case(unit, "px")
            } else {
                unit.starts_with("px")
            };
            if digits > 0 && has_unit {
                return rest[..len].parse().ok();
            }
        }
        from += here.chars().next().map_or(1, char::len_utf8);
    }
    None
}

fn label_overflow(v: &Vertex) -> Option<String> {
    let size = style_number_or(&v.style, "fontSize", 11.0);
    let bold = (style_number(&v.style, "fontStyle") as i64) & 1 == 1;
    let is_html = v.style.get("html").is_some_and(|h| h == "1");
    let mut lines: Vec<&str> = if is_html {
        split_lines(&v.value)
    } else {
        v.value.split('\n').collect()
    };
    let wrap = v.style.get("whiteSpace").is_some_and(|w| w == "wrap");
    let pad_x =
        style_number(&v.style, "spacingLeft") + style_number(&v.style, "spacingRight") + 8.0;
    let shape = v.style.get("shape").map(String::as_str).unwrap_or("");
    let mut avail_w = v.w - pad_x;
    if v.style.contains_key("rhombus") {
        avail_w *= 0.6;
    }
    let is_container = v.role == "zone" || v.style.contains_key("swimlane");
    if is_container {
        // Only the header has to fit.
        lines.truncate(1);
    }
    let mut avail_h = if is_container {
        style_number_or(&v.style, "startSize", 30.0)
    } else {
        v.h - 4.0
    };
    if shape == "cylinder3" {
        avail_h -= 20.0;
    }
    let mut total_h = 0.0;
    for raw in lines {
        let line_size = font_size_px(raw, true).unwrap_or(size);
        let line_bold = bold || raw.to_lowercase().contains("<b>");
        let plain = if is_html {
            html_unescape(&strip_tags(raw))
        } else {
            raw.to_string()
        };
        let width = text_width(&plain, line_size, line_bold);
        let line_h = line_size * LINE_HEIGHT;
        if width > avail_w {
            if !wrap || avail_w <= 0.0 {
                return Some(format!(
                    "text is about {}px wide in a {}px box and does not wrap; widen it",
                    f0(width),
                    f0(avail_w)
                ));
            }
            total_h += (width / avail_w).ceil() * line_h;
        } else {
            total_h += line_h;
        }
    }
    if total_h > avail_h * 1.05 + 2.0 {
        return Some(format!(
            "text needs about {}px of height, the box has {}px; enlarge it or shorten the label",
            f0(total_h),
            f0(avail_h)
        ));
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_label_lines() {
        assert_eq!(
            split_lines("<b>a</b><br>b<BR/>c<br />d"),
            ["<b>a</b>", "b", "c", "d"]
        );
        assert_eq!(split_lines("plain"), ["plain"]);
        assert_eq!(split_lines("a<br clear=all>b"), ["a<br clear=all>b"]);
    }

    #[test]
    fn strips_tags_and_finds_font_sizes() {
        assert_eq!(strip_tags("<b>Orders</b> &lt;v2&gt;"), "Orders &lt;v2&gt;");
        assert_eq!(
            font_size_px(
                "<font style=\"font-size:10px\" color=\"#4B5563\">x</font>",
                true
            ),
            Some(10.0)
        );
        assert_eq!(font_size_px("font-size: 11.5PX", true), Some(11.5));
        assert_eq!(font_size_px("font-size: 11.5PX", false), None);
        assert_eq!(font_size_px("no size here", true), None);
    }

    #[test]
    fn a_segment_hits_only_the_inside_of_a_rectangle() {
        let rect = (0.0, 0.0, 10.0, 10.0);
        assert!(segment_hits((-5.0, 5.0), (15.0, 5.0), rect));
        assert!(!segment_hits((-5.0, -1.0), (15.0, -1.0), rect));
        assert!(!segment_hits((-5.0, 5.0), (-1.0, 5.0), rect));
        assert!(!segment_hits((-5.0, 20.0), (15.0, 20.0), rect));
    }
}
