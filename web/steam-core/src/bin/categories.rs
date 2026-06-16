//! Smoke test for the library-category reader (sharedconfig.vdf, read-only).
//!
//! `cargo run --bin categories` — prints the user's Steam library categories per
//! app and the unique category list. Reads files only; never writes to Steam.

use steam_core::read_categories;

fn main() {
    let cats = read_categories();
    eprintln!("{} apps tagged", cats.len());
    for (id, c) in cats.iter().take(15) {
        println!("{id}: {}", c.join(", "));
    }
    let mut all: Vec<String> = cats.iter().flat_map(|(_, c)| c.clone()).collect();
    all.sort();
    all.dedup();
    eprintln!("{} categories: {}", all.len(), all.join(" | "));
}
