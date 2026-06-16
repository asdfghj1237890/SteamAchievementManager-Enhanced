//! Read-only per-game achievement/stat dump. NEVER writes to Steam.
//!
//! Usage: cargo run --bin read-game <appId>
fn main() {
    let app_id: u32 = match std::env::args().nth(1).and_then(|s| s.parse().ok()) {
        Some(id) => id,
        None => {
            eprintln!("用法：read-game <appId>");
            std::process::exit(2);
        }
    };
    match steam_core::read_game(app_id) {
        Ok(g) => {
            let unlocked = g.achievements.iter().filter(|a| a.unlocked).count();
            println!("{} — {}", g.app_id, g.name);
            println!("成就：{} 個（已解鎖 {}）", g.achievements.len(), unlocked);
            for a in g.achievements.iter().take(20) {
                println!("  [{}] {}", if a.unlocked { "x" } else { " " }, a.name);
            }
            if g.achievements.len() > 20 {
                println!("  …（其餘 {} 個省略）", g.achievements.len() - 20);
            }
            println!("統計：{} 項", g.stats.len());
        }
        Err(e) => {
            eprintln!("read-game 失敗：{e}");
            std::process::exit(1);
        }
    }
}
