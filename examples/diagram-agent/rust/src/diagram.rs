//! Builds draw.io pages as mxGraph XML. A port of `drawgen/diagram.py`.
//!
//! Every cell id is claimed once per page; a duplicate is an error, because
//! draw.io opens such a file with cells missing. Each cell carries a
//! `drawgenRole=` style key, which draw.io ignores and keeps, so the checker
//! can tell a container from a component.
//!
//! Coordinates are absolute page coordinates. A node placed in a zone is
//! converted to the zone-relative geometry that draw.io stores.

use crate::theme::{self, EDGE_SIZE, FONT, NODE_SIZE, TITLE_SIZE};
use crate::util::{
    attr, attr_round_trip, is_valid_xml_text, label_html, num, repr_names, repr_str, round_trip,
};
use std::collections::{HashMap, HashSet};

type Point = (f64, f64);

/// The geometry of a cell, as a reader of the XML sees it.
#[derive(Debug, Clone)]
pub enum Shape {
    /// `x` and `y` are relative to the parent cell.
    Vertex { x: f64, y: f64, w: f64, h: f64 },
    Edge {
        source: Option<String>,
        target: Option<String>,
        /// Waypoints between the two ends.
        points: Vec<Point>,
        /// Fixed ends of a line that joins no cells, such as a legend swatch.
        ends: Option<(Point, Point)>,
    },
}

/// One `<mxCell>`: its XML, and the same data in a form the checker and the
/// renderer can read without parsing the XML again.
#[derive(Debug, Clone)]
pub struct Cell {
    pub id: String,
    pub parent: String,
    /// The label, as HTML.
    pub value: String,
    pub style: String,
    pub shape: Shape,
    pub xml: String,
}

/// Where a vertex sits on the page, in absolute coordinates.
#[derive(Debug, Clone)]
struct PlacedBox {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    role: &'static str,
    parent: String,
}

/// An edge between two cells. `Default` gives a plain synchronous arrow.
pub struct EdgeSpec<'a> {
    pub source: &'a str,
    pub target: &'a str,
    pub label: &'a str,
    pub style: &'a str,
    pub exit: Option<&'a str>,
    pub entry: Option<&'a str>,
    pub points: Vec<Point>,
    pub arrow: &'a str,
    pub both: bool,
    pub curved: bool,
    pub id: Option<String>,
}

/// One draw.io page.
pub struct Diagram {
    pub name: String,
    pub width: i64,
    pub height: i64,
    pub page_id: String,
    pub cells: Vec<Cell>,
    ids: HashSet<String>,
    boxes: HashMap<String, PlacedBox>,
    edge_count: usize,
    title_width: f64,
    pub kinds_used: Vec<String>,
    pub edge_styles_used: Vec<String>,
}

/// The connection point for a side, as the fractions draw.io stores.
fn port(side: &str) -> Option<(&'static str, &'static str)> {
    match side {
        "top" => Some(("0.5", "0")),
        "bottom" => Some(("0.5", "1")),
        "left" => Some(("0", "0.5")),
        "right" => Some(("1", "0.5")),
        _ => None,
    }
}

impl Diagram {
    pub fn new(
        name: &str,
        width: i64,
        height: i64,
        subtitle: Option<&str>,
        page_id: &str,
    ) -> Result<Self, String> {
        let mut diagram = Diagram {
            name: name.to_string(),
            width,
            height,
            page_id: page_id.to_string(),
            cells: Vec::new(),
            ids: HashSet::new(),
            boxes: HashMap::new(),
            edge_count: 0,
            title_width: (width - 60) as f64,
            kinds_used: Vec::new(),
            edge_styles_used: Vec::new(),
        };
        let title_width = (width - 60) as f64;
        diagram.add_vertex(
            "title",
            &label_html(name),
            &format!(
                "text;html=1;fontFamily={FONT};fontSize={TITLE_SIZE};fontStyle=1;fontColor=#111827;\
                 align=left;verticalAlign=middle;drawgenRole=title;"
            ),
            (30.0, 20.0, title_width, 32.0),
            "1",
            "title",
        )?;
        if let Some(subtitle) = subtitle.filter(|s| !s.is_empty()) {
            diagram.add_vertex(
                "subtitle",
                &label_html(subtitle),
                &format!(
                    "text;html=1;fontFamily={FONT};fontSize=12;fontColor=#4B5563;\
                     align=left;verticalAlign=top;whiteSpace=wrap;drawgenRole=title;"
                ),
                (30.0, 52.0, title_width, 36.0),
                "1",
                "title",
            )?;
        }
        Ok(diagram)
    }

    // ------------------------------------------------------------ raw cells

    fn claim(&mut self, id: &str) -> Result<(), String> {
        if id.is_empty() || id == "0" || id == "1" {
            return Err(format!(
                "cell id {} is empty or reserved (0 and 1 belong to draw.io)",
                repr_str(id)
            ));
        }
        if !self.ids.insert(id.to_string()) {
            return Err(format!(
                "duplicate cell id {} on page {}",
                repr_str(id),
                repr_str(&self.name)
            ));
        }
        Ok(())
    }

    /// Adds a vertex with a raw style and an HTML label. The geometry is
    /// `(x, y, width, height)`, with `x` and `y` relative to `parent`.
    fn add_vertex(
        &mut self,
        id: &str,
        value_html: &str,
        style: &str,
        (x, y, w, h): (f64, f64, f64, f64),
        parent: &str,
        role: &'static str,
    ) -> Result<(), String> {
        self.claim(id)?;
        if parent != "1" && !self.ids.contains(parent) {
            return Err(format!(
                "cell {}: parent {} does not exist (add it first)",
                repr_str(id),
                repr_str(parent)
            ));
        }
        let xml = format!(
            "<mxCell id=\"{}\" value=\"{}\" style=\"{}\" vertex=\"1\" parent=\"{}\">\
             <mxGeometry x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\" as=\"geometry\"/></mxCell>",
            attr(id),
            attr(value_html),
            attr(style),
            attr(parent),
            num(x),
            num(y),
            num(w),
            num(h),
        );
        self.cells.push(Cell {
            id: id.to_string(),
            parent: parent.to_string(),
            value: attr_round_trip(value_html),
            style: attr_round_trip(style),
            shape: Shape::Vertex {
                x: round_trip(x),
                y: round_trip(y),
                w: round_trip(w),
                h: round_trip(h),
            },
            xml,
        });
        let (ax, ay) = match self.boxes.get(parent) {
            Some(b) => (x + b.x, y + b.y),
            None => (x, y),
        };
        self.boxes.insert(
            id.to_string(),
            PlacedBox {
                x: ax,
                y: ay,
                w,
                h,
                role,
                parent: parent.to_string(),
            },
        );
        Ok(())
    }

    /// Adds an edge between two existing cells, with optional waypoints.
    fn add_edge(
        &mut self,
        id: &str,
        source: &str,
        target: &str,
        style: &str,
        points: &[Point],
        value_html: &str,
    ) -> Result<(), String> {
        self.claim(id)?;
        for end in [source, target] {
            if !self.ids.contains(end) {
                return Err(format!(
                    "edge {}: endpoint {} does not exist (add it before the edge)",
                    repr_str(id),
                    repr_str(end)
                ));
            }
        }
        let mut waypoints = String::new();
        if !points.is_empty() {
            waypoints.push_str("<Array as=\"points\">");
            for (px, py) in points {
                waypoints.push_str(&format!("<mxPoint x=\"{}\" y=\"{}\"/>", num(*px), num(*py)));
            }
            waypoints.push_str("</Array>");
        }
        let xml = format!(
            "<mxCell id=\"{}\" value=\"{}\" style=\"{}\" edge=\"1\" parent=\"1\" source=\"{}\" target=\"{}\">\
             <mxGeometry relative=\"1\" as=\"geometry\">{}</mxGeometry></mxCell>",
            attr(id),
            attr(value_html),
            attr(style),
            attr(source),
            attr(target),
            waypoints,
        );
        self.cells.push(Cell {
            id: id.to_string(),
            parent: "1".to_string(),
            value: attr_round_trip(value_html),
            style: attr_round_trip(style),
            shape: Shape::Edge {
                source: Some(source.to_string()),
                target: Some(target.to_string()),
                points: points
                    .iter()
                    .map(|(px, py)| (round_trip(*px), round_trip(*py)))
                    .collect(),
                ends: None,
            },
            xml,
        });
        Ok(())
    }

    // ---------------------------------------------------------- themed cells

    /// A titled container. Nodes placed in it keep absolute coordinates.
    pub fn zone(
        &mut self,
        id: &str,
        label: &str,
        geometry: (f64, f64, f64, f64),
        colour: &str,
    ) -> Result<(), String> {
        let Some((fill, stroke)) = theme::find_zone_colour(colour) else {
            return Err(format!(
                "zone {}: unknown colour {}; use one of {}",
                repr_str(id),
                repr_str(colour),
                repr_names(&theme::zone_colour_names())
            ));
        };
        let style = format!(
            "swimlane;html=1;startSize=30;rounded=1;arcSize=4;fontFamily={FONT};fontSize=13;\
             fontStyle=1;fillColor={fill};swimlaneFillColor={fill};strokeColor={stroke};\
             fontColor=#1F2937;align=left;spacingLeft=12;collapsible=0;container=1;drawgenRole=zone;"
        );
        self.add_vertex(id, &label_html(label), &style, geometry, "1", "zone")
    }

    /// A themed component at absolute page coordinates.
    pub fn node(
        &mut self,
        id: &str,
        label: &str,
        (x, y, w, h): (f64, f64, f64, f64),
        kind: &str,
        sub: Option<&str>,
        zone: Option<&str>,
    ) -> Result<(), String> {
        let Some(k) = theme::find_kind(kind) else {
            return Err(format!(
                "node {}: unknown kind {}; use one of {}",
                repr_str(id),
                repr_str(kind),
                repr_names(&theme::kind_names())
            ));
        };
        let sub = sub.filter(|s| !s.is_empty());
        let mut text = format!("<b>{}</b>", label_html(label));
        if let Some(sub) = sub {
            let sub_colour = match kind {
                "terminal" => "#D1D5DB",
                "note" => "#3D3000",
                _ => "#4B5563",
            };
            let sub_size = if kind == "note" { 11 } else { 10 };
            text.push_str(&format!(
                "<br><font style=\"font-size:{sub_size}px\" color=\"{sub_colour}\">{}</font>",
                label_html(sub)
            ));
        }
        let mut style = format!(
            "html=1;whiteSpace=wrap;fontFamily={FONT};fontSize={NODE_SIZE};fillColor={};\
             strokeColor={};fontColor={};strokeWidth=1.5;",
            k.fill, k.stroke, k.font
        );
        style.push_str(match k.shape {
            "box" => "rounded=1;arcSize=12;",
            "cylinder" => "shape=cylinder3;boundedLbl=1;size=10;",
            // A horizontal cylinder drawn as one. draw.io rotates connection
            // ports with direction=, so a rotated vertical cylinder would not do.
            "queue" => "shape=mxgraph.flowchart.direct_data;",
            "actor" | "pill" => "rounded=1;arcSize=50;",
            "rhombus" => "rhombus;",
            "note" => "shape=note;size=14;align=left;spacingLeft=8;spacingRight=8;",
            _ => "",
        });
        if k.shape == "note" && sub.is_none() {
            text = label_html(label);
        }
        if k.dashed {
            style.push_str("dashed=1;dashPattern=6 4;");
        }
        style.push_str("drawgenRole=node;");
        let (parent, px, py) = self.in_zone(zone, x, y, id)?;
        self.add_vertex(id, &text, &style, (px, py, w, h), &parent, "node")?;
        if !self.kinds_used.iter().any(|used| used == kind) {
            self.kinds_used.push(kind.to_string());
        }
        Ok(())
    }

    /// An entity-relationship table: a header and one row for each field. A
    /// field that starts with "PK " or "FK " is marked as a key.
    pub fn entity(
        &mut self,
        id: &str,
        name: &str,
        fields: &[String],
        (x, y, w): (f64, f64, f64),
        zone: Option<&str>,
    ) -> Result<(), String> {
        let row_h = 20.0;
        let h = 30.0 + row_h * fields.len() as f64;
        let stroke = theme::find_kind("datastore")
            .map(|k| k.stroke)
            .unwrap_or("#1E6FB8");
        let style = format!(
            "swimlane;html=1;fontStyle=1;startSize=30;fontFamily={FONT};fontSize={NODE_SIZE};\
             fillColor={stroke};swimlaneFillColor=#FFFFFF;strokeColor={stroke};\
             fontColor=#FFFFFF;rounded=1;arcSize=4;collapsible=0;childLayout=stackLayout;\
             horizontal=1;resizeParent=1;drawgenRole=entity;"
        );
        let (parent, px, py) = self.in_zone(zone, x, y, id)?;
        self.add_vertex(
            id,
            &label_html(name),
            &style,
            (px, py, w, h),
            &parent,
            "entity",
        )?;
        for (i, field) in fields.iter().enumerate() {
            let font_style = if field.starts_with("PK ") {
                1
            } else if field.starts_with("FK ") {
                2
            } else {
                0
            };
            self.add_vertex(
                &format!("{id}_f{i}"),
                &label_html(field),
                &format!(
                    "text;html=1;fontFamily={FONT};fontSize=11;align=left;verticalAlign=middle;\
                     spacingLeft=8;fontColor=#1F2937;fontStyle={font_style};strokeColor=none;fillColor=none;\
                     drawgenRole=field;"
                ),
                (0.0, 30.0 + i as f64 * row_h, w, row_h),
                id,
                "field",
            )?;
        }
        Ok(())
    }

    /// A themed, labelled edge.
    pub fn edge(&mut self, e: EdgeSpec) -> Result<(), String> {
        let Some(s) = theme::find_edge_style(e.style) else {
            return Err(format!(
                "edge {}->{}: unknown style {}; use one of {}",
                e.source,
                e.target,
                repr_str(e.style),
                repr_names(&theme::edge_style_names())
            ));
        };
        let id = match e.id {
            Some(id) => id,
            None => loop {
                self.edge_count += 1;
                let candidate = format!("edge-{}", self.edge_count);
                if !self.ids.contains(&candidate) {
                    break candidate;
                }
            },
        };
        let mut style = format!(
            "html=1;edgeStyle={};rounded=1;orthogonalLoop=1;jettySize=auto;fontFamily={FONT};fontSize={EDGE_SIZE};\
             fontColor=#374151;strokeColor={};strokeWidth={};endArrow={};endFill=1;labelBackgroundColor=#FFFFFF;",
            if e.curved {
                "none"
            } else {
                "orthogonalEdgeStyle"
            },
            s.stroke,
            s.width,
            e.arrow,
        );
        if e.both {
            style.push_str("startArrow=block;startFill=1;");
        }
        if s.dashed {
            style.push_str("dashed=1;dashPattern=6 4;");
        }
        if e.curved {
            style.push_str("curved=1;");
        }
        for (key, side) in [("exit", e.exit), ("entry", e.entry)] {
            let Some(side) = side else { continue };
            let Some((px, py)) = port(side) else {
                return Err(format!(
                    "edge {}->{}: {key} {} must be one of ['bottom', 'left', 'right', 'top']",
                    e.source,
                    e.target,
                    repr_str(side)
                ));
            };
            style.push_str(&format!("{key}X={px};{key}Y={py};{key}Dx=0;{key}Dy=0;"));
        }
        style.push_str("drawgenRole=edge;");
        let value = if e.label.is_empty() {
            String::new()
        } else {
            label_html(e.label)
        };
        self.add_edge(&id, e.source, e.target, &style, &e.points, &value)?;
        if !self.edge_styles_used.iter().any(|used| used == e.style) {
            self.edge_styles_used.push(e.style.to_string());
        }
        Ok(())
    }

    /// Free text. `size` is written into the style as given.
    #[allow(clippy::too_many_arguments)]
    pub fn text(
        &mut self,
        id: &str,
        label: &str,
        geometry: (f64, f64, f64, f64),
        size: &str,
        bold: bool,
        colour: &str,
        align: &str,
    ) -> Result<(), String> {
        let style = format!(
            "text;html=1;fontFamily={FONT};fontSize={size};fontStyle={};\
             fontColor={colour};align={align};verticalAlign=middle;whiteSpace=wrap;drawgenRole=text;",
            if bold { 1 } else { 0 }
        );
        self.add_vertex(id, &label_html(label), &style, geometry, "1", "text")
    }

    /// A legend box. With no lists it shows the kinds and edge styles that the
    /// page used.
    pub fn legend(
        &mut self,
        x: f64,
        y: f64,
        kinds: Option<Vec<String>>,
        edges: Option<Vec<String>>,
    ) -> Result<(), String> {
        let id = "legend";
        let kinds = kinds.unwrap_or_else(|| self.kinds_used.clone());
        let edges = edges.unwrap_or_else(|| self.edge_styles_used.clone());
        let h = 36.0 + (kinds.len() + edges.len()) as f64 * 24.0;
        self.add_vertex(
            id,
            "<b>Legend</b>",
            &format!(
                "rounded=1;arcSize=6;html=1;fillColor=#FFFFFF;strokeColor=#D1D5DB;fontFamily={FONT};\
                 fontSize=11;align=left;verticalAlign=top;spacingLeft=10;spacingTop=6;drawgenRole=legend-box;"
            ),
            (x, y, 200.0, h),
            "1",
            "legend-box",
        )?;
        let mut cy = y + 30.0;
        let text_style = format!(
            "text;html=1;fontFamily={FONT};fontSize=10;fontColor=#4B5563;align=left;\
             verticalAlign=middle;drawgenRole=legend;"
        );
        for name in &kinds {
            let Some(k) = theme::find_kind(name) else {
                return Err(format!(
                    "legend.kinds: {} is not one of {}",
                    repr_str(name),
                    repr_names(&theme::kind_names())
                ));
            };
            self.add_vertex(
                &format!("{id}_k_{name}"),
                "",
                &format!(
                    "rounded=1;arcSize=20;fillColor={};strokeColor={};{}drawgenRole=legend;",
                    k.fill,
                    k.stroke,
                    if k.dashed { "dashed=1;" } else { "" }
                ),
                (x + 10.0, cy + 3.0, 26.0, 16.0),
                "1",
                "legend",
            )?;
            self.add_vertex(
                &format!("{id}_kt_{name}"),
                &label_html(k.label),
                &text_style,
                (x + 44.0, cy, 150.0, 22.0),
                "1",
                "legend",
            )?;
            cy += 24.0;
        }
        for name in &edges {
            let Some(s) = theme::find_edge_style(name) else {
                return Err(format!(
                    "legend.edges: {} is not one of {}",
                    repr_str(name),
                    repr_names(&theme::edge_style_names())
                ));
            };
            // A short line that joins no cells, drawn as the swatch.
            let cell_id = format!("{id}_e_{name}");
            self.claim(&cell_id)?;
            let style = format!(
                "endArrow=block;endFill=1;html=1;strokeColor={};strokeWidth={};{}drawgenRole=legend;",
                s.stroke,
                s.width,
                if s.dashed {
                    "dashed=1;dashPattern=6 4;"
                } else {
                    ""
                }
            );
            let (from, to) = ((x + 10.0, cy + 11.0), (x + 36.0, cy + 11.0));
            let xml = format!(
                "<mxCell id=\"{}\" value=\"\" style=\"{}\" edge=\"1\" parent=\"1\">\
                 <mxGeometry relative=\"1\" as=\"geometry\"><mxPoint x=\"{}\" y=\"{}\" as=\"sourcePoint\"/>\
                 <mxPoint x=\"{}\" y=\"{}\" as=\"targetPoint\"/></mxGeometry></mxCell>",
                attr(&cell_id),
                style,
                num(from.0),
                num(from.1),
                num(to.0),
                num(to.1),
            );
            self.cells.push(Cell {
                id: cell_id,
                parent: "1".to_string(),
                value: String::new(),
                style,
                shape: Shape::Edge {
                    source: None,
                    target: None,
                    points: Vec::new(),
                    ends: Some((
                        (round_trip(from.0), round_trip(from.1)),
                        (round_trip(to.0), round_trip(to.1)),
                    )),
                },
                xml,
            });
            self.add_vertex(
                &format!("{id}_et_{name}"),
                &label_html(s.label),
                &text_style,
                (x + 44.0, cy, 150.0, 22.0),
                "1",
                "legend",
            )?;
            cy += 24.0;
        }
        Ok(())
    }

    // --------------------------------------------------------------- layout

    /// `(left, top, right, bottom)` of every top-level shape except the title.
    fn content_bounds(&self) -> (f64, f64, f64, f64) {
        let boxes: Vec<&PlacedBox> = self
            .boxes
            .values()
            .filter(|b| b.parent == "1" && b.role != "title")
            .collect();
        if boxes.is_empty() {
            return (0.0, 0.0, 0.0, 0.0);
        }
        let fold = |f: fn(f64, f64) -> f64, get: fn(&PlacedBox) -> f64| {
            boxes.iter().map(|b| get(b)).reduce(f).unwrap_or(0.0)
        };
        (
            fold(f64::min, |b| b.x),
            fold(f64::min, |b| b.y),
            fold(f64::max, |b| b.x + b.w),
            fold(f64::max, |b| b.y + b.h),
        )
    }

    /// Sizes the page to its content, so nothing is off the page and there is
    /// no empty space around it.
    pub fn fit_page(&mut self) {
        let margin = 40.0;
        let (_, _, right, bottom) = self.content_bounds();
        self.width = (right + margin).max(480.0) as i64;
        self.height = (bottom + margin).max(240.0) as i64;
        let new_width = (self.width - 60) as f64;
        let old = format!("width=\"{}\"", num(self.title_width));
        let new = format!("width=\"{}\"", num(new_width));
        for cell in &mut self.cells {
            if cell.id == "title" || cell.id == "subtitle" {
                cell.xml = cell.xml.replacen(&old, &new, 1);
                if let Shape::Vertex { w, .. } = &mut cell.shape {
                    *w = round_trip(new_width);
                }
            }
        }
        for id in ["title", "subtitle"] {
            if let Some(b) = self.boxes.get_mut(id) {
                b.w = new_width;
            }
        }
        self.title_width = new_width;
    }

    /// Where a legend fits without covering anything: right of the content, at
    /// its top.
    pub fn legend_slot(&self) -> (f64, f64) {
        let (_, top, right, _) = self.content_bounds();
        (right + 40.0, if right != 0.0 { top } else { 100.0 })
    }

    fn in_zone(
        &self,
        zone: Option<&str>,
        x: f64,
        y: f64,
        id: &str,
    ) -> Result<(String, f64, f64), String> {
        let Some(zone) = zone.filter(|z| !z.is_empty()) else {
            return Ok(("1".to_string(), x, y));
        };
        match self.boxes.get(zone) {
            Some(z) if z.role == "zone" => Ok((zone.to_string(), x - z.x, y - z.y)),
            _ => Err(format!(
                "{}: zone {} does not exist (add the zone first)",
                repr_str(id),
                repr_str(zone)
            )),
        }
    }

    // --------------------------------------------------------------- output

    fn diagram_xml(&self) -> String {
        let cells: String = self.cells.iter().map(|c| c.xml.as_str()).collect();
        format!(
            "<diagram id=\"{}\" name=\"{}\">\
             <mxGraphModel dx=\"{w}\" dy=\"{h}\" grid=\"1\" gridSize=\"10\" guides=\"1\" \
             tooltips=\"1\" connect=\"1\" arrows=\"1\" fold=\"1\" page=\"1\" pageScale=\"1\" \
             pageWidth=\"{w}\" pageHeight=\"{h}\" background=\"#FFFFFF\" math=\"0\" shadow=\"0\">\
             <root><mxCell id=\"0\"/><mxCell id=\"1\" parent=\"0\"/>{cells}</root></mxGraphModel></diagram>",
            attr(&self.page_id),
            attr(&self.name),
            w = self.width,
            h = self.height,
        )
    }
}

/// A `.drawio` file: one or more pages, in tab order.
pub struct Document {
    pub pages: Vec<Diagram>,
}

impl Document {
    /// The whole file as XML.
    pub fn xml(&self) -> Result<String, String> {
        let mut seen = HashSet::new();
        if !self.pages.iter().all(|p| seen.insert(p.page_id.as_str())) {
            let ids: Vec<&str> = self.pages.iter().map(|p| p.page_id.as_str()).collect();
            return Err(format!("page ids must be unique: {}", repr_names(&ids)));
        }
        let pages: String = self.pages.iter().map(Diagram::diagram_xml).collect();
        let doc = format!("<mxfile host=\"drawgen\" type=\"device\">{pages}</mxfile>\n");
        if !is_valid_xml_text(&doc) {
            return Err(
                "the diagram contains a control character that XML does not allow; remove it from the labels"
                    .to_string(),
            );
        }
        Ok(doc)
    }
}
