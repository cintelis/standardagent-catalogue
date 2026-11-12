//! Declarative diagrams: a JSON spec to a [`Document`]. A port of
//! `drawgen/spec.py`.
//!
//! The model writes data, not code. Every mistake is reported with the path to
//! the entry that is wrong and the values that would have been accepted,
//! because the reader is a model that will fix it and try again.

use crate::diagram::{Diagram, Document, EdgeSpec};
use crate::theme::{self, NODE_H, NODE_W};
use crate::util::{repr, repr_names, repr_str, to_text, truthy};
use serde_json::{Map, Value};
use std::collections::{BTreeMap, HashMap, HashSet, VecDeque};

/// The spec format, for the model to read before it writes a spec.
pub const SPEC_FORMAT: &str = r##"A diagram spec is one JSON object:

  title      required
  subtitle   optional one-liner under the title
  width, height   optional; leave both out and the page is sized to its content
  layout     "auto" places the nodes that have no x and y; leave out for manual
  direction  for auto layout: "right" (default) or "down"
  zones      [{id, label, x, y, w, h, colour}]   tinted, titled containers
  nodes      [{id, label, kind, sub, zone, x, y, w, h}]
  entities   [{id, name, fields, x, y, w, zone}]   entity-relationship tables
  edges      [{from, to, label, style, exit, entry, points, both, curved}]
  texts      [{id, label, x, y, w, h, size, bold, align}]   free text
  legend     true (placed right of the content), or {x, y}

Rules:
- Every id is unique on the page. An edge's from and to name those ids.
- A node needs both x and y, or neither. Without them the page needs layout: "auto".
- A node in a zone sets zone to the zone's id and still uses absolute page coordinates
  inside the zone's rectangle. A node in a zone always needs x and y.
- kind picks the shape and the colour. Never put a colour on a node.
- An entity field that starts with "PK " or "FK " is marked as a key.
- exit and entry pin an edge to a side: "top", "bottom", "left", or "right".
- points is a list of [x, y] waypoints that the edge passes through.
- Default node size is 170 x 64. Zone colour defaults to grey. Edge style defaults to sync.

Example:
  {"title": "Order flow",
   "zones": [{"id": "aws", "label": "AWS", "x": 260, "y": 90, "w": 700, "h": 260, "colour": "amber"}],
   "nodes": [
     {"id": "shopper", "label": "Shopper", "kind": "actor", "x": 40, "y": 160},
     {"id": "api", "label": "Orders API", "kind": "service", "sub": "Node 24", "zone": "aws", "x": 300, "y": 160},
     {"id": "db", "label": "Postgres", "kind": "datastore", "zone": "aws", "x": 560, "y": 140, "w": 140, "h": 90}],
   "edges": [
     {"from": "shopper", "to": "api", "label": "POST /orders"},
     {"from": "api", "to": "db", "label": "insert", "style": "data"}],
   "legend": true}
"##;

const PAGE_KEYS: &[&str] = &[
    "direction",
    "edges",
    "entities",
    "height",
    "id",
    "layout",
    "legend",
    "nodes",
    "subtitle",
    "texts",
    "title",
    "width",
    "zones",
];
const ZONE_KEYS: &[&str] = &["color", "colour", "h", "id", "label", "w", "x", "y"];
const NODE_KEYS: &[&str] = &["h", "id", "kind", "label", "sub", "w", "x", "y", "zone"];
const ENTITY_KEYS: &[&str] = &["fields", "id", "name", "w", "x", "y", "zone"];
const EDGE_KEYS: &[&str] = &[
    "arrow", "both", "curved", "entry", "exit", "from", "id", "label", "points", "style", "to",
];
const TEXT_KEYS: &[&str] = &[
    "align", "bold", "color", "colour", "h", "id", "label", "size", "w", "x", "y",
];
const LEGEND_KEYS: &[&str] = &["edges", "kinds", "x", "y"];

const SIDES: [&str; 4] = ["top", "bottom", "left", "right"];

type Object = Map<String, Value>;

/// Builds a document from a spec, or returns a message that names every
/// problem, one on each line.
pub fn build(spec: &Value) -> Result<Document, String> {
    let Some(top) = spec.as_object() else {
        return Err("a spec must be a mapping".to_string());
    };
    let single = [spec.clone()];
    let pages: &[Value] = match top.get("pages") {
        None | Some(Value::Null) => &single,
        Some(Value::Array(pages)) if !pages.is_empty() => pages,
        Some(_) => return Err("pages: must be a non-empty list of page specs".to_string()),
    };
    let mut doc = Document { pages: Vec::new() };
    let mut errors = Vec::new();
    for (i, page) in pages.iter().enumerate() {
        let place = if top.contains_key("pages") {
            format!("pages[{i}]")
        } else {
            "spec".to_string()
        };
        match build_page(page, &place, i) {
            Ok(diagram) => doc.pages.push(diagram),
            Err(e) => errors.push(e),
        }
    }
    if errors.is_empty() {
        Ok(doc)
    } else {
        Err(errors.join("\n"))
    }
}

// ----------------------------------------------------------------- one page

fn build_page(page: &Value, place: &str, index: usize) -> Result<Diagram, String> {
    let Some(p) = page.as_object() else {
        return Err(format!("{place}: a page must be a mapping"));
    };
    let mut problems: Vec<String> = Vec::new();
    check_keys(page, PAGE_KEYS, place, &mut problems);
    if !p.get("title").is_some_and(truthy) {
        problems.push(format!("{place}.title: required"));
    }
    check_numbers(p, &["width", "height"], &[], place, &mut problems);

    let nodes = list(p, "nodes", place, &mut problems);
    let zones = list(p, "zones", place, &mut problems);
    let entities = list(p, "entities", place, &mut problems);
    let edges = list(p, "edges", place, &mut problems);
    let texts = list(p, "texts", place, &mut problems);
    let auto = p.get("layout").and_then(Value::as_str) == Some("auto");

    for (i, zone) in zones.iter().enumerate() {
        let at = format!("{place}.zones[{i}]");
        check_keys(zone, ZONE_KEYS, &at, &mut problems);
        let Some(z) = zone.as_object() else { continue };
        let required = ["id", "label", "x", "y", "w", "h"];
        need(z, &required, &at, &mut problems);
        check_numbers(z, &["x", "y", "w", "h"], &required, &at, &mut problems);
        let colour = zone_colour(z);
        if colour.as_str().and_then(theme::find_zone_colour).is_none() {
            problems.push(format!(
                "{at}.colour: {} is not one of {}",
                repr(&colour),
                repr_names(&theme::zone_colour_names())
            ));
        }
    }
    for (i, node) in nodes.iter().enumerate() {
        let at = format!("{place}.nodes[{i}]");
        check_keys(node, NODE_KEYS, &at, &mut problems);
        let Some(n) = node.as_object() else { continue };
        need(n, &["id", "label"], &at, &mut problems);
        check_numbers(n, &["x", "y", "w", "h"], &[], &at, &mut problems);
        let kind = n.get("kind").cloned().unwrap_or(Value::from("service"));
        if kind.as_str().and_then(theme::find_kind).is_none() {
            problems.push(format!(
                "{at}.kind: {} is not one of {}",
                repr(n.get("kind").unwrap_or(&Value::Null)),
                repr_names(&theme::kind_names())
            ));
        }
        let has_x = n.contains_key("x");
        if has_x != n.contains_key("y") {
            problems.push(format!("{at}: give both x and y, or neither (auto layout)"));
        }
        if !has_x && !auto {
            problems.push(format!(
                "{at}: no x/y; add coordinates or set layout: auto on the page"
            ));
        }
        if !has_x && n.get("zone").is_some_and(truthy) {
            problems.push(format!(
                "{at}: a node in a zone needs x/y; auto layout only places top-level nodes"
            ));
        }
    }
    for (i, entity) in entities.iter().enumerate() {
        let at = format!("{place}.entities[{i}]");
        check_keys(entity, ENTITY_KEYS, &at, &mut problems);
        let Some(e) = entity.as_object() else {
            continue;
        };
        let required = ["id", "name", "fields", "x", "y"];
        need(e, &required, &at, &mut problems);
        check_numbers(e, &["x", "y", "w"], &required, &at, &mut problems);
        if e.get("fields")
            .is_some_and(|f| !f.is_null() && !f.is_array())
        {
            problems.push(format!("{at}.fields: must be a list"));
        }
    }
    for (i, edge) in edges.iter().enumerate() {
        let at = format!("{place}.edges[{i}]");
        check_keys(edge, EDGE_KEYS, &at, &mut problems);
        let Some(e) = edge.as_object() else { continue };
        need(e, &["from", "to"], &at, &mut problems);
        let style = e.get("style").cloned().unwrap_or(Value::from("sync"));
        if style.as_str().and_then(theme::find_edge_style).is_none() {
            problems.push(format!(
                "{at}.style: {} is not one of {}",
                repr(e.get("style").unwrap_or(&Value::Null)),
                repr_names(&theme::edge_style_names())
            ));
        }
        for key in ["exit", "entry"] {
            if let Some(side) = e.get(key)
                && !side.as_str().is_some_and(|s| SIDES.contains(&s))
            {
                problems.push(format!(
                    "{at}.{key}: {} must be top, bottom, left or right",
                    repr(side)
                ));
            }
        }
        if e.get("points").is_some_and(truthy) && waypoints(e).is_none() {
            problems.push(format!("{at}.points: must be a list of [x, y] pairs"));
        }
    }
    for (i, text) in texts.iter().enumerate() {
        let at = format!("{place}.texts[{i}]");
        check_keys(text, TEXT_KEYS, &at, &mut problems);
        let Some(t) = text.as_object() else { continue };
        let required = ["id", "label", "x", "y"];
        need(t, &required, &at, &mut problems);
        check_numbers(
            t,
            &["x", "y", "w", "h", "size"],
            &required,
            &at,
            &mut problems,
        );
    }
    let legend = p.get("legend");
    if let Some(lg) = legend.and_then(Value::as_object) {
        let at = format!("{place}.legend");
        check_keys(&Value::Object(lg.clone()), LEGEND_KEYS, &at, &mut problems);
        check_numbers(lg, &["x", "y"], &[], &at, &mut problems);
        for key in ["kinds", "edges"] {
            if lg.get(key).is_some_and(|v| !v.is_null() && !v.is_array()) {
                problems.push(format!("{at}.{key}: must be a list"));
            }
        }
    }

    // Ids are unique across zones, nodes, entities, and texts. Edges name them.
    let id_of = |item: &Value| {
        item.as_object()
            .map(|o| repr(o.get("id").unwrap_or(&Value::Null)))
    };
    let ids: Vec<String> = zones
        .iter()
        .chain(&nodes)
        .chain(&entities)
        .chain(&texts)
        .filter_map(id_of)
        .collect();
    let mut seen = HashSet::new();
    let mut duplicates: Vec<&String> = ids.iter().filter(|id| !seen.insert(id.as_str())).collect();
    duplicates.sort();
    duplicates.dedup();
    for id in duplicates {
        problems.push(format!("{place}: id {id} is used more than once"));
    }
    for (i, edge) in edges.iter().enumerate() {
        let Some(e) = edge.as_object() else { continue };
        for key in ["from", "to"] {
            if let Some(end) = e.get(key).filter(|v| !v.is_null())
                && !seen.contains(repr(end).as_str())
            {
                problems.push(format!(
                    "{place}.edges[{i}].{key}: no node, zone, entity or text has id {}",
                    repr(end)
                ));
            }
        }
    }
    let zone_ids: HashSet<String> = zones.iter().filter_map(id_of).collect();
    for (items, name) in [(&nodes, "nodes"), (&entities, "entities")] {
        for (i, item) in items.iter().enumerate() {
            let Some(zone) = item
                .as_object()
                .and_then(|o| o.get("zone"))
                .filter(|z| truthy(z))
            else {
                continue;
            };
            if !zone_ids.contains(&repr(zone)) {
                problems.push(format!(
                    "{place}.{name}[{i}].zone: no zone has id {}",
                    repr(zone)
                ));
            }
        }
    }
    if !problems.is_empty() {
        return Err(problems.join("\n"));
    }

    // From here every entry is an object with the fields it needs.
    let width = p.get("width").and_then(Value::as_f64).unwrap_or(1400.0) as i64;
    let height = p.get("height").and_then(Value::as_f64).unwrap_or(900.0) as i64;
    let subtitle = p.get("subtitle").filter(|s| truthy(s)).map(to_text);
    let placed = if auto {
        let direction = p
            .get("direction")
            .and_then(Value::as_str)
            .unwrap_or("right");
        auto_layout(
            &nodes,
            &edges,
            direction,
            if subtitle.is_some() { 100.0 } else { 80.0 },
        )
    } else {
        HashMap::new()
    };
    let page_id = match p.get("id").filter(|id| truthy(id)) {
        Some(id) => to_text(id),
        None => format!("page-{}", index + 1),
    };

    let fail = |e: String| format!("{place}: {e}");
    let mut d = Diagram::new(
        &text_of(p, "title"),
        width,
        height,
        subtitle.as_deref(),
        &page_id,
    )
    .map_err(fail)?;
    for z in zones.iter().filter_map(Value::as_object) {
        let geometry = (
            number(z, "x", 0.0),
            number(z, "y", 0.0),
            number(z, "w", 0.0),
            number(z, "h", 0.0),
        );
        d.zone(
            &text_of(z, "id"),
            &text_of(z, "label"),
            geometry,
            &to_text(&zone_colour(z)),
        )
        .map_err(fail)?;
    }
    for (i, n) in nodes.iter().enumerate() {
        let Some(n) = n.as_object() else { continue };
        let (x, y) = placed
            .get(&i)
            .copied()
            .unwrap_or((number(n, "x", 0.0), number(n, "y", 0.0)));
        let kind = n.get("kind").and_then(Value::as_str).unwrap_or("service");
        d.node(
            &text_of(n, "id"),
            &text_of(n, "label"),
            (x, y, number(n, "w", NODE_W), number(n, "h", NODE_H)),
            kind,
            optional_text(n, "sub").as_deref(),
            optional_text(n, "zone").as_deref(),
        )
        .map_err(fail)?;
    }
    for e in entities.iter().filter_map(Value::as_object) {
        let fields: Vec<String> = e
            .get("fields")
            .and_then(Value::as_array)
            .map(|f| f.iter().map(to_text).collect())
            .unwrap_or_default();
        d.entity(
            &text_of(e, "id"),
            &text_of(e, "name"),
            &fields,
            (
                number(e, "x", 0.0),
                number(e, "y", 0.0),
                number(e, "w", 230.0),
            ),
            optional_text(e, "zone").as_deref(),
        )
        .map_err(fail)?;
    }
    for t in texts.iter().filter_map(Value::as_object) {
        let colour = t
            .get("colour")
            .or_else(|| t.get("color"))
            .map(to_text)
            .unwrap_or("#4B5563".to_string());
        d.text(
            &text_of(t, "id"),
            &text_of(t, "label"),
            (
                number(t, "x", 0.0),
                number(t, "y", 0.0),
                number(t, "w", 300.0),
                number(t, "h", 24.0),
            ),
            &t.get("size").map(to_text).unwrap_or("11".to_string()),
            t.get("bold").is_some_and(truthy),
            &colour,
            &t.get("align").map(to_text).unwrap_or("left".to_string()),
        )
        .map_err(fail)?;
    }
    for e in edges.iter().filter_map(Value::as_object) {
        d.edge(EdgeSpec {
            source: &text_of(e, "from"),
            target: &text_of(e, "to"),
            label: &e.get("label").map(to_text).unwrap_or_default(),
            style: e.get("style").and_then(Value::as_str).unwrap_or("sync"),
            exit: e.get("exit").and_then(Value::as_str),
            entry: e.get("entry").and_then(Value::as_str),
            points: waypoints(e).unwrap_or_default(),
            arrow: &e.get("arrow").map(to_text).unwrap_or("block".to_string()),
            both: e.get("both").is_some_and(truthy),
            curved: e.get("curved").is_some_and(truthy),
            id: e.get("id").filter(|id| !id.is_null()).map(to_text),
        })
        .map_err(fail)?;
    }
    if let Some(legend) = legend.filter(|l| truthy(l)) {
        let empty = Map::new();
        let lg = legend.as_object().unwrap_or(&empty);
        let (x, y) = if lg.contains_key("x") && lg.contains_key("y") {
            (number(lg, "x", 0.0), number(lg, "y", 0.0))
        } else {
            d.legend_slot()
        };
        let names = |key: &str| {
            lg.get(key)
                .and_then(Value::as_array)
                .map(|a| a.iter().map(to_text).collect())
        };
        d.legend(x, y, names("kinds"), names("edges"))
            .map_err(fail)?;
    }
    // A page whose size the author did not set is sized to what is on it.
    if !p.contains_key("width") && !p.contains_key("height") {
        d.fit_page();
    }
    Ok(d)
}

/// Places the nodes that have no coordinates in layers: each node goes one
/// layer after the latest node that points at it. Returns the position of
/// each placed node by its index in `nodes`.
fn auto_layout(
    nodes: &[Value],
    edges: &[Value],
    direction: &str,
    top: f64,
) -> HashMap<usize, (f64, f64)> {
    let free: Vec<(usize, &Object)> = nodes
        .iter()
        .enumerate()
        .filter_map(|(i, n)| n.as_object().map(|o| (i, o)))
        .filter(|(_, o)| !o.contains_key("x"))
        .collect();
    let mut placed = HashMap::new();
    if free.is_empty() {
        return placed;
    }
    let key = |o: &Object, field: &str| repr(o.get(field).unwrap_or(&Value::Null));
    let position: HashMap<String, usize> = free
        .iter()
        .enumerate()
        .map(|(j, (_, o))| (key(o, "id"), j))
        .collect();

    let mut successors: Vec<Vec<usize>> = vec![Vec::new(); free.len()];
    let mut incoming: Vec<i64> = vec![0; free.len()];
    for e in edges.iter().filter_map(Value::as_object) {
        if let (Some(&a), Some(&b)) = (position.get(&key(e, "from")), position.get(&key(e, "to")))
            && a != b
        {
            successors[a].push(b);
            incoming[b] += 1;
        }
    }

    // Kahn's algorithm. A node left in a cycle keeps the rank it reached.
    let mut rank: Vec<usize> = vec![0; free.len()];
    let mut queue: VecDeque<usize> = (0..free.len()).filter(|&j| incoming[j] == 0).collect();
    if queue.is_empty() {
        queue.push_back(0);
    }
    let mut steps = 0;
    while steps < free.len() * 4 {
        let Some(current) = queue.pop_front() else {
            break;
        };
        steps += 1;
        for &next in &successors[current] {
            rank[next] = rank[next].max(rank[current] + 1);
            incoming[next] -= 1;
            if incoming[next] == 0 {
                queue.push_back(next);
            }
        }
    }

    // Spec order within a layer keeps the author's intent.
    let mut layers: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
    for (j, &r) in rank.iter().enumerate() {
        layers.entry(r).or_default().push(j);
    }
    let (gap_major, gap_minor, margin) = (80.0, 40.0, 40.0);
    for (r, layer) in layers {
        for (j, &node) in layer.iter().enumerate() {
            let (index, n) = free[node];
            let (w, h) = (number(n, "w", NODE_W), number(n, "h", NODE_H));
            let (r, j) = (r as f64, j as f64);
            let at = if direction == "down" {
                (margin + j * (w + gap_minor), top + r * (h + gap_major))
            } else {
                (margin + r * (w + gap_major), top + j * (h + gap_minor))
            };
            placed.insert(index, at);
        }
    }
    placed
}

// ------------------------------------------------------------------ helpers

fn list(p: &Object, key: &str, place: &str, problems: &mut Vec<String>) -> Vec<Value> {
    match p.get(key) {
        Some(Value::Array(items)) => items.clone(),
        Some(other) if truthy(other) => {
            problems.push(format!("{place}.{key}: must be a list"));
            Vec::new()
        }
        _ => Vec::new(),
    }
}

fn check_keys(item: &Value, allowed: &[&str], place: &str, problems: &mut Vec<String>) {
    let Some(object) = item.as_object() else {
        problems.push(format!("{place}: must be a mapping"));
        return;
    };
    for key in object.keys() {
        if !allowed.contains(&key.as_str()) {
            problems.push(format!(
                "{place}: unknown key {}; allowed: {}",
                repr_str(key),
                repr_names(allowed)
            ));
        }
    }
}

fn need(object: &Object, keys: &[&str], place: &str, problems: &mut Vec<String>) {
    for key in keys {
        if object.get(*key).is_none_or(Value::is_null) {
            problems.push(format!("{place}.{key}: required"));
        }
    }
}

/// Reports a field that is present and is not a number. A required field that
/// is null is already reported as missing.
fn check_numbers(
    object: &Object,
    keys: &[&str],
    required: &[&str],
    place: &str,
    problems: &mut Vec<String>,
) {
    for key in keys {
        match object.get(*key) {
            None | Some(Value::Number(_)) => {}
            Some(Value::Null) if required.contains(key) => {}
            Some(_) => problems.push(format!("{place}.{key}: must be a number")),
        }
    }
}

fn number(object: &Object, key: &str, default: f64) -> f64 {
    object.get(key).and_then(Value::as_f64).unwrap_or(default)
}

fn text_of(object: &Object, key: &str) -> String {
    object.get(key).map(to_text).unwrap_or_default()
}

fn optional_text(object: &Object, key: &str) -> Option<String> {
    object.get(key).filter(|v| truthy(v)).map(to_text)
}

fn zone_colour(zone: &Object) -> Value {
    zone.get("colour")
        .or_else(|| zone.get("color"))
        .cloned()
        .unwrap_or(Value::from("grey"))
}

/// The waypoints of an edge, or `None` when `points` is not a list of pairs.
fn waypoints(edge: &Object) -> Option<Vec<(f64, f64)>> {
    let Some(points) = edge.get("points").filter(|p| truthy(p)) else {
        return Some(Vec::new());
    };
    points
        .as_array()?
        .iter()
        .map(|point| match point.as_array()?.as_slice() {
            [x, y] => Some((x.as_f64()?, y.as_f64()?)),
            _ => None,
        })
        .collect()
}
