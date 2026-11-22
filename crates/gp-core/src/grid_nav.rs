// ↑ and ↓ through a presentation's slides as their tiles stand (Lars, 2026-11-07, as Finder's icons; the same in
// every shell since 2026-11-22): the shell measures where its tiles are, the core says which one is above or below.
use crate::args::*;
use serde_json::{json, Value};

/// Tiles whose tops are this close are on one row.
const ROW_SLACK: f64 = 4.0;

struct Tile { key: String, left: f64, top: f64, right: f64, bottom: f64 }

impl Tile {
    fn centre(&self) -> f64 { (self.left + self.right) / 2.0 }
}

fn num(o: &Obj, k: &str) -> R<f64> { o.get(k).and_then(Value::as_f64).ok_or_else(|| "invalid-args".to_string()) }

fn tiles(a: &Obj) -> R<Vec<Tile>> {
    let list = a.get("tiles").and_then(Value::as_array).ok_or("invalid-args")?;
    list.iter().map(|t| {
        let t = obj(t)?;
        let key = t.get("key").and_then(Value::as_str).ok_or("invalid-args")?.to_string();
        Ok(Tile { key, left: num(t, "left")?, top: num(t, "top")?, right: num(t, "right")?, bottom: num(t, "bottom")? })
    }).collect()
}

/// `slideAcrossView` {tiles: [{key, left, top, right, bottom}], from, dir}: the tile above (`dir` -1) or below (1)
/// `from`, as they stand: the nearest row that way, and in it the one most nearly under or over it (the first of two
/// as near); past the first or last row none. With nothing to start from (`from` null or not among them), the first
/// tile going down, the last going up. {key} or {key: null}.
pub fn view(a: &Obj) -> R<Value> {
    let tiles = tiles(a)?;
    let down = match a.get("dir").and_then(Value::as_i64) { Some(1) => true, Some(-1) => false, _ => return Err("invalid-args".into()) };
    let from = a.get("from").and_then(Value::as_str);
    let Some(start) = tiles.iter().find(|t| Some(t.key.as_str()) == from) else {
        let key = if down { tiles.first() } else { tiles.last() };
        return Ok(json!({ "key": key.map(|t| t.key.clone()) }));
    };
    let ahead: Vec<&Tile> = tiles.iter()
        .filter(|t| if down { t.top >= start.bottom - ROW_SLACK } else { t.bottom <= start.top + ROW_SLACK })
        .collect();
    let tops = ahead.iter().map(|t| t.top);
    let Some(row_top) = (if down { tops.reduce(f64::min) } else { tops.reduce(f64::max) }) else { return Ok(json!({ "key": null })) };
    let best = ahead.into_iter()
        .filter(|t| (t.top - row_top).abs() <= ROW_SLACK)
        .reduce(|best, t| if (t.centre() - start.centre()).abs() < (best.centre() - start.centre()).abs() { t } else { best });
    Ok(json!({ "key": best.map(|t| t.key.clone()) }))
}

/// A slide's tile at its widest, and the least it shrinks to where that fits one more to a row (SlideGrid.razor's
/// scale; the web's SlideGrid.tsx FIT).
const TILE: f64 = 384.0;
const TILE_MIN: f64 = 340.0;

/// `slideGridView` {width, spacing, columns?}: the slides' grid in a column `width` wide with `spacing` between the
/// tiles: {columns, tileWidth, tileHeight}: as many to a row as fit at no less than 340 each (at least one), each at
/// most 384, sharing the row's width; the height the stage's shape (1920 × 1080), so a tile is never wider than a
/// slide. `columns` given keeps that many to a row (a shell that lays the rows out again only once a resize stops).
pub fn grid(a: &Obj) -> R<Value> {
    let num = |k: &str| a.get(k).and_then(Value::as_f64).ok_or_else(|| "invalid-args".to_string());
    let (width, spacing) = (num("width")?.max(1.0), num("spacing")?.max(0.0));
    let fits = (((width + spacing) / (TILE_MIN + spacing)).floor() as i64).max(1);
    let columns = a.get("columns").and_then(Value::as_i64).map_or(fits, |c| c.max(1));
    let tile = TILE.min(((width - spacing * (columns - 1) as f64) / columns as f64).floor()).max(1.0);
    Ok(json!({ "columns": columns, "tileWidth": tile, "tileHeight": (tile * 1080.0 / 1920.0).round() }))
}

#[cfg(test)]
#[path = "grid_nav_tests.rs"]
mod tests;
