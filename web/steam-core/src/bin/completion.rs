//! Smoke test for the file-only completion path (no Steam connection, no launch).
//!
//! `cargo run --bin completion <appid>` — reads Steam's local cache files
//! (UserGameStatsSchema_<appid>.bin + UserGameStats_<account>_<appid>.bin) and
//! prints (earned, total). It opens no Steam interfaces and launches no game, so
//! it is safe to run against a real account and never triggers a cloud sync.

use steam_core::completion_local;

fn main() {
    let app_id: u32 = std::env::args()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    if app_id == 0 {
        eprintln!("usage: completion <appid>");
        std::process::exit(2);
    }
    match completion_local(app_id) {
        Some((earned, total)) => {
            let pct = earned
                .checked_mul(100)
                .and_then(|value| value.checked_div(total))
                .unwrap_or(0);
            println!("{{\"earned\":{earned},\"total\":{total}}}");
            eprintln!("{app_id} — {earned}/{total}（{pct}%），純讀檔、未啟動遊戲");
        }
        None => {
            eprintln!("{app_id} — 本機沒有快取資料（尚未執行過此遊戲）");
            std::process::exit(1);
        }
    }
}
