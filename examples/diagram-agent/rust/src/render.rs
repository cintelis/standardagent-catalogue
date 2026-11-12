//! A small mxGraph to SVG renderer. A port of `drawgen/svg_render.py`.
//!
//! It is not a replacement for draw.io's engine. It draws what this crate
//! emits (rectangles, rounded boxes and pills, swimlanes, cylinders, diamonds,
//! notes, HTML labels with `<b>`, `<br>` and `<font>`, orthogonal edges with
//! arrowheads and labels) closely enough to read. The output embeds the source
//! diagram in the root `content` attribute, so draw.io opens the SVG as the
//! diagram and redraws it exactly on the next save.

use crate::check::{
    LINE_HEIGHT, Point, Vertex, font_size_px, route, split_lines, text_width, vertices,
};
use crate::diagram::{Cell, Diagram, Shape};
use crate::util::{
    g, html_unescape, parse_style, style_number, style_number_or, svg_attr, svg_text,
};
use std::collections::HashMap;

type Style = HashMap<String, String>;

/// A piece of label text with one size, colour, and weight.
#[derive(Clone)]
struct Run {
    text: String,
    size: f64,
    colour: String,
    bold: bool,
}

/// `None` means "do not paint". A missing value takes the default.
fn colour(value: Option<&String>, default: &str) -> Option<String> {
    match value.map(String::as_str) {
        None => Some(default.to_string()),
        Some("none") | Some("") => None,
        Some(v) => Some(v.to_string()),
    }
}

fn is(style: &Style, key: &str, value: &str) -> bool {
    style.get(key).is_some_and(|v| v == value)
}

/// Renders one page as SVG. `embed` is the whole `.drawio` file, which goes
/// into the `content` attribute.
pub fn render_svg(page: &Diagram, embed: Option<&str>) -> String {
    let verts = vertices(&page.cells);
    let by_id: HashMap<&str, &Vertex> = verts.iter().map(|v| (v.id.as_str(), v)).collect();

    let (pw, ph) = (page.width as f64, page.height as f64);
    let max_x = verts
        .iter()
        .map(|v| v.x + v.w)
        .reduce(f64::max)
        .unwrap_or(0.0);
    let max_y = verts
        .iter()
        .map(|v| v.y + v.h)
        .reduce(f64::max)
        .unwrap_or(0.0);
    let or = |v: f64, default: f64| if v == 0.0 { default } else { v };
    let width = or(pw.max(max_x + 16.0), 800.0);
    let height = or(ph.max(max_y + 16.0), 600.0);

    let mut body = String::new();
    let mut markers: Vec<(String, String)> = Vec::new();
    for cell in &page.cells {
        match &cell.shape {
            Shape::Vertex { .. } => {
                if let Some(v) = by_id.get(cell.id.as_str()) {
                    body.push_str(&vertex(v));
                }
            }
            Shape::Edge { .. } => body.push_str(&edge(cell, &by_id, &mut markers)),
        }
    }

    let content = embed
        .map(|xml| format!(" content=\"{}\"", svg_attr(xml)))
        .unwrap_or_default();
    let defs: String = markers.iter().map(|(_, marker)| marker.as_str()).collect();
    let (w, h) = (format!("{width:.0}"), format!("{height:.0}"));
    format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\" \
         version=\"1.1\" width=\"{w}px\" height=\"{h}px\" viewBox=\"0 0 {w} {h}\"{content}>\
         <defs>{defs}</defs>\
         <rect x=\"0\" y=\"0\" width=\"{w}\" height=\"{h}\" fill=\"#FFFFFF\"/>{body}</svg>\n"
    )
}

// ----------------------------------------------------------------- vertices

fn dash(style: &Style) -> String {
    if !is(style, "dashed", "1") {
        return String::new();
    }
    let pattern = style
        .get("dashPattern")
        .map(String::as_str)
        .unwrap_or("3 3")
        .replace(' ', ",");
    format!(" stroke-dasharray=\"{}\"", svg_attr(&pattern))
}

fn vertex(v: &Vertex) -> String {
    let st = &v.style;
    let (x, y, w, h) = (v.x, v.y, v.w, v.h);
    let is_text = st.contains_key("text") && v.role != "zone";
    let fill = colour(
        st.get("fillColor"),
        if is_text { "none" } else { "#FFFFFF" },
    );
    let stroke = colour(
        st.get("strokeColor"),
        if is_text { "none" } else { "#000000" },
    );
    let stroke = svg_attr(stroke.as_deref().unwrap_or("none"));
    let sw = g(style_number_or(st, "strokeWidth", 1.0));
    let sw_value = style_number_or(st, "strokeWidth", 1.0);
    let paint = format!(
        "fill=\"{}\" stroke=\"{stroke}\" stroke-width=\"{sw}\"{}",
        svg_attr(fill.as_deref().unwrap_or("none")),
        dash(st)
    );
    let shape = st.get("shape").map(String::as_str).unwrap_or("");
    let mut parts = String::new();
    let mut label_box = (x, y, w, h);

    if is_text || w <= 0.0 || h <= 0.0 {
        // Text has no outline.
    } else if st.contains_key("swimlane") {
        let start = style_number_or(st, "startSize", 30.0);
        let body = colour(st.get("swimlaneFillColor"), "#FFFFFF").unwrap_or("none".to_string());
        let r = if is(st, "rounded", "1") { 6 } else { 0 };
        parts.push_str(&format!(
            "<rect x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\" rx=\"{r}\" fill=\"{}\" stroke=\"{stroke}\" stroke-width=\"{sw}\"{}/>",
            g(x),
            g(y),
            g(w),
            g(h),
            svg_attr(&body),
            dash(st)
        ));
        parts.push_str(&format!(
            "<path d=\"M{},{} h{}\" stroke=\"{stroke}\" stroke-width=\"{sw}\"/>",
            g(x),
            g(y + start),
            g(w)
        ));
        if let Some(fill) = fill.as_deref().filter(|f| *f != body) {
            parts.push_str(&format!(
                "<rect x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\" rx=\"{}\" fill=\"{}\"/>",
                g(x + sw_value / 2.0),
                g(y + sw_value / 2.0),
                g(w - sw_value),
                g(start - sw_value),
                (r - 1).max(0),
                svg_attr(fill)
            ));
        }
        label_box = (x, y, w, start);
    } else if st.contains_key("rhombus") || shape == "rhombus" {
        parts.push_str(&format!(
            "<polygon points=\"{},{} {},{} {},{} {},{}\" {paint}/>",
            g(x + w / 2.0),
            g(y),
            g(x + w),
            g(y + h / 2.0),
            g(x + w / 2.0),
            g(y + h),
            g(x),
            g(y + h / 2.0)
        ));
    } else if shape == "cylinder3" || shape == "mxgraph.flowchart.direct_data" {
        let sideways = shape.contains("direct_data");
        let s = style_number_or(
            st,
            "size",
            if sideways {
                (w * 0.15).min(h / 2.0)
            } else {
                10.0
            },
        );
        if sideways || is(st, "direction", "south") || is(st, "direction", "north") {
            parts.push_str(&format!(
                "<path d=\"M{},{} H{} A{},{} 0 0 1 {},{} H{} A{},{} 0 0 1 {},{} Z\" {paint}/>",
                g(x + s),
                g(y),
                g(x + w - s),
                g(s),
                g(h / 2.0),
                g(x + w - s),
                g(y + h),
                g(x + s),
                g(s),
                g(h / 2.0),
                g(x + s),
                g(y)
            ));
            parts.push_str(&format!(
                "<path d=\"M{},{} A{},{} 0 0 0 {},{}\" fill=\"none\" stroke=\"{stroke}\" stroke-width=\"{sw}\"/>",
                g(x + w - s),
                g(y),
                g(s),
                g(h / 2.0),
                g(x + w - s),
                g(y + h)
            ));
        } else {
            parts.push_str(&format!(
                "<path d=\"M{},{} A{},{} 0 0 1 {},{} V{} A{},{} 0 0 1 {},{} Z\" {paint}/>",
                g(x),
                g(y + s),
                g(w / 2.0),
                g(s),
                g(x + w),
                g(y + s),
                g(y + h - s),
                g(w / 2.0),
                g(s),
                g(x),
                g(y + h - s)
            ));
            parts.push_str(&format!(
                "<path d=\"M{},{} A{},{} 0 0 0 {},{}\" fill=\"none\" stroke=\"{stroke}\" stroke-width=\"{sw}\"/>",
                g(x),
                g(y + s),
                g(w / 2.0),
                g(s),
                g(x + w),
                g(y + s)
            ));
            label_box = (x, y + 2.0 * s, w, h - 3.0 * s);
        }
    } else if shape == "note" {
        let s = style_number_or(st, "size", 14.0);
        parts.push_str(&format!(
            "<path d=\"M{},{} H{} L{},{} V{} H{} Z\" {paint}/>",
            g(x),
            g(y),
            g(x + w - s),
            g(x + w),
            g(y + s),
            g(y + h),
            g(x)
        ));
        parts.push_str(&format!(
            "<path d=\"M{},{} V{} H{}\" fill=\"none\" stroke=\"{stroke}\" stroke-width=\"{sw}\"/>",
            g(x + w - s),
            g(y),
            g(y + s),
            g(x + w)
        ));
    } else if st.contains_key("ellipse") || shape == "ellipse" {
        parts.push_str(&format!(
            "<ellipse cx=\"{}\" cy=\"{}\" rx=\"{}\" ry=\"{}\" {paint}/>",
            g(x + w / 2.0),
            g(y + h / 2.0),
            g(w / 2.0),
            g(h / 2.0)
        ));
    } else {
        let mut r = 0.0;
        if is(st, "rounded", "1") {
            let arc = style_number_or(st, "arcSize", 15.0);
            r = (w.min(h) * arc / 100.0).min(w.min(h) / 2.0);
        }
        parts.push_str(&format!(
            "<rect x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\" rx=\"{}\" {paint}/>",
            g(x),
            g(y),
            g(w),
            g(h),
            g(r)
        ));
    }

    if !v.value.is_empty() {
        parts.push_str(&label(
            &v.value,
            st,
            label_box,
            v.role == "zone" || st.contains_key("swimlane"),
        ));
    }
    parts
}

// ------------------------------------------------------------------- labels

/// Reads `color=...` from the attributes of a `<font>` tag.
fn font_colour(attrs: &str) -> Option<String> {
    let rest = &attrs[attrs.find("color=")? + "color=".len()..];
    let rest = rest.strip_prefix(['"', '\'']).unwrap_or(rest);
    let len = rest
        .chars()
        .take_while(|c| *c == '#' || c.is_alphanumeric() || *c == '_')
        .map(char::len_utf8)
        .sum();
    (len > 0).then(|| rest[..len].to_string())
}

/// Splits one line of label HTML into runs of text.
fn runs(line: &str, base_size: f64, base_colour: &str, base_bold: bool) -> Vec<Run> {
    let mut out: Vec<Run> = Vec::new();
    let (mut size, mut colour, mut bold) = (base_size, base_colour.to_string(), base_bold);
    // Each open tag, with the state to restore when it closes.
    let mut stack: Vec<(String, f64, String, bool)> = Vec::new();
    let mut pos = 0;
    let mut search = 0;
    while let Some(found) = line[search..].find('<') {
        let open = search + found;
        // A tag is `<`, an optional `/`, a name, anything, then `>`.
        let after = &line[open + 1..];
        let closing = after.starts_with('/');
        let name_start = usize::from(closing);
        let name_len: usize = after[name_start..]
            .chars()
            .take_while(|c| c.is_alphanumeric() || *c == '_')
            .map(char::len_utf8)
            .sum();
        let end = after[name_start + name_len..].find('>');
        let (Some(end), true) = (end, name_len > 0) else {
            search = open + 1;
            continue;
        };
        let tag = after[name_start..name_start + name_len].to_lowercase();
        let attrs = &after[name_start + name_len..name_start + name_len + end];
        if open > pos {
            out.push(Run {
                text: html_unescape(&line[pos..open]),
                size,
                colour: colour.clone(),
                bold,
            });
        }
        if !closing {
            stack.push((tag.clone(), size, colour.clone(), bold));
            if tag == "b" || tag == "strong" {
                bold = true;
            } else if tag == "font" {
                size = font_size_px(attrs, false).unwrap_or(size);
                colour = font_colour(attrs).unwrap_or(colour);
            }
        } else if let Some(i) = stack.iter().rposition(|entry| entry.0 == tag) {
            let entry = stack[i].clone();
            (size, colour, bold) = (entry.1, entry.2, entry.3);
            stack.truncate(i);
        }
        pos = open + 1 + name_start + name_len + end + 1;
        search = pos;
    }
    if pos < line.len() {
        out.push(Run {
            text: html_unescape(&line[pos..]),
            size,
            colour,
            bold,
        });
    }
    out.retain(|run| !run.text.is_empty());
    out
}

fn width_of(line: &[Run]) -> f64 {
    line.iter()
        .map(|run| text_width(&run.text, run.size, run.bold))
        .sum()
}

/// Splits text into words and the runs of whitespace between them.
fn words(text: &str) -> Vec<&str> {
    let mut out = Vec::new();
    let mut start = 0;
    let mut in_space: Option<bool> = None;
    for (i, c) in text.char_indices() {
        let space = c.is_whitespace();
        if in_space.is_some_and(|previous| previous != space) {
            out.push(&text[start..i]);
            start = i;
        }
        in_space = Some(space);
    }
    if start < text.len() {
        out.push(&text[start..]);
    }
    out
}

/// Greedy word wrap across runs. Returns the lines.
fn wrap(line: Vec<Run>, avail: f64) -> Vec<Vec<Run>> {
    if avail <= 0.0 || width_of(&line) <= avail {
        return vec![line];
    }
    let mut lines: Vec<Vec<Run>> = Vec::new();
    let mut current: Vec<Run> = Vec::new();
    let mut current_w = 0.0;
    for run in &line {
        for word in words(&run.text) {
            let space = word.chars().all(char::is_whitespace);
            let word_w = text_width(word, run.size, run.bold);
            if current_w + word_w > avail && !current.is_empty() && !space {
                lines.push(std::mem::take(&mut current));
                current_w = 0.0;
            }
            if space && current.is_empty() {
                continue;
            }
            current.push(Run {
                text: word.to_string(),
                ..run.clone()
            });
            current_w += word_w;
        }
    }
    if !current.is_empty() {
        lines.push(current);
    }
    lines
}

fn label(value: &str, st: &Style, (x, y, w, h): (f64, f64, f64, f64), header: bool) -> String {
    let size = style_number_or(st, "fontSize", 11.0);
    let get = |key: &str, default: &str| -> String {
        st.get(key)
            .filter(|v| !v.is_empty())
            .cloned()
            .unwrap_or(default.to_string())
    };
    let base_colour = get("fontColor", "#000000");
    let font_style = style_number(st, "fontStyle") as i64;
    let (bold, italic) = (font_style & 1 == 1, font_style & 2 == 2);
    let family = get("fontFamily", "Helvetica");
    let align = get("align", if header { "left" } else { "center" });
    let valign = get("verticalAlign", "middle");
    let (sl, sr, stp) = (
        style_number(st, "spacingLeft"),
        style_number(st, "spacingRight"),
        style_number(st, "spacingTop"),
    );
    let is_html = is(st, "html", "1");
    let wraps = is(st, "whiteSpace", "wrap");
    let avail = w - sl - sr - 8.0;

    let plain = |text: &str| Run {
        text: text.to_string(),
        size,
        colour: base_colour.clone(),
        bold,
    };
    let source: Vec<&str> = if is_html {
        split_lines(value)
    } else {
        value.split('\n').collect()
    };
    let mut lines: Vec<Vec<Run>> = Vec::new();
    for text in source {
        let line = if is_html {
            runs(text, size, &base_colour, bold)
        } else {
            vec![plain(text)]
        };
        if line.is_empty() {
            lines.push(vec![plain("")]);
        } else if wraps {
            lines.extend(wrap(line, avail));
        } else {
            lines.push(line);
        }
    }
    let heights: Vec<f64> = lines
        .iter()
        .map(|line| line.iter().map(|r| r.size).reduce(f64::max).unwrap_or(size) * LINE_HEIGHT)
        .collect();
    let total: f64 = heights.iter().sum();
    let mut cy = match valign.as_str() {
        "top" => y + 4.0 + stp,
        "bottom" => y + h - total - 4.0,
        _ => y + (h - total) / 2.0,
    };
    let (ax, anchor) = match align.as_str() {
        "left" => (x + sl + 4.0, "start"),
        "right" => (x + w - sr - 4.0, "end"),
        _ => (x + w / 2.0 + (sl - sr) / 2.0, "middle"),
    };

    let mut out = String::new();
    if let Some(background) = st
        .get("labelBackgroundColor")
        .filter(|b| !b.is_empty() && *b != "none")
    {
        let bw = lines
            .iter()
            .map(|line| width_of(line))
            .reduce(f64::max)
            .unwrap_or(0.0)
            + 6.0;
        let bx = match anchor {
            "middle" => ax - bw / 2.0,
            "start" => ax - 3.0,
            _ => ax - bw + 3.0,
        };
        out.push_str(&format!(
            "<rect x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\" fill=\"{}\"/>",
            g(bx),
            g(cy),
            g(bw),
            g(total),
            svg_attr(background)
        ));
    }
    out.push_str(&format!(
        "<text font-family=\"{}, Arial, sans-serif\" text-anchor=\"{anchor}\"{}>",
        svg_attr(&family),
        if italic { " font-style=\"italic\"" } else { "" }
    ));
    for (line, line_h) in lines.iter().zip(&heights) {
        cy += line_h;
        out.push_str(&format!(
            "<tspan x=\"{}\" y=\"{}\">",
            g(ax),
            g(cy - line_h * 0.25)
        ));
        for run in line {
            out.push_str(&format!(
                "<tspan font-size=\"{}\" fill=\"{}\"{}>{}</tspan>",
                g(run.size),
                svg_attr(&run.colour),
                if run.bold {
                    " font-weight=\"bold\""
                } else {
                    ""
                },
                svg_text(&run.text)
            ));
        }
        out.push_str("</tspan>");
    }
    out.push_str("</text>");
    out
}

// -------------------------------------------------------------------- edges

/// Returns the id of the arrowhead marker for a colour, adding it to the
/// definitions on first use.
fn marker(markers: &mut Vec<(String, String)>, colour: &str, start: bool) -> String {
    let key = format!("{colour}-{}", if start { 's' } else { 'e' });
    let id = format!(
        "m{}",
        key.chars()
            .filter(char::is_ascii_alphanumeric)
            .collect::<String>()
    );
    if !markers.iter().any(|(k, _)| *k == key) {
        let path = if start {
            "M10,0 L0,5 L10,10 z"
        } else {
            "M0,0 L10,5 L0,10 z"
        };
        markers.push((
            key,
            format!(
                "<marker id=\"{id}\" viewBox=\"0 0 10 10\" refX=\"{}\" refY=\"5\" \
                 markerWidth=\"7\" markerHeight=\"7\" orient=\"auto\">\
                 <path d=\"{path}\" fill=\"{}\"/></marker>",
                if start { 0 } else { 10 },
                svg_attr(colour)
            ),
        ));
    }
    id
}

fn distance(p: Point, q: Point) -> f64 {
    (q.0 - p.0).hypot(q.1 - p.1)
}

fn edge(
    cell: &Cell,
    verts: &HashMap<&str, &Vertex>,
    markers: &mut Vec<(String, String)>,
) -> String {
    let Shape::Edge {
        source,
        target,
        points,
        ends,
    } = &cell.shape
    else {
        return String::new();
    };
    let mut st = parse_style(&cell.style);
    let find = |id: &Option<String>| id.as_deref().and_then(|id| verts.get(id));
    let path: Vec<Point> = match (find(source), find(target), ends) {
        (Some(s), Some(t), _) => route(s, t, &st, points),
        (_, _, Some((from, to))) => vec![*from, *to],
        _ => return String::new(),
    };
    let stroke = colour(st.get("strokeColor"), "#000000").unwrap_or("none".to_string());
    let sw = g(style_number_or(&st, "strokeWidth", 1.0));
    let mut marks = String::new();
    if st.get("endArrow").is_none_or(|a| a != "none") {
        marks.push_str(&format!(
            " marker-end=\"url(#{})\"",
            marker(markers, &stroke, false)
        ));
    }
    if st.get("startArrow").is_some_and(|a| a != "none") {
        marks.push_str(&format!(
            " marker-start=\"url(#{})\"",
            marker(markers, &stroke, true)
        ));
    }
    let d = path
        .iter()
        .map(|(px, py)| format!("{},{}", g(*px), g(*py)))
        .collect::<Vec<_>>()
        .join(" L");
    let mut out = format!(
        "<path d=\"M{d}\" fill=\"none\" stroke=\"{}\" stroke-width=\"{sw}\"{}{marks}/>",
        svg_attr(&stroke),
        dash(&st)
    );
    if !cell.value.is_empty() {
        // The midpoint by length, where draw.io puts an edge label by default.
        let total: f64 = path.windows(2).map(|leg| distance(leg[0], leg[1])).sum();
        let (mut acc, mut mid) = (0.0, path[0]);
        for leg in path.windows(2) {
            let (p, q) = (leg[0], leg[1]);
            let length = distance(p, q);
            if length != 0.0 && acc + length >= total / 2.0 {
                let t = (total / 2.0 - acc) / length;
                mid = (p.0 + (q.0 - p.0) * t, p.1 + (q.1 - p.1) * t);
                break;
            }
            acc += length;
        }
        st.entry("fontSize".to_string()).or_insert("10".to_string());
        st.insert("align".to_string(), "center".to_string());
        st.insert("verticalAlign".to_string(), "middle".to_string());
        st.remove("whiteSpace");
        out.push_str(&label(
            &cell.value,
            &st,
            (mid.0 - 100.0, mid.1 - 20.0, 200.0, 40.0),
            false,
        ));
    }
    out
}
