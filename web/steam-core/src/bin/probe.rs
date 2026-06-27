//! Read-only ownership probe. NEVER writes to Steam.
//!
//! Usage:
//!   cargo run --bin probe <appId> [appId...]   # check specific app ids (fast)
//!   cargo run --bin probe                        # full library scan via SAM list
fn main() {
    let ids: Vec<u32> = std::env::args()
        .skip(1)
        .filter_map(|a| a.parse().ok())
        .collect();

    if ids.is_empty() {
        // Full library scan (downloads the SAM master list, then ownership-checks each).
        match steam_core::list_owned() {
            Ok(games) => {
                println!("擁有 {} 款有成就資料的遊戲：", games.len());
                for g in games.iter().take(50) {
                    println!("  {:>8}  {}", g.app_id, g.name);
                }
                if games.len() > 50 {
                    println!("  …（其餘 {} 款省略）", games.len() - 50);
                }
            }
            Err(e) => {
                eprintln!("probe 失敗：{e}");
                std::process::exit(1);
            }
        }
        return;
    }

    let client = match steam_core::SteamClient::connect() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("連線失敗：{e}");
            std::process::exit(1);
        }
    };
    for id in ids {
        let owned = client.is_subscribed(id);
        let name = client.app_data(id, "name").unwrap_or_else(|| "?".into());
        println!("{:>8}  owned={}  {}", id, owned, name);
    }
}
