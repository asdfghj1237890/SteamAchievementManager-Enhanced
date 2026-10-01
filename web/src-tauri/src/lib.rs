use std::collections::{HashMap, HashSet};
use std::io::{Read, Write};
use std::process::Command;
use std::time::Duration;
use steam_core::{AchChange, GameProgress, OwnedGame, StatChange};
use tauri::Manager;

#[cfg(target_os = "macos")]
mod macos_chrome;

const WORKER_TIMEOUT_SECS: u64 = 45;

// Upper bound on the candidate app-id list the renderer may pass to `list_games`.
// The real fallback list is tiny (see web/src/data/steamAppIds.ts); this only caps a
// compromised webview from forcing millions of serial ownership FFI calls.
const MAX_CANDIDATE_APP_IDS: usize = 65_536;

// Upper bounds on one `save_changes` request, checked before a write worker is spawned.
// Both sit far above any real game (Steam itself caps an achievement/stat API name at
// 128 bytes — k_cchStatNameMax); they only stop a compromised webview from piping an
// arbitrarily large payload into a worker that then walks it against Steam.
const MAX_SAVE_ENTRIES: usize = 50_000;
const MAX_SAVE_ID_BYTES: usize = 256;

// Held around every write worker so two saves never talk to Steam at the same time.
static WRITE_WORKER_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Locks `mutex`, recovering the guard if an earlier holder panicked. The write lock
/// guards no data (it only orders workers), so a poisoned lock is still safe to take.
fn lock_ignoring_poison<T>(mutex: &std::sync::Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// Parses a renderer-supplied app id: a non-zero `u32`, anything else is rejected. The
/// host validates it before spawning (and passes the parsed number on in canonical
/// decimal form) instead of forwarding the raw string to the worker's argv.
fn parse_app_id(raw: &str) -> Result<u32, String> {
    match raw.parse::<u32>() {
        Ok(id) if id != 0 => Ok(id),
        _ => Err("無效的 appId".to_string()),
    }
}

/// Rejects a save whose change set exceeds `MAX_SAVE_ENTRIES` in total or contains an
/// id longer than `MAX_SAVE_ID_BYTES`. Pure, so it is unit-testable without a worker.
fn check_change_limits(changes: &GameChanges) -> Result<(), String> {
    let total = changes.achievements.len() + changes.stats.len();
    if total > MAX_SAVE_ENTRIES {
        return Err(format!("變更數量超過 {MAX_SAVE_ENTRIES} 筆上限"));
    }
    let too_long = |id: &String| id.len() > MAX_SAVE_ID_BYTES;
    if changes.achievements.keys().any(too_long) || changes.stats.keys().any(too_long) {
        return Err(format!("成就或統計 ID 超過 {MAX_SAVE_ID_BYTES} 位元組上限"));
    }
    Ok(())
}

// Set by Steam on everything it launches (e.g. this app added as a non-Steam shortcut)
// and inherited by child processes. The worker sets its own SteamAppId, so these are
// dropped to give it the same environment as a normal launch.
const STEAM_LAUNCH_ENV: [&str; 2] = ["SteamGameId", "SteamOverlayGameId"];

fn clear_steam_launch_env(cmd: &mut Command) {
    for key in STEAM_LAUNCH_ENV {
        cmd.env_remove(key);
    }
}

fn join_pipe_reader(
    reader: Option<std::thread::JoinHandle<Result<Vec<u8>, String>>>,
) -> Result<Vec<u8>, String> {
    match reader {
        Some(reader) => reader
            .join()
            .map_err(|_| "worker output reader panic".to_string())?,
        None => Ok(Vec::new()),
    }
}

// ---------- list owned games (read-only, in-process) ----------
#[tauri::command]
async fn list_games(app_ids: Vec<u32>) -> Result<Vec<OwnedGame>, String> {
    if app_ids.len() > MAX_CANDIDATE_APP_IDS {
        return Err("app_ids 數量超過上限".to_string());
    }
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
/// The command that re-runs `exe` (this app) as a `--steam-worker` for `args`.
fn self_worker_command(exe: &std::path::Path, args: &[&str]) -> Command {
    let mut cmd = Command::new(exe);
    cmd.arg("--steam-worker");
    cmd.args(args);
    clear_steam_launch_env(&mut cmd);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW — no console flash
    }
    cmd
}

fn run_self_worker(args: &[&str], stdin_data: Option<&str>) -> Result<String, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    run_worker_command(
        self_worker_command(&exe, args),
        stdin_data.map(str::to_owned),
        Duration::from_secs(WORKER_TIMEOUT_SECS),
    )
}

/// Runs `cmd` to completion, feeding it `stdin_data`, and returns its trimmed stdout —
/// or, when it exits non-zero, its stderr as the error. A worker that has not finished
/// within `timeout` is killed.
fn run_worker_command(
    mut cmd: Command,
    stdin_data: Option<String>,
    timeout: Duration,
) -> Result<String, String> {
    // Large payloads (e.g. a bulk write) go over stdin, not argv, to stay clear of the
    // OS command-line length limit (~32 KB on Windows) for games with many achievements.
    cmd.stdin(if stdin_data.is_some() {
        std::process::Stdio::piped()
    } else {
        std::process::Stdio::null()
    });
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| format!("無法啟動 worker：{e}"))?;
    // The worker prints its JSON and exits, so "stdout reached EOF" is the completion
    // signal: the reader thread reports it over this channel and the caller blocks on
    // that (with the timeout cap) instead of polling try_wait on a 50 ms timer, which
    // added up to 50 ms of pure latency to every read and write.
    let (stdout_done, stdout_closed) = std::sync::mpsc::channel::<()>();
    let stdout_reader = child.stdout.take().map(|mut out| {
        std::thread::spawn(move || {
            let mut stdout = Vec::new();
            let read = out
                .read_to_end(&mut stdout)
                .map(|_| stdout)
                .map_err(|e| e.to_string());
            let _ = stdout_done.send(());
            read
        })
    });
    let stderr_reader = child.stderr.take().map(|mut err| {
        std::thread::spawn(move || {
            let mut stderr = Vec::new();
            err.read_to_end(&mut stderr)
                .map(|_| stderr)
                .map_err(|e| e.to_string())
        })
    });
    // Written from its own thread, like the two readers, so the write sits under the
    // timeout below: a worker that stalls before draining a payload larger than the
    // pipe buffer would otherwise block this call for good — and with it every later
    // save, since save_changes holds the write lock across it.
    let stdin_writer = match stdin_data {
        Some(data) => {
            let mut stdin = child.stdin.take().ok_or("worker stdin 無法取得")?;
            Some(std::thread::spawn(move || {
                // stdin is dropped when this returns → closes the pipe so the worker's
                // read sees EOF
                stdin.write_all(data.as_bytes()).map_err(|e| e.to_string())
            }))
        }
        None => None,
    };
    // Ok: the worker closed stdout (exited, or about to). Disconnected: there was no
    // reader thread. Either way wait() returns promptly below. Only a real timeout
    // kills the worker — which also closes its end of the three pipes, so the helper
    // threads (not joined on this path) end with it, the writer on a broken pipe.
    if let Err(std::sync::mpsc::RecvTimeoutError::Timeout) = stdout_closed.recv_timeout(timeout) {
        let _ = child.kill();
        let _ = child.wait();
        return Err(format!("worker 逾時（超過 {} 秒）", timeout.as_secs()));
    }
    let status = child.wait().map_err(|e| e.to_string())?;

    let stdout = join_pipe_reader(stdout_reader)?;
    let stderr = join_pipe_reader(stderr_reader)?;
    let stdin_written = match stdin_writer {
        Some(writer) => writer
            .join()
            .map_err(|_| "worker stdin writer panic".to_string())?,
        None => Ok(()),
    };

    if status.success() {
        // A worker only exits 0 after reading its whole payload; anything else fails.
        stdin_written?;
        Ok(String::from_utf8_lossy(&stdout).trim().to_string())
    } else {
        // The worker's own message says why it stopped. If it left before draining
        // stdin the write failed too, which is reported when the worker said nothing.
        let err = String::from_utf8_lossy(&stderr).trim().to_string();
        Err(if !err.is_empty() {
            err
        } else if let Err(write_error) = stdin_written {
            write_error
        } else {
            "worker 失敗".into()
        })
    }
}

#[tauri::command]
async fn load_game(app_id: String) -> Result<serde_json::Value, String> {
    let app_id = parse_app_id(&app_id)?.to_string();
    tauri::async_runtime::spawn_blocking(move || -> Result<serde_json::Value, String> {
        let json = run_self_worker(&["read", app_id.as_str()], None)?;
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

/// Maps the renderer's `{achievements, stats}` maps into the ordered
/// `AchChange`/`StatChange` lists the worker's `WritePayload` expects, and
/// serializes them to the JSON string sent over its stdin. Pure and sync so it's
/// unit-testable without spawning a worker process.
fn write_payload(changes: GameChanges) -> String {
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
    serde_json::json!({ "achievements": ach, "stats": stats }).to_string()
}

#[tauri::command]
async fn save_changes(app_id: String, changes: GameChanges) -> Result<serde_json::Value, String> {
    let app_id = parse_app_id(&app_id)?.to_string();
    check_change_limits(&changes)?;
    tauri::async_runtime::spawn_blocking(move || -> Result<serde_json::Value, String> {
        let payload = write_payload(changes);
        let json = {
            let _one_writer = lock_ignoring_poison(&WRITE_WORKER_LOCK);
            run_self_worker(&["write", app_id.as_str()], Some(payload.as_str()))?
        };
        serde_json::from_str(&json).map_err(|e| format!("解析失敗：{e}"))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Light achievement completion for the library (used to fill list bars).
///
/// Reads Steam's local cache files directly — it opens NO Steam interface and
/// sets NO SteamAppId, so (unlike a per-game worker) it never makes Steam think
/// the game is running and never triggers a cloud sync. This is SAM's approach:
/// completion comes from the on-disk stats cache, not from launching the game.
/// Games with no local cache are omitted, so the list shows "—" for them. A single
/// batch shares Steam root/account discovery across every app id.
#[tauri::command]
async fn game_progress_many(app_ids: Vec<u32>) -> Result<Vec<GameProgress>, String> {
    const MAX_APP_IDS: usize = 100_000;
    if app_ids.len() > MAX_APP_IDS {
        return Err(format!("appId 數量超過 {MAX_APP_IDS} 筆上限"));
    }
    tauri::async_runtime::spawn_blocking(move || {
        let mut seen = HashSet::with_capacity(app_ids.len());
        let unique: Vec<u32> = app_ids
            .into_iter()
            .filter(|id| *id != 0 && seen.insert(*id))
            .collect();
        steam_core::completion_local_many(&unique)
    })
    .await
    .map_err(|e| e.to_string())
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
/// The updater manifest attached to the latest GitHub Release (the same document the
/// updater plugin reads; see the `plugins.updater` endpoint in tauri.conf.json). The
/// manifest itself is NOT authenticated — only the packages it points at are
/// signature-checked, by the updater plugin — so what is read from it here is treated
/// as untrusted input. Only its `version` is read, so the check works for every
/// install — including the portable .exe, which cannot self-update.
const LATEST_JSON_URL: &str = "https://github.com/asdfghj1237890/SteamAchievementManager-Enhanced/releases/latest/download/latest.json";

// The real latest.json is about 1.5 KB (two package URLs and two signatures). The cap
// is applied twice: ureq's body `limit` counts the bytes taken off the wire — still
// compressed when the response is gzip-encoded — and `read_manifest_body` counts the
// decoded bytes, so a small compressed response cannot expand past it in memory.
const LATEST_JSON_MAX_BYTES: u64 = 64 * 1024;

/// Reads a latest.json body of at most `LATEST_JSON_MAX_BYTES` (decoded) bytes. A longer
/// one is an error, and no more than one byte past the cap is ever read from `reader`.
fn read_manifest_body(reader: impl Read) -> Result<String, String> {
    let mut body = Vec::new();
    reader
        .take(LATEST_JSON_MAX_BYTES + 1)
        .read_to_end(&mut body)
        .map_err(|e| e.to_string())?;
    if body.len() as u64 > LATEST_JSON_MAX_BYTES {
        return Err(format!(
            "latest.json is larger than {LATEST_JSON_MAX_BYTES} bytes"
        ));
    }
    String::from_utf8(body).map_err(|e| e.to_string())
}

// Three groups of up to ten digits plus the two dots.
const MAX_VERSION_LEN: usize = 32;

/// Whether `v` is a plain `x.y.z` version: exactly three dot-separated groups of ASCII
/// digits, at most `MAX_VERSION_LEN` bytes. Nothing else from the unauthenticated
/// manifest may reach the renderer, which compares the string and shows it in the
/// update banner.
fn is_plain_version(v: &str) -> bool {
    if v.len() > MAX_VERSION_LEN {
        return false;
    }
    let mut groups = 0;
    for group in v.split('.') {
        if group.is_empty() || !group.bytes().all(|b| b.is_ascii_digit()) {
            return false;
        }
        groups += 1;
    }
    groups == 3
}

/// Extracts the validated `version` from a latest.json body.
fn manifest_version(body: &str) -> Result<String, String> {
    let v: serde_json::Value = serde_json::from_str(body).map_err(|e| e.to_string())?;
    let version = v
        .get("version")
        .and_then(|x| x.as_str())
        .ok_or_else(|| "latest.json missing 'version'".to_string())?;
    if !is_plain_version(version) {
        return Err("latest.json 'version' is not a plain x.y.z version".to_string());
    }
    Ok(version.to_string())
}

/// Fetch the latest published version string from the hosted latest.json.
#[tauri::command]
async fn latest_version() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| -> Result<String, String> {
        let mut response = ureq::get(LATEST_JSON_URL)
            .config()
            .https_only(true)
            .timeout_global(Some(std::time::Duration::from_secs(10)))
            .build()
            .call()
            .map_err(|e| e.to_string())?;
        let body = read_manifest_body(
            response
                .body_mut()
                .with_config()
                .limit(LATEST_JSON_MAX_BYTES)
                .reader(),
        )?;
        manifest_version(&body)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// GitHub Releases page (latest) — where update downloads live.
const RELEASES_URL: &str =
    "https://github.com/asdfghj1237890/SteamAchievementManager-Enhanced/releases/latest";

/// Absolute path of the system's rundll32, from `%SystemRoot%` (falling back to
/// `C:\Windows` when the variable is missing or not an absolute path). A bare
/// "rundll32" is not used because std resolves a bare program name in the running
/// exe's own directory before System32, so a rundll32.exe planted beside the portable
/// exe would run instead.
#[cfg(windows)]
fn rundll32_path(system_root: Option<std::ffi::OsString>) -> std::path::PathBuf {
    system_root
        .map(std::path::PathBuf::from)
        .filter(|root| root.is_absolute())
        .unwrap_or_else(|| std::path::PathBuf::from(r"C:\Windows"))
        .join("System32")
        .join("rundll32.exe")
}

/// macOS `open`, by absolute path so nothing is resolved through PATH. Also built
/// under `cfg(test)` so every platform checks it; the macOS-only use alone would leave
/// it dead code on Windows.
#[cfg(any(target_os = "macos", test))]
const MACOS_OPEN_PROGRAM: &str = "/usr/bin/open";

/// Open the GitHub Releases page in the user's default browser. The URL is fixed
/// here — there is no renderer-supplied input — so there is no shell-injection
/// surface. The Windows path uses rundll32 (no `cmd.exe`, no metacharacter parsing).
/// Both helper programs are spawned by absolute path.
#[tauri::command]
async fn open_releases() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| -> Result<(), String> {
        #[cfg(target_os = "macos")]
        {
            std::process::Command::new(MACOS_OPEN_PROGRAM)
                .arg(RELEASES_URL)
                .spawn()
                .map(|_| ())
                .map_err(|e| e.to_string())
        }
        #[cfg(target_os = "windows")]
        {
            std::process::Command::new(rundll32_path(std::env::var_os("SystemRoot")))
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

/// Whether `dir` is an NSIS install (the installer leaves `uninstall.exe` beside the
/// app) rather than a portable copy. Also built under `cfg(test)` so every platform
/// runs its tests; the Windows-only use alone would leave it dead code on macOS.
#[cfg(any(windows, test))]
fn has_nsis_uninstaller(dir: &std::path::Path) -> bool {
    dir.join("uninstall.exe").is_file()
}

/// Whether this install can update itself in place through the updater plugin: an
/// NSIS install on Windows (the installer leaves `uninstall.exe` beside the app; a
/// portable copy has none) or the `.app` bundle on macOS. A portable .exe gets the
/// download link instead of an installer that would silently install a second copy.
#[tauri::command]
fn updater_supported() -> bool {
    #[cfg(windows)]
    {
        std::env::current_exe()
            .ok()
            .and_then(|exe| exe.parent().map(has_nsis_uninstaller))
            .unwrap_or(false)
    }
    #[cfg(target_os = "macos")]
    {
        true
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        false
    }
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
        .and_then(|s| parse_app_id(s).ok())
        .ok_or("worker：缺少有效的 appId")?;
    match mode {
        "read" => {
            let game = steam_core::read_game(app_id)?;
            serde_json::to_string(&game).map_err(|e| e.to_string())
        }
        "write" => {
            // The write payload arrives over stdin (not argv) so bulk saves can't hit
            // the OS command-line length limit. See run_self_worker.
            use std::io::Read;
            let mut payload = String::new();
            std::io::stdin()
                .read_to_string(&mut payload)
                .map_err(|e| e.to_string())?;
            let w: WritePayload = serde_json::from_str(&payload).map_err(|e| e.to_string())?;
            let result = steam_core::write_game(app_id, &w.achievements, &w.stats)?;
            serde_json::to_string(&result).map_err(|e| e.to_string())
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
        // In-app updates: the plugin fetches the manifest from the fixed endpoint in
        // tauri.conf.json. The manifest itself is unauthenticated; what is verified is
        // each package's minisign signature, against the public key compiled in there,
        // before installing. `process` is for the relaunch.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            // The main window is created hidden (`visible: false` in tauri.conf.json) and
            // the frontend reveals it after its first React commit (winShow), so nobody
            // sees WebView2's blank white page. Safety net: if the frontend never gets
            // there (script error, blocked asset), show the window anyway after a grace
            // period rather than leaving the app invisible.
            if let Some(win) = app.get_webview_window("main") {
                #[cfg(target_os = "macos")]
                macos_chrome::use_unified_toolbar(&win);
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_secs(3));
                    if !win.is_visible().unwrap_or(true) {
                        let _ = win.show();
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_games,
            load_game,
            save_changes,
            game_progress_many,
            game_categories,
            game_header,
            latest_version,
            open_releases,
            updater_supported
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::{
        check_change_limits, clear_steam_launch_env, has_nsis_uninstaller, is_plain_version,
        load_game, lock_ignoring_poison, manifest_version, parse_app_id, read_manifest_body,
        run_worker, run_worker_command, save_changes, self_worker_command, write_payload,
        GameChanges, WritePayload, LATEST_JSON_MAX_BYTES, MACOS_OPEN_PROGRAM, MAX_SAVE_ENTRIES,
        MAX_SAVE_ID_BYTES, MAX_VERSION_LEN,
    };
    use std::collections::HashMap;
    use std::time::Duration;

    #[test]
    fn worker_rejects_missing_or_invalid_app_id_without_connecting_to_steam() {
        assert_eq!(run_worker(&[]).unwrap_err(), "worker：缺少有效的 appId");
        assert_eq!(
            run_worker(&["read".into(), "not-a-number".into()]).unwrap_err(),
            "worker：缺少有效的 appId"
        );
        // App id 0 is refused before any mode runs, for the read and the write path.
        for mode in ["read", "write"] {
            assert_eq!(
                run_worker(&[mode.into(), "0".into()]).unwrap_err(),
                "worker：缺少有效的 appId"
            );
        }
    }

    #[test]
    fn parse_app_id_accepts_a_non_zero_u32() {
        assert_eq!(parse_app_id("440"), Ok(440));
        assert_eq!(parse_app_id("4294967295"), Ok(u32::MAX));
    }

    #[test]
    fn parse_app_id_canonicalizes_alternate_spellings() {
        // "0440" (and "+440", which u32's parser also takes) parse as 440; the worker is
        // handed the number's decimal form ("440"), never the renderer's own spelling.
        for raw in ["0440", "+440"] {
            assert_eq!(parse_app_id(raw), Ok(440));
            assert_eq!(
                parse_app_id(raw).map(|id| id.to_string()),
                Ok("440".to_string())
            );
        }
    }

    #[test]
    fn parse_app_id_rejects_zero_empty_non_numeric_and_overflow() {
        for bad in [
            "0",
            "000",
            "",
            " ",
            "abc",
            "440abc",
            " 440",
            "440 ",
            "-1",
            "4.0",
            "0x1b8",
            "--steam-worker",
            "4294967296",
            "99999999999999999999",
        ] {
            assert_eq!(
                parse_app_id(bad),
                Err("無效的 appId".to_string()),
                "{bad:?} must be rejected"
            );
        }
    }

    fn changes_with(achievements: usize, stats: usize) -> GameChanges {
        GameChanges {
            achievements: (0..achievements).map(|i| (format!("A{i}"), true)).collect(),
            stats: (0..stats).map(|i| (format!("S{i}"), 1.0)).collect(),
        }
    }

    #[test]
    fn check_change_limits_accepts_up_to_the_entry_cap() {
        assert_eq!(check_change_limits(&changes_with(0, 0)), Ok(()));
        assert_eq!(check_change_limits(&changes_with(3, 2)), Ok(()));
        assert_eq!(
            check_change_limits(&changes_with(MAX_SAVE_ENTRIES - 1, 1)),
            Ok(())
        );
    }

    #[test]
    fn check_change_limits_rejects_more_entries_than_the_cap() {
        // The cap is on achievements + stats together, whichever map the excess is in.
        for over in [
            changes_with(MAX_SAVE_ENTRIES + 1, 0),
            changes_with(0, MAX_SAVE_ENTRIES + 1),
            changes_with(MAX_SAVE_ENTRIES, 1),
        ] {
            assert_eq!(
                check_change_limits(&over),
                Err(format!("變更數量超過 {MAX_SAVE_ENTRIES} 筆上限"))
            );
        }
    }

    #[test]
    fn check_change_limits_rejects_an_id_longer_than_the_cap() {
        let at_cap = "a".repeat(MAX_SAVE_ID_BYTES);
        let over_cap = "a".repeat(MAX_SAVE_ID_BYTES + 1);
        let too_long = Err(format!("成就或統計 ID 超過 {MAX_SAVE_ID_BYTES} 位元組上限"));

        let mut ok = changes_with(1, 1);
        ok.achievements.insert(at_cap.clone(), true);
        ok.stats.insert(at_cap, 1.0);
        assert_eq!(check_change_limits(&ok), Ok(()));

        let mut long_achievement = changes_with(1, 1);
        long_achievement.achievements.insert(over_cap.clone(), true);
        assert_eq!(check_change_limits(&long_achievement), too_long);

        let mut long_stat = changes_with(1, 1);
        long_stat.stats.insert(over_cap, 1.0);
        assert_eq!(check_change_limits(&long_stat), too_long);
    }

    // The two tests below call the commands themselves, only with requests that are
    // refused before spawn_blocking — so neither can ever start a worker process.
    #[test]
    fn load_game_and_save_changes_reject_an_invalid_app_id_before_spawning() {
        let invalid = Err("無效的 appId".to_string());
        assert_eq!(
            tauri::async_runtime::block_on(load_game("0".into())),
            invalid
        );
        assert_eq!(
            tauri::async_runtime::block_on(save_changes("0".into(), changes_with(0, 0))),
            invalid
        );
    }

    #[test]
    fn save_changes_rejects_an_oversized_change_set_before_spawning() {
        let too_many = changes_with(MAX_SAVE_ENTRIES + 1, 0);
        assert_eq!(
            tauri::async_runtime::block_on(save_changes("440".into(), too_many)),
            Err(format!("變更數量超過 {MAX_SAVE_ENTRIES} 筆上限"))
        );

        let mut long_id = changes_with(1, 1);
        long_id
            .achievements
            .insert("a".repeat(MAX_SAVE_ID_BYTES + 1), true);
        assert_eq!(
            tauri::async_runtime::block_on(save_changes("440".into(), long_id)),
            Err(format!("成就或統計 ID 超過 {MAX_SAVE_ID_BYTES} 位元組上限"))
        );
    }

    #[test]
    fn lock_ignoring_poison_still_locks_after_a_holder_panicked() {
        let mutex = std::sync::Arc::new(std::sync::Mutex::new(()));
        let poisoner = std::sync::Arc::clone(&mutex);
        let panicked = std::thread::spawn(move || {
            let _held = poisoner.lock().expect("first lock");
            panic!("poison the lock");
        })
        .join();
        assert!(panicked.is_err());
        assert!(mutex.is_poisoned());

        // Taken and released twice: the guard is handed out despite the poison flag.
        drop(lock_ignoring_poison(&mutex));
        drop(lock_ignoring_poison(&mutex));
    }

    #[test]
    fn worker_command_drops_the_steam_launch_environment() {
        let mut cmd = std::process::Command::new("worker");
        // Explicitly set first, so the assertion cannot pass just because the test
        // process happens not to have these variables.
        cmd.env("SteamGameId", "440");
        cmd.env("SteamOverlayGameId", "440");
        clear_steam_launch_env(&mut cmd);
        let removed: Vec<&std::ffi::OsStr> = cmd
            .get_envs()
            .filter(|(_, value)| value.is_none())
            .map(|(key, _)| key)
            .collect();
        assert_eq!(removed.len(), 2);
        assert!(removed.contains(&std::ffi::OsStr::new("SteamGameId")));
        assert!(removed.contains(&std::ffi::OsStr::new("SteamOverlayGameId")));
        assert_eq!(cmd.get_envs().count(), 2, "nothing else is set or removed");
    }

    #[test]
    fn self_worker_command_passes_the_args_and_drops_the_steam_launch_environment() {
        let cmd = self_worker_command(std::path::Path::new("app"), &["write", "440"]);
        assert_eq!(cmd.get_program(), "app");
        assert_eq!(
            cmd.get_args().collect::<Vec<_>>(),
            ["--steam-worker", "write", "440"]
        );
        // An explicit removal is listed with no value, whatever this process inherited.
        let envs: Vec<_> = cmd.get_envs().collect();
        assert_eq!(envs.len(), 2, "nothing else is set or removed");
        for key in ["SteamGameId", "SteamOverlayGameId"] {
            assert!(envs.contains(&(std::ffi::OsStr::new(key), None)), "{key}");
        }
    }

    // The run_worker_command tests spawn small system programs, never this app.
    fn system_command(program: &str, args: &[&str]) -> std::process::Command {
        let mut cmd = std::process::Command::new(program);
        cmd.args(args);
        cmd
    }

    /// Far more than a pipe buffer holds: the write only ends once the child reads it
    /// all, or is gone.
    fn payload_larger_than_a_pipe_buffer() -> String {
        "x".repeat(4 * 1024 * 1024)
    }

    #[test]
    fn run_worker_command_feeds_stdin_and_closes_it_so_the_child_sees_eof() {
        // `sort` (the same name on Windows and Unix) prints only after its stdin ends.
        assert_eq!(
            run_worker_command(
                system_command("sort", &[]),
                Some("payload\n".to_string()),
                Duration::from_secs(30)
            ),
            Ok("payload".to_string())
        );
    }

    #[test]
    fn run_worker_command_times_out_a_child_that_never_drains_its_stdin() {
        #[cfg(windows)]
        let stalled = system_command("ping", &["-n", "30", "127.0.0.1"]);
        #[cfg(not(windows))]
        let stalled = system_command("sleep", &["30"]);
        // Reached after the 1 s timeout, not when the child gives up 30 s later: the
        // blocked stdin write does not hold the caller.
        assert_eq!(
            run_worker_command(
                stalled,
                Some(payload_larger_than_a_pipe_buffer()),
                Duration::from_secs(1)
            ),
            Err("worker 逾時（超過 1 秒）".to_string())
        );
    }

    #[test]
    fn run_worker_command_reports_the_failed_stdin_write_of_a_silently_failing_child() {
        #[cfg(windows)]
        let failing = system_command("cmd", &["/C", "exit 3"]);
        #[cfg(not(windows))]
        let failing = system_command("false", &[]);
        let error = run_worker_command(
            failing,
            Some(payload_larger_than_a_pipe_buffer()),
            Duration::from_secs(30),
        )
        .unwrap_err();
        assert_ne!(error, "worker 失敗", "the write error is what is reported");
        assert!(!error.is_empty());
    }

    #[test]
    fn is_plain_version_accepts_three_numeric_groups() {
        for good in ["1.4.1", "0.0.0", "10.20.30", "01.2.3"] {
            assert!(is_plain_version(good), "{good:?} must be accepted");
        }
        let longest = "1234567890.1234567890.1234567890";
        assert_eq!(longest.len(), MAX_VERSION_LEN);
        assert!(is_plain_version(longest));
    }

    #[test]
    fn is_plain_version_rejects_everything_else() {
        for bad in [
            "",
            "1",
            "1.4",
            "1.4.1.0",
            "v1.4.1",
            "1.4.1 ",
            " 1.4.1",
            "1.4.1\n",
            "1..1",
            ".4.1",
            "1.4.",
            "1.4.x",
            "1.4.-1",
            "1.4.+1",
            "1.4.1-beta",
            "1.4.1+build",
            "9.9.9 - any text",
            "9.9.9<b>x</b>",
            "１.４.１",
            "12345678901.1234567890.1234567890",
        ] {
            assert!(!is_plain_version(bad), "{bad:?} must be rejected");
        }
    }

    #[test]
    fn manifest_version_returns_only_a_plain_version() {
        assert_eq!(
            manifest_version(r#"{"version":"1.4.1","notes":"x","platforms":{}}"#),
            Ok("1.4.1".to_string())
        );
        assert_eq!(
            manifest_version(r#"{"version":"9.9.9 - any text"}"#),
            Err("latest.json 'version' is not a plain x.y.z version".to_string())
        );
        for missing in [r#"{}"#, r#"{"version":141}"#, r#"{"version":null}"#] {
            assert_eq!(
                manifest_version(missing),
                Err("latest.json missing 'version'".to_string())
            );
        }
        assert!(manifest_version("not json").is_err());
        assert!(manifest_version("").is_err());
    }

    #[test]
    fn read_manifest_body_caps_the_decoded_bytes() {
        let cap = LATEST_JSON_MAX_BYTES as usize;
        let too_large = Err(format!(
            "latest.json is larger than {LATEST_JSON_MAX_BYTES} bytes"
        ));
        assert_eq!(read_manifest_body("{}".as_bytes()), Ok("{}".to_string()));
        assert_eq!(
            read_manifest_body(vec![b' '; cap].as_slice()).map(|body| body.len()),
            Ok(cap)
        );
        assert_eq!(
            read_manifest_body(vec![b' '; cap + 1].as_slice()),
            too_large
        );
        // An endless body is cut off at the cap instead of being buffered until memory
        // runs out — what a gzip response expanding without end would otherwise do.
        assert_eq!(read_manifest_body(std::io::repeat(b' ')), too_large);
        assert!(read_manifest_body([0xff_u8].as_slice()).is_err());
    }

    #[test]
    fn macos_open_program_is_an_absolute_path() {
        // `Path::is_absolute` is platform-specific (a leading "/" is not absolute on
        // Windows), so the portable check is on the string itself.
        assert!(MACOS_OPEN_PROGRAM.starts_with('/'));
        #[cfg(unix)]
        assert!(std::path::Path::new(MACOS_OPEN_PROGRAM).is_absolute());
    }

    #[cfg(windows)]
    #[test]
    fn rundll32_path_is_always_absolute_and_under_system32() {
        use super::rundll32_path;
        use std::path::PathBuf;

        let fallback = PathBuf::from(r"C:\Windows\System32\rundll32.exe");
        assert_eq!(
            rundll32_path(Some(r"D:\WinNT".into())),
            PathBuf::from(r"D:\WinNT\System32\rundll32.exe")
        );
        // Missing, empty, relative or drive-less values fall back to C:\Windows rather
        // than producing a path that would be resolved against the current directory.
        assert_eq!(rundll32_path(None), fallback);
        for bad in ["", "Windows", r".\Windows", r"\Windows", "C:Windows"] {
            assert_eq!(rundll32_path(Some(bad.into())), fallback, "{bad:?}");
        }
        for root in [None, Some(r"D:\WinNT".into()), Some("Windows".into())] {
            assert!(rundll32_path(root).is_absolute());
        }
        // The real environment of this machine resolves to an existing rundll32.
        let real = rundll32_path(std::env::var_os("SystemRoot"));
        assert!(real.is_absolute());
        assert!(real.is_file(), "{} should exist", real.display());
    }

    #[test]
    fn worker_rejects_unknown_mode_without_connecting_to_steam() {
        assert_eq!(
            run_worker(&["invalid-smoke-mode".into(), "1".into()]).unwrap_err(),
            "worker：未知模式 invalid-smoke-mode"
        );
    }

    #[test]
    fn game_changes_deserializes_from_the_frontend_json_shape() {
        // Exact shape tauriSource.ts's saveChanges sends: GameChanges { achievements:
        // Record<string, boolean>, stats: Record<string, number> }.
        let json = r#"{"achievements":{"ACH_A":true,"ACH_B":false},"stats":{"score":12.5}}"#;
        let changes: GameChanges = serde_json::from_str(json).expect("valid shape");
        assert_eq!(changes.achievements.get("ACH_A"), Some(&true));
        assert_eq!(changes.achievements.get("ACH_B"), Some(&false));
        assert_eq!(changes.stats.get("score"), Some(&12.5));
    }

    #[test]
    fn game_changes_defaults_missing_achievements_or_stats_to_empty() {
        let neither: GameChanges = serde_json::from_str("{}").expect("both default");
        assert!(neither.achievements.is_empty());
        assert!(neither.stats.is_empty());

        let only_achievements: GameChanges =
            serde_json::from_str(r#"{"achievements":{"A":true}}"#).expect("stats default");
        assert_eq!(only_achievements.achievements.len(), 1);
        assert!(only_achievements.stats.is_empty());

        let only_stats: GameChanges =
            serde_json::from_str(r#"{"stats":{"score":1.0}}"#).expect("achievements default");
        assert!(only_stats.achievements.is_empty());
        assert_eq!(only_stats.stats.len(), 1);
    }

    #[test]
    fn write_payload_round_trips_every_achievement_and_stat() {
        let mut achievements = HashMap::new();
        achievements.insert("ACH_A".to_string(), true);
        achievements.insert("ACH_B".to_string(), false);
        let mut stats = HashMap::new();
        stats.insert("score".to_string(), 12.5);
        stats.insert("kills".to_string(), 7.0);
        let changes = GameChanges {
            achievements,
            stats,
        };

        let payload = write_payload(changes);
        let parsed: WritePayload = serde_json::from_str(&payload).expect("valid WritePayload");

        // HashMap iteration order is random, so compare as sorted sets.
        let mut ach: Vec<(String, bool)> = parsed
            .achievements
            .into_iter()
            .map(|a| (a.id, a.unlock))
            .collect();
        ach.sort();
        assert_eq!(
            ach,
            vec![("ACH_A".to_string(), true), ("ACH_B".to_string(), false)]
        );

        let mut stats_out: Vec<(String, f64)> =
            parsed.stats.into_iter().map(|s| (s.id, s.value)).collect();
        stats_out.sort_by(|a, b| a.0.cmp(&b.0));
        assert_eq!(
            stats_out,
            vec![("kills".to_string(), 7.0), ("score".to_string(), 12.5)]
        );
    }

    #[test]
    fn write_payload_of_empty_changes_produces_empty_vectors() {
        let changes = GameChanges {
            achievements: HashMap::new(),
            stats: HashMap::new(),
        };
        let payload = write_payload(changes);
        let parsed: WritePayload = serde_json::from_str(&payload).expect("valid WritePayload");
        assert!(parsed.achievements.is_empty());
        assert!(parsed.stats.is_empty());
    }

    /// A unique throwaway directory under the OS temp dir, cleaned up by the caller.
    fn temp_subdir(tag: &str) -> std::path::PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!(
            "sam-updater-test-{tag}-{}-{nanos}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).expect("temp dir");
        dir
    }

    #[test]
    fn has_nsis_uninstaller_true_when_uninstall_exe_file_exists() {
        let dir = temp_subdir("file");
        std::fs::write(dir.join("uninstall.exe"), b"stub").expect("write fixture");
        assert!(has_nsis_uninstaller(&dir));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn has_nsis_uninstaller_false_when_absent() {
        let dir = temp_subdir("absent");
        assert!(!has_nsis_uninstaller(&dir));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn has_nsis_uninstaller_false_when_uninstall_exe_is_a_directory() {
        let dir = temp_subdir("dir");
        std::fs::create_dir_all(dir.join("uninstall.exe")).expect("mkdir");
        assert!(!has_nsis_uninstaller(&dir));
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// What Tauri's ACL has to answer for a plugin command sent by the main window from
    /// the app's own origin. `true`: the frontend invokes it, so capabilities/default.json
    /// must grant it. `false`: never granted — these show the answer is a real decision.
    const MAIN_WINDOW_ACL: &[(&str, bool)] = &[
        // lib/appWindow.ts and the title bar's drag region
        ("plugin:window|minimize", true),
        ("plugin:window|toggle_maximize", true),
        ("plugin:window|close", true),
        ("plugin:window|show", true),
        ("plugin:window|set_focus", true),
        ("plugin:window|start_dragging", true),
        ("plugin:window|internal_toggle_maximize", true),
        // state/AppContext.tsx: the version check and the unsaved-changes close guard
        ("plugin:app|version", true),
        ("plugin:event|listen", true),
        ("plugin:event|unlisten", true),
        ("plugin:window|destroy", true),
        // data/update.ts
        ("plugin:updater|check", true),
        ("plugin:updater|download_and_install", true),
        ("plugin:process|restart", true),
        // not granted
        ("plugin:process|exit", false),
        ("plugin:updater|download", false),
        ("plugin:updater|install", false),
        ("plugin:window|maximize", false),
        ("plugin:window|set_title", false),
    ];

    #[test]
    fn main_window_acl_allows_what_the_frontend_invokes_and_denies_what_is_not_granted() {
        // The tauri.conf.json and capabilities/ that `run()` compiles in, resolved into the
        // RuntimeAuthority Tauri asks before dispatching any `plugin:` IPC call. Only its
        // decision is read: no command is invoked, so no window, updater or restart runs.
        // `test = true` leaves out the macOS Info.plist embed, which `run()`'s own
        // expansion already does (a second one is a duplicate symbol).
        let mut context: tauri::Context = tauri::generate_context!(test = true);
        let windows = &context.config().app.windows;
        assert!(
            windows.iter().any(|window| window.label == "main"),
            "tauri.conf.json no longer defines the \"main\" window"
        );

        let authority = context.runtime_authority_mut();
        let wrong: Vec<String> = MAIN_WINDOW_ACL
            .iter()
            .filter(|(command, allowed)| {
                let granted = authority
                    .resolve_access(command, "main", "main", &tauri::ipc::Origin::Local)
                    .is_some();
                granted != *allowed
            })
            .map(|(command, allowed)| {
                let expected = if *allowed { "allowed" } else { "denied" };
                format!("{command} must be {expected}")
            })
            .collect();
        assert!(
            wrong.is_empty(),
            "capabilities/default.json no longer matches MAIN_WINDOW_ACL: {wrong:#?}"
        );
    }
}
