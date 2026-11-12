//! The visual theme: component kinds, zone tints, and edge styles.
//!
//! Colour encodes the type of a component, never its meaning. The label carries
//! the meaning. That is why a spec picks a kind and never a colour.

pub const FONT: &str = "Helvetica";

/// Three type sizes only: title, node, and edge or annotation.
pub const TITLE_SIZE: u32 = 20;
pub const NODE_SIZE: u32 = 12;
pub const EDGE_SIZE: u32 = 10;

/// Default node size: wide enough for a two-word label plus a sub-line.
pub const NODE_W: f64 = 170.0;
pub const NODE_H: f64 = 64.0;

pub struct Kind {
    pub name: &'static str,
    pub fill: &'static str,
    pub stroke: &'static str,
    pub font: &'static str,
    pub shape: &'static str,
    pub dashed: bool,
    pub label: &'static str,
}

const fn kind(
    name: &'static str,
    fill: &'static str,
    stroke: &'static str,
    font: &'static str,
    shape: &'static str,
    label: &'static str,
) -> Kind {
    Kind {
        name,
        fill,
        stroke,
        font,
        shape,
        dashed: false,
        label,
    }
}

/// Muted, print-safe colours that read in light and dark viewers.
pub const KINDS: [Kind; 14] = [
    kind(
        "actor",
        "#E8EEF9",
        "#3B5BA9",
        "#1F2A44",
        "actor",
        "Person / role",
    ),
    Kind {
        dashed: true,
        ..kind(
            "external",
            "#F3F4F6",
            "#6B7280",
            "#1F2937",
            "box",
            "External system",
        )
    },
    kind("service", "#E6F4EA", "#2E7D4F", "#14361F", "box", "Service"),
    kind("ai", "#F3E8FD", "#7B3FBF", "#2E1252", "box", "AI component"),
    kind(
        "worker",
        "#FFF4E0",
        "#C27C0E",
        "#4A2F05",
        "box",
        "Background worker",
    ),
    kind(
        "datastore",
        "#E3F2FD",
        "#1E6FB8",
        "#0B2A47",
        "cylinder",
        "Data store",
    ),
    kind(
        "queue",
        "#FDECEC",
        "#B23A3A",
        "#4A1414",
        "queue",
        "Queue / stream",
    ),
    kind(
        "ui",
        "#E0F7F6",
        "#0F8A84",
        "#073B38",
        "box",
        "User interface",
    ),
    kind(
        "gov",
        "#FFF8E1",
        "#8D6E00",
        "#3D3000",
        "box",
        "Government source",
    ),
    kind(
        "security",
        "#FDF2F8",
        "#A23B72",
        "#4A1030",
        "box",
        "Security control",
    ),
    kind(
        "decision", "#FFFFFF", "#374151", "#111827", "rhombus", "Decision",
    ),
    kind(
        "step",
        "#FFFFFF",
        "#374151",
        "#111827",
        "box",
        "Process step",
    ),
    kind(
        "terminal",
        "#1F2937",
        "#1F2937",
        "#FFFFFF",
        "pill",
        "Start / end",
    ),
    kind("note", "#FFFBEB", "#D4B106", "#3D3000", "note", "Note"),
];

/// Zone colour name, fill, and stroke.
pub const ZONE_COLOURS: [(&str, &str, &str); 7] = [
    ("blue", "#F5F8FE", "#9DB4E3"),
    ("green", "#F4FAF6", "#9CCBAE"),
    ("purple", "#FAF5FE", "#C9A8EC"),
    ("amber", "#FFFBF2", "#E6C27A"),
    ("grey", "#F9FAFB", "#C4C9D1"),
    ("red", "#FEF7F7", "#E5A3A3"),
    ("teal", "#F2FBFA", "#8FD1CC"),
];

pub struct EdgeStyle {
    pub name: &'static str,
    pub stroke: &'static str,
    pub dashed: bool,
    /// Written into the style string as text, so that "1.0" stays "1.0".
    pub width: &'static str,
    pub label: &'static str,
}

pub const EDGE_STYLES: [EdgeStyle; 5] = [
    EdgeStyle {
        name: "sync",
        stroke: "#374151",
        dashed: false,
        width: "1.5",
        label: "Synchronous call",
    },
    EdgeStyle {
        name: "async",
        stroke: "#B23A3A",
        dashed: true,
        width: "1.5",
        label: "Async / event",
    },
    EdgeStyle {
        name: "data",
        stroke: "#1E6FB8",
        dashed: false,
        width: "1.5",
        label: "Data flow",
    },
    EdgeStyle {
        name: "ai",
        stroke: "#7B3FBF",
        dashed: false,
        width: "1.5",
        label: "Model call",
    },
    EdgeStyle {
        name: "weak",
        stroke: "#9CA3AF",
        dashed: true,
        width: "1.0",
        label: "Optional / manual",
    },
];

pub fn find_kind(name: &str) -> Option<&'static Kind> {
    KINDS.iter().find(|k| k.name == name)
}

pub fn find_zone_colour(name: &str) -> Option<(&'static str, &'static str)> {
    ZONE_COLOURS
        .iter()
        .find(|c| c.0 == name)
        .map(|c| (c.1, c.2))
}

pub fn find_edge_style(name: &str) -> Option<&'static EdgeStyle> {
    EDGE_STYLES.iter().find(|s| s.name == name)
}

fn sorted(mut names: Vec<&'static str>) -> Vec<&'static str> {
    names.sort_unstable();
    names
}

/// The names, sorted, for error messages that list what a spec may use.
pub fn kind_names() -> Vec<&'static str> {
    sorted(KINDS.iter().map(|k| k.name).collect())
}

pub fn zone_colour_names() -> Vec<&'static str> {
    sorted(ZONE_COLOURS.iter().map(|c| c.0).collect())
}

pub fn edge_style_names() -> Vec<&'static str> {
    sorted(EDGE_STYLES.iter().map(|s| s.name).collect())
}
