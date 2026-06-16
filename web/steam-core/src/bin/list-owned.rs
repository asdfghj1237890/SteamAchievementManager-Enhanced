//! Read-only full-library scan timing: `cargo run --bin list-owned`.
//! Fetches the SAM master list and checks ownership of every app — never writes.

use steam_core::list_owned;

fn main() {
    let start = std::time::Instant::now();
    match list_owned() {
        Ok(games) => {
            eprintln!(
                "掃描完成：擁有 {} 款（總耗時 {:.1}s）",
                games.len(),
                start.elapsed().as_secs_f64()
            );
            for g in games.iter().take(25) {
                println!("{:>8}  [{}]  {}", g.app_id, g.kind, g.name);
            }
            if games.len() > 25 {
                println!("... 還有 {} 款", games.len() - 25);
            }
        }
        Err(e) => {
            eprintln!("失敗：{e}");
            std::process::exit(1);
        }
    }
}
