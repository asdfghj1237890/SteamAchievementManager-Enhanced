use std::collections::HashMap;
use std::process::Command;
use steam_core::{AchChange, OwnedGame, StatChange};

// ---------- list owned games (read-only, in-process) ----------
#[tauri::command]
async fn list_games(app_ids: Vec<u32>) -> Result<Vec<OwnedGame>, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<Vec<OwnedGame>, String> {
        // Full library from the SAM master list (games.xml); fall back to the
        // bundled candidate ids if that download fails.
        match steam_core::list_owned() {
            Ok(games) => Ok(games),
            Err(_) => {
                let client = steam_core::SteamClient::connect()?;
                Ok(client.owned_games(&app_ids))
            }
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

// ---------- per-game read/write via a self-spawned worker process ----------
fn run_self_worker(args: &[&str]) -> Result<String, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let mut cmd = Command::new(exe);
    cmd.arg("--steam-worker");
    cmd.args(args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW — no console flash
    }
    let out = cmd.output().map_err(|e| format!("無法啟動 worker：{e}"))?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    } else {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        Err(if err.is_empty() { "worker 失敗".into() } else { err })
    }
}

#[tauri::command]
async fn load_game(app_id: String) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<serde_json::Value, String> {
        let json = run_self_worker(&["read", app_id.as_str()])?;
        serde_json::from_str(&json).map_err(|e| format!("解析 worker 輸出失敗：{e}"))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(serde::Deserialize)]
struct GameChanges {
    #[serde(default)]
    achievements: HashMap<String, bool>,
    #[serde(default)]
    stats: HashMap<String, f64>,
}

#[derive(serde::Deserialize, Default)]
struct WritePayload {
    #[serde(default)]
    achievements: Vec<AchChange>,
    #[serde(default)]
    stats: Vec<StatChange>,
}

#[tauri::command]
async fn save_changes(app_id: String, changes: GameChanges) -> Result<serde_json::Value, String> {
    let ach: Vec<AchChange> = changes
        .achievements
        .into_iter()
        .map(|(id, unlock)| AchChange { id, unlock })
        .collect();
    let stats: Vec<StatChange> = changes
        .stats
        .into_iter()
        .map(|(id, value)| StatChange { id, value })
        .collect();
    tauri::async_runtime::spawn_blocking(move || -> Result<serde_json::Value, String> {
        let payload = serde_json::json!({ "achievements": ach, "stats": stats }).to_string();
        let json = run_self_worker(&["write", app_id.as_str(), payload.as_str()])?;
        serde_json::from_str(&json).map_err(|e| format!("解析失敗：{e}"))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(serde::Serialize, serde::Deserialize)]
struct Progress {
    earned: u32,
    total: u32,
}

/// Light achievement completion for one game (used to fill the list bars).
///
/// Reads Steam's local cache files directly — it opens NO Steam interface and
/// sets NO SteamAppId, so (unlike a per-game worker) it never makes Steam think
/// the game is running and never triggers a cloud sync. This is SAM's approach:
/// completion comes from the on-disk stats cache, not from launching the game.
/// Games with no local cache return an error, so the list shows "—" for them.
#[tauri::command]
async fn game_progress(app_id: String) -> Result<Progress, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<Progress, String> {
        let id: u32 = app_id.parse().map_err(|_| "無效的 appId".to_string())?;
        match steam_core::completion_local(id) {
            Some((earned, total)) => Ok(Progress { earned, total }),
            None => Err("本機沒有此遊戲的成就快取".into()),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(serde::Serialize)]
struct AppCategories {
    app_id: u32,
    categories: Vec<String>,
}

/// The user's Steam library categories per owned app, read from sharedconfig.vdf
/// (read-only, in-process — no Steam connection).
#[tauri::command]
async fn game_categories() -> Result<Vec<AppCategories>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        steam_core::read_categories()
            .into_iter()
            .map(|(app_id, categories)| AppCategories { app_id, categories })
            .collect()
    })
    .await
    .map_err(|e| e.to_string())
}

/// Resolve a game's real header-image URL via the Steam appdetails API (for newer
/// games whose art lives at unguessable content-hash paths). Network read-only.
#[tauri::command]
async fn game_header(app_id: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        let id: u32 = app_id.parse().map_err(|_| "無效的 appId".to_string())?;
        steam_core::fetch_header_url(id).ok_or_else(|| "找不到封面".to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

// ---------- in-app update check (read-only) ----------
const LATEST_JSON_URL: &str =
    "https://raw.githubusercontent.com/asdfghj1237890/SteamAchievementManager-Enhanced/master/latest.json";

/// Fetch the latest published version string from the hosted latest.json.
#[tauri::command]
async fn latest_version() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| -> Result<String, String> {
        let body = ureq::get(LATEST_JSON_URL)
            .timeout(std::time::Duration::from_secs(10))
            .call()
            .map_err(|e| e.to_string())?
            .into_string()
            .map_err(|e| e.to_string())?;
        let v: serde_json::Value = serde_json::from_str(&body).map_err(|e| e.to_string())?;
        v.get("version")
            .and_then(|x| x.as_str())
            .map(|s| s.to_string())
            .ok_or_else(|| "latest.json missing 'version'".to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// GitHub Releases page (latest) — where update downloads live.
const RELEASES_URL: &str =
    "https://github.com/asdfghj1237890/SteamAchievementManager-Enhanced/releases/latest";

/// Open the GitHub Releases page in the user's default browser. The URL is fixed
/// here — there is no renderer-supplied input — so there is no shell-injection
/// surface. The Windows path uses rundll32 (no `cmd.exe`, no metacharacter parsing).
#[tauri::command]
async fn open_releases() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| -> Result<(), String> {
        #[cfg(target_os = "macos")]
        {
            std::process::Command::new("open")
                .arg(RELEASES_URL)
                .spawn()
                .map(|_| ())
                .map_err(|e| e.to_string())
        }
        #[cfg(target_os = "windows")]
        {
            std::process::Command::new("rundll32")
                .args(["url.dll,FileProtocolHandler", RELEASES_URL])
                .spawn()
                .map(|_| ())
                .map_err(|e| e.to_string())
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            Err("unsupported platform".into())
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

// ---------- worker entrypoint (called from main when `--steam-worker`) ----------
pub fn worker_main(args: &[String]) {
    match run_worker(args) {
        Ok(json) => {
            println!("{json}");
            std::process::exit(0);
        }
        Err(e) => {
            eprintln!("{e}");
            std::process::exit(1);
        }
    }
}

fn run_worker(args: &[String]) -> Result<String, String> {
    let mode = args.first().map(String::as_str).unwrap_or("");
    let app_id: u32 = args
        .get(1)
        .and_then(|s| s.parse().ok())
        .ok_or("worker：缺少有效的 appId")?;
    match mode {
        "read" => {
            let game = steam_core::read_game(app_id)?;
            serde_json::to_string(&game).map_err(|e| e.to_string())
        }
        "write" => {
            let payload = args.get(2).map(String::as_str).unwrap_or("{}");
            let w: WritePayload = serde_json::from_str(payload).map_err(|e| e.to_string())?;
            let saved = steam_core::write_game(app_id, &w.achievements, &w.stats)?;
            Ok(format!("{{\"saved\":{saved}}}"))
        }
        // Note: there is intentionally no "count" mode. Completion is read from the
        // local stats cache in-process (see game_progress / steam_core::completion_local)
        // so the list never launches a game just to fill its progress bar.
        other => Err(format!("worker：未知模式 {other}")),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_games,
            load_game,
            save_changes,
            game_progress,
            game_categories,
            game_header,
            latest_version,
            open_releases
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
