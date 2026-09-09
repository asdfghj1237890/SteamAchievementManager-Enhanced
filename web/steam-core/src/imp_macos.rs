//! macOS port of the internal-steamclient layer. Loads steamclient.dylib via
//! dlopen and mirrors the Windows `imp` module, including achievement/stat writes
//! (`write_stats`, dispatched from lib.rs `write_game`).

use super::{
    achievement_write_allowed, choose_account_id_with_preferred, parse_most_recent_account_id,
    stat_bound, stat_i32_value, stat_max_default, stat_min_default, stat_value_is_valid,
    writable_stat_def, AchChange, AchievementInfo, GameProgress, GameStats, OwnedGame, StatChange,
    StatDef, StatInfo, WriteResult,
};
use std::ffi::{c_char, c_int, c_void, CStr, CString};
use std::time::{Duration, Instant};

#[allow(non_snake_case)]
extern "C" {
    fn dlopen(filename: *const c_char, flag: c_int) -> *mut c_void;
    fn dlsym(handle: *mut c_void, symbol: *const c_char) -> *mut c_void;
    fn dlerror() -> *const c_char;
}
const RTLD_NOW: c_int = 0x2;

/// k_iSteamUserStatsCallbacks (1100) + 1
const USER_STATS_RECEIVED: i32 = 1101;

#[repr(C)]
#[allow(dead_code)] // fields are FFI layout, not all read
struct CallbackMsg {
    user: i32,
    id: i32,
    param: *mut u8,
    param_size: i32,
}

/// Read vtable slot `index` of a C++ object and reinterpret it as fn pointer `T`.
unsafe fn vfn<T: Copy>(obj: *mut c_void, index: usize) -> T {
    let vtbl = *(obj as *const *const *const c_void);
    let f = *vtbl.add(index);
    std::mem::transmute_copy::<*const c_void, T>(&f)
}

unsafe fn cstr(p: *const c_char) -> String {
    if p.is_null() {
        return String::new();
    }
    CStr::from_ptr(p).to_string_lossy().into_owned()
}

unsafe fn last_dlerror() -> String {
    let e = dlerror();
    if e.is_null() {
        String::new()
    } else {
        CStr::from_ptr(e).to_string_lossy().into_owned()
    }
}

/// Steam root on macOS: ~/Library/Application Support/Steam (must exist).
fn steam_root() -> Option<String> {
    let home = std::env::var("HOME").ok()?;
    let root = format!("{home}/Library/Application Support/Steam");
    if std::path::Path::new(&root).is_dir() {
        Some(root)
    } else {
        None
    }
}

fn dylib_path(root: &str) -> String {
    format!("{root}/Steam.AppBundle/Steam/Contents/MacOS/steamclient.dylib")
}

fn schema_path(root: &str, app_id: u32) -> String {
    format!("{root}/appcache/stats/UserGameStatsSchema_{app_id}.bin")
}

fn user_stats_path(root: &str, account_id: u32, app_id: u32) -> String {
    format!("{root}/appcache/stats/UserGameStats_{account_id}_{app_id}.bin")
}

fn account_ids(root: &str) -> Vec<u32> {
    let mut ids: Vec<u32> = std::fs::read_dir(format!("{root}/userdata"))
        .ok()
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|entry| {
            entry
                .file_name()
                .to_str()
                .and_then(|n| n.parse::<u32>().ok())
        })
        .filter(|id| *id != 0)
        .collect();
    ids.sort_unstable();
    ids
}

fn most_recent_account_id(root: &str, accounts: &[u32]) -> Option<u32> {
    let txt = std::fs::read_to_string(format!("{root}/config/loginusers.vdf")).ok()?;
    parse_most_recent_account_id(&txt, accounts)
}

fn find_account_id(root: &str) -> Option<u32> {
    let accounts = account_ids(root);
    let preferred = most_recent_account_id(root, &accounts);
    choose_account_id_with_preferred(accounts, preferred, |_| false)
}

fn resolve_stat_type(stat: &super::Kv) -> u8 {
    let raw = stat
        .child("type")
        .map(|n| {
            if let Some(s) = n.as_str() {
                s.parse::<i32>()
                    .unwrap_or_else(|_| match s.to_ascii_lowercase().as_str() {
                        "integer" | "int" => 1,
                        "float" => 2,
                        "averagerate" => 3,
                        "achievements" => 4,
                        "groupachievements" => 5,
                        _ => 0,
                    })
            } else {
                n.as_int()
            }
        })
        .unwrap_or(0);
    let raw = if raw == 0 {
        stat.child("type_int").map(|n| n.as_int()).unwrap_or(0)
    } else {
        raw
    };
    match raw {
        1 => 1,     // Integer
        2 | 3 => 2, // Float / AverageRate
        _ => 0,
    }
}

fn resolve_display_name(stat: &super::Kv, lang: &str, fallback: &str) -> String {
    let Some(name_node) = stat.child("display").and_then(|d| d.child("name")) else {
        return fallback.to_string();
    };
    if let Some(s) = name_node.as_str() {
        return s.to_string();
    }
    name_node
        .child(lang)
        .and_then(|c| c.as_str())
        .or_else(|| name_node.child("english").and_then(|c| c.as_str()))
        .or_else(|| name_node.children.iter().find_map(|c| c.as_str()))
        .unwrap_or(fallback)
        .to_string()
}

/// For each child of `node`, count the children of its `key` sub-node. Sum.
fn count_children(node: &super::Kv, key: &str) -> u32 {
    node.children
        .iter()
        .filter_map(|c| c.child(key))
        .map(|g| g.children.len() as u32)
        .sum()
}

/// Completion (earned, total) read straight from Steam's local cache files —
/// NO Steam connection, so it never launches the game.
fn completion_local_with_context(
    root: &str,
    accounts: &[u32],
    preferred: Option<u32>,
    app_id: u32,
) -> Option<GameProgress> {
    let schema = std::fs::read(schema_path(root, app_id)).ok()?;
    let schema_kv = super::parse_kv(&schema)?;
    let stats = schema_kv.child(&app_id.to_string())?.child("stats")?;
    let total = count_children(stats, "bits");
    if total == 0 {
        return None;
    }

    let earned =
        choose_account_id_with_preferred(accounts.iter().copied(), preferred, |account_id| {
            std::path::Path::new(&user_stats_path(root, account_id, app_id)).is_file()
        })
        .and_then(|account_id| std::fs::read(user_stats_path(root, account_id, app_id)).ok())
        .and_then(|d| super::parse_kv(&d))
        .and_then(|kv| {
            kv.child("cache")
                .map(|c| count_children(c, "AchievementTimes"))
        })
        .unwrap_or(0);

    Some(GameProgress {
        app_id,
        earned: earned.min(total),
        total,
    })
}

/// Batch completion scan with one Steam root/account discovery for the library. The
/// per-app schema reads + parses (tens of MB for a large library) run on a few
/// threads: this path opens no Steam interface — pure local file I/O — so it is safe
/// to parallelize.
pub fn completion_local_many(app_ids: &[u32]) -> Vec<GameProgress> {
    let Some(root) = steam_root() else {
        return Vec::new();
    };
    let accounts = account_ids(&root);
    let preferred = most_recent_account_id(&root, &accounts);
    let scan = |ids: &[u32]| -> Vec<GameProgress> {
        ids.iter()
            .copied()
            .filter_map(|app_id| completion_local_with_context(&root, &accounts, preferred, app_id))
            .collect()
    };
    let threads = super::scan_threads(app_ids.len());
    if threads <= 1 {
        return scan(app_ids);
    }
    let scan = &scan;
    let chunk = app_ids.len().div_ceil(threads);
    std::thread::scope(|s| {
        let workers: Vec<_> = app_ids
            .chunks(chunk)
            .map(|ids| s.spawn(move || scan(ids)))
            .collect();
        workers
            .into_iter()
            .flat_map(|w| w.join().unwrap_or_default())
            .collect()
    })
}

pub fn completion_local(app_id: u32) -> Option<(u32, u32)> {
    completion_local_many(&[app_id])
        .pop()
        .map(|progress| (progress.earned, progress.total))
}

/// The user's library categories per app, parsed from the modern Steam Collections
/// cloud store (`config/cloudstorage/cloud-storage-namespace-1.json`). Read-only, no
/// Steam connection. Legacy `sharedconfig.vdf` tags are not read on macOS yet.
pub fn read_categories() -> Vec<(u32, Vec<String>)> {
    let Some(root) = steam_root() else {
        return Vec::new();
    };
    let Some(account) = find_account_id(&root) else {
        return Vec::new();
    };
    let path =
        format!("{root}/userdata/{account}/config/cloudstorage/cloud-storage-namespace-1.json");
    let Ok(txt) = std::fs::read_to_string(&path) else {
        return Vec::new();
    };
    let Ok(json) = serde_json::from_str::<serde_json::Value>(&txt) else {
        return Vec::new();
    };
    let mut map: std::collections::HashMap<u32, std::collections::BTreeSet<String>> =
        std::collections::HashMap::new();
    for pair in json.as_array().into_iter().flatten() {
        let Some(p) = pair.as_array() else { continue };
        let Some(key) = p.first().and_then(|k| k.as_str()) else {
            continue;
        };
        if !key.starts_with("user-collections.") {
            continue;
        }
        let Some(vs) = p
            .get(1)
            .and_then(|e| e.get("value"))
            .and_then(|v| v.as_str())
        else {
            continue;
        };
        let Ok(coll) = serde_json::from_str::<serde_json::Value>(vs) else {
            continue;
        };
        let Some(name) = coll.get("name").and_then(|n| n.as_str()) else {
            continue;
        };
        if name.is_empty() {
            continue;
        }
        for app in coll
            .get("added")
            .and_then(|a| a.as_array())
            .into_iter()
            .flatten()
        {
            if let Some(id) = app.as_u64() {
                map.entry(id as u32).or_default().insert(name.to_string());
            }
        }
    }
    map.into_iter()
        .map(|(k, v)| (k, v.into_iter().collect()))
        .collect()
}

pub struct SteamClient {
    #[allow(dead_code)] // kept alive for the process lifetime; dlclose intentionally skipped
    module: *mut c_void,
    client: *mut c_void,
    pipe: i32,
    user: i32,
    apps008: *mut c_void,
    apps001: *mut c_void,
    root: String,
}

impl SteamClient {
    pub fn connect() -> Result<Self, String> {
        let root = steam_root().ok_or("找不到 Steam 安裝路徑（請確認已安裝 Steam）")?;
        unsafe {
            let dylib = dylib_path(&root);
            if !std::path::Path::new(&dylib).exists() {
                return Err(format!("找不到 {dylib}"));
            }
            let c_path = CString::new(dylib.clone()).map_err(|e| e.to_string())?;
            let module = dlopen(c_path.as_ptr(), RTLD_NOW);
            if module.is_null() {
                return Err(format!("無法載入 {dylib}：{}", last_dlerror()));
            }

            let create_name = CString::new("CreateInterface").unwrap();
            let create_ptr = dlsym(module, create_name.as_ptr());
            if create_ptr.is_null() {
                return Err("steamclient.dylib 缺少 CreateInterface 匯出".into());
            }
            type CreateInterface = unsafe extern "C" fn(*const c_char, *mut i32) -> *mut c_void;
            let create: CreateInterface = std::mem::transmute_copy(&create_ptr);

            let ver = CString::new("SteamClient018").unwrap();
            let client = create(ver.as_ptr(), std::ptr::null_mut());
            if client.is_null() {
                return Err("建立 ISteamClient018 失敗".into());
            }

            let create_pipe: extern "C" fn(*mut c_void) -> i32 = vfn(client, 0);
            let pipe = create_pipe(client);
            if pipe == 0 {
                return Err("CreateSteamPipe 失敗（Steam 可能未啟動）".into());
            }

            let connect: extern "C" fn(*mut c_void, i32) -> i32 = vfn(client, 2);
            let user = connect(client, pipe);
            if user == 0 {
                return Err("ConnectToGlobalUser 失敗（請先啟動並登入 Steam）".into());
            }

            // GetISteamApps (vtable 15) — pass `this`.
            let get_apps: extern "C" fn(*mut c_void, i32, i32, *const c_char) -> *mut c_void =
                vfn(client, 15);
            let v008 = CString::new("STEAMAPPS_INTERFACE_VERSION008").unwrap();
            let v001 = CString::new("STEAMAPPS_INTERFACE_VERSION001").unwrap();
            let apps008 = get_apps(client, user, pipe, v008.as_ptr());
            let apps001 = get_apps(client, user, pipe, v001.as_ptr());
            if apps008.is_null() || apps001.is_null() {
                return Err("取得 ISteamApps 介面失敗".into());
            }

            Ok(SteamClient {
                module,
                client,
                pipe,
                user,
                apps008,
                apps001,
                root,
            })
        }
    }

    unsafe fn export<T: Copy>(&self, name: &str) -> Result<T, String> {
        let c = CString::new(name).unwrap();
        let p = dlsym(self.module, c.as_ptr());
        if p.is_null() {
            return Err(format!("steamclient 缺少匯出 {name}"));
        }
        Ok(std::mem::transmute_copy::<*mut c_void, T>(&p))
    }

    pub fn is_subscribed(&self, app_id: u32) -> bool {
        unsafe {
            let f: extern "C" fn(*mut c_void, u32) -> u8 = vfn(self.apps008, 6);
            f(self.apps008, app_id) != 0
        }
    }

    pub fn app_data(&self, app_id: u32, key: &str) -> Option<String> {
        unsafe {
            let f: extern "C" fn(*mut c_void, u32, *const c_char, *mut c_char, i32) -> i32 =
                vfn(self.apps001, 0);
            let k = CString::new(key).ok()?;
            let mut buf = vec![0u8; 1024];
            let n = f(
                self.apps001,
                app_id,
                k.as_ptr(),
                buf.as_mut_ptr() as *mut c_char,
                buf.len() as i32,
            );
            if n == 0 {
                return None;
            }
            let end = buf.iter().position(|&b| b == 0).unwrap_or(buf.len());
            Some(String::from_utf8_lossy(&buf[..end]).into_owned())
        }
    }

    pub fn owned_games(&self, candidates: &[u32]) -> Vec<OwnedGame> {
        candidates
            .iter()
            .copied()
            .filter(|&id| self.is_subscribed(id))
            .map(|id| OwnedGame {
                app_id: id,
                name: self.app_data(id, "name").unwrap_or_else(|| id.to_string()),
                kind: "normal".into(),
            })
            .collect()
    }

    pub fn owned_games_typed(&self, entries: &[(u32, String)]) -> Vec<OwnedGame> {
        entries
            .iter()
            .filter(|(id, _)| self.is_subscribed(*id))
            .map(|(id, kind)| OwnedGame {
                app_id: *id,
                name: self.app_data(*id, "name").unwrap_or_else(|| id.to_string()),
                kind: if kind.is_empty() {
                    "normal".into()
                } else {
                    kind.clone()
                },
            })
            .collect()
    }

    unsafe fn get_interface(&self, slot: usize, version: &str) -> Result<*mut c_void, String> {
        let f: extern "C" fn(*mut c_void, i32, i32, *const c_char) -> *mut c_void =
            vfn(self.client, slot);
        let v = CString::new(version).unwrap();
        let p = f(self.client, self.user, self.pipe, v.as_ptr());
        if p.is_null() {
            Err(format!("取得介面 {version} 失敗"))
        } else {
            Ok(p)
        }
    }

    unsafe fn steam_id(&self, user_iface: *mut c_void) -> u64 {
        // ISteamUser012.GetSteamID (vtable 2) returns via out-param.
        let f: extern "C" fn(*mut c_void, *mut u64) = vfn(user_iface, 2);
        let mut id: u64 = 0;
        f(user_iface, &mut id);
        id
    }

    /// Pump callbacks until `callback_id` arrives (or timeout). Frees each dequeued.
    unsafe fn wait_for_callback(&self, callback_id: i32, timeout_secs: u64) -> bool {
        let get_cb: extern "C" fn(i32, *mut CallbackMsg, *mut i32) -> u8 =
            match self.export("Steam_BGetCallback") {
                Ok(f) => f,
                Err(_) => return false,
            };
        let free_cb: extern "C" fn(i32) -> u8 = match self.export("Steam_FreeLastCallback") {
            Ok(f) => f,
            Err(_) => return false,
        };
        let start = Instant::now();
        loop {
            let mut msg = CallbackMsg {
                user: 0,
                id: 0,
                param: std::ptr::null_mut(),
                param_size: 0,
            };
            let mut call: i32 = 0;
            if get_cb(self.pipe, &mut msg, &mut call) != 0 {
                let hit = msg.id == callback_id;
                free_cb(self.pipe);
                if hit {
                    return true;
                }
            } else {
                std::thread::sleep(Duration::from_millis(10));
            }
            if start.elapsed() > Duration::from_secs(timeout_secs) {
                return false;
            }
        }
    }

    unsafe fn prepare_stats(&self) -> Result<*mut c_void, String> {
        let user_iface = self.get_interface(5, "SteamUser012")?; // GetISteamUser
        let steam_id = self.steam_id(user_iface);
        let stats = self.get_interface(13, "STEAMUSERSTATS_INTERFACE_VERSION013")?; // GetISteamUserStats

        // RequestUserStats (vtable 15) → triggers UserStatsReceived.
        let request: extern "C" fn(*mut c_void, u64) -> u64 = vfn(stats, 15);
        request(stats, steam_id);

        // For a game whose schema isn't cached on disk, the schema downloads
        // asynchronously: the FIRST UserStatsReceived arrives with a non-OK result
        // (still downloading) and GetNumAchievements is still 0. A SECOND callback
        // then arrives with k_EResultOK once the schema is loaded. So we must wait
        // for THIS app's UserStatsReceived with result OK — not just any callback.
        let want_app: u32 = std::env::var("SteamAppId")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(0);
        let num: extern "C" fn(*mut c_void) -> u32 = vfn(stats, 13);

        let (Ok(get_cb), Ok(free_cb)) = (
            self.export::<extern "C" fn(i32, *mut CallbackMsg, *mut i32) -> u8>(
                "Steam_BGetCallback",
            ),
            self.export::<extern "C" fn(i32) -> u8>("Steam_FreeLastCallback"),
        ) else {
            // exports missing → fall back to the old single-callback wait
            return if self.wait_for_callback(USER_STATS_RECEIVED, 8) {
                Ok(stats)
            } else {
                Err("等待 Steam 統計逾時（請確認該遊戲在 Steam 已安裝/有成就）".into())
            };
        };

        let start = Instant::now();
        // Ramp 4 → 80 ms: the stats usually land within tens of ms, so the first
        // checks come quickly, while a slow schema download still doesn't spin.
        let mut delay = Duration::from_millis(4);
        loop {
            let mut got_ok = false;
            let mut msg = CallbackMsg {
                user: 0,
                id: 0,
                param: std::ptr::null_mut(),
                param_size: 0,
            };
            let mut call: i32 = 0;
            while get_cb(self.pipe, &mut msg, &mut call) != 0 {
                if msg.id == USER_STATS_RECEIVED && !msg.param.is_null() && msg.param_size >= 12 {
                    let game_id = *(msg.param as *const u64) as u32; // m_nGameID (low 32 = appId)
                    let result = *(msg.param.add(8) as *const i32); // m_eResult (k_EResultOK == 1)
                    if (want_app == 0 || game_id == want_app) && result == 1 {
                        got_ok = true;
                    }
                }
                free_cb(self.pipe);
            }
            // OK callback for our app, or the schema is already loaded (count > 0).
            if got_ok || num(stats) > 0 {
                return Ok(stats);
            }
            if start.elapsed() > Duration::from_secs(20) {
                return Err("等待 Steam 統計逾時（請確認該遊戲在 Steam 已安裝/有成就）".into());
            }
            std::thread::sleep(delay);
            delay = (delay * 2).min(Duration::from_millis(80));
        }
    }

    /// ISteamApps008.GetCurrentGameLanguage (vtable 4).
    fn game_language(&self) -> String {
        unsafe {
            let f: extern "C" fn(*mut c_void) -> *const c_char = vfn(self.apps008, 4);
            cstr(f(self.apps008))
        }
    }

    /// Read + parse this game's local schema `.bin` once. Both the achievement
    /// permission map (`schema_ach_perms`) and the stat definitions
    /// (`stat_defs_from`) are derived from the returned tree, so a read or a
    /// write never parses the file twice. `None` when it can't be read or
    /// parsed — the write path must fail closed on that.
    fn read_schema(&self, app_id: u32) -> Option<super::Kv> {
        let data = std::fs::read(schema_path(&self.root, app_id)).ok()?;
        super::parse_kv(&data)
    }

    /// This game's int/float stat definitions from a parsed schema tree.
    fn stat_defs_from(&self, root: &super::Kv, app_id: u32) -> Vec<StatDef> {
        let Some(app_node) = root.child(&app_id.to_string()) else {
            return Vec::new();
        };
        let Some(stats) = app_node.child("stats") else {
            return Vec::new();
        };
        let lang = self.game_language();
        let mut defs = Vec::new();
        for stat in &stats.children {
            let kind = resolve_stat_type(stat);
            if kind == 0 {
                continue;
            }
            let id = stat
                .child("name")
                .and_then(|n| n.as_str())
                .unwrap_or("")
                .to_string();
            if id.is_empty() {
                continue;
            }
            defs.push(StatDef {
                name: resolve_display_name(stat, &lang, &id),
                is_float: kind == 2,
                permission: stat.child("permission").map(|p| p.as_int()).unwrap_or(0),
                increment_only: stat
                    .child("incrementonly")
                    .map(|p| p.as_bool())
                    .unwrap_or(false),
                min_value: stat_bound(stat, "min", stat_min_default(kind == 2)),
                max_value: stat_bound(stat, "max", stat_max_default(kind == 2)),
                max_change: stat_bound(stat, "maxchange", 0.0).max(0.0),
                id,
            });
        }
        defs
    }

    /// Bounded wait for the global-percentage call result issued at the top of
    /// `read_stats`. Returns true once GetAchievementAchievedPercent (vtable 36)
    /// reports data for the first achievement. Stops early when the pipe reports the
    /// call completed without data (offline, or the app publishes no global stats)
    /// instead of sleeping to the deadline.
    unsafe fn wait_global_percentages(
        &self,
        stats: *mut c_void,
        get_pct: extern "C" fn(*mut c_void, *const c_char, *mut f32) -> u8,
        call: u64,
        started: Instant,
    ) -> bool {
        let num: extern "C" fn(*mut c_void) -> u32 = vfn(stats, 13);
        let get_name: extern "C" fn(*mut c_void, u32) -> *const c_char = vfn(stats, 14);
        if num(stats) == 0 {
            return false;
        }
        let probe_ptr = get_name(stats, 0);
        if probe_ptr.is_null() {
            return false;
        }
        let Ok(probe) = CString::new(cstr(probe_ptr)) else {
            return false;
        };
        let (Ok(get_cb), Ok(free_cb)) = (
            self.export::<extern "C" fn(i32, *mut CallbackMsg, *mut i32) -> u8>(
                "Steam_BGetCallback",
            ),
            self.export::<extern "C" fn(i32) -> u8>("Steam_FreeLastCallback"),
        ) else {
            return false;
        };
        // Short first sleeps so a fast answer is noticed within milliseconds; back
        // off to 50 ms so a slow one does not spin.
        let mut delay = Duration::from_millis(5);
        loop {
            let mut m = CallbackMsg {
                user: 0,
                id: 0,
                param: std::ptr::null_mut(),
                param_size: 0,
            };
            let mut c: i32 = 0;
            let mut completed = false;
            while get_cb(self.pipe, &mut m, &mut c) != 0 {
                if super::completed_call_handle(m.id, m.param, m.param_size) == Some(call) {
                    completed = true;
                }
                free_cb(self.pipe);
            }
            let mut p: f32 = 0.0;
            if get_pct(stats, probe.as_ptr(), &mut p) != 0 {
                return true;
            }
            if completed || started.elapsed() >= super::GLOBAL_PCT_WAIT {
                return false;
            }
            std::thread::sleep(delay);
            delay = (delay * 2).min(Duration::from_millis(50));
        }
    }

    pub fn read_stats(&self, app_id: u32) -> Result<GameStats, String> {
        unsafe {
            let stats = self.prepare_stats()?;

            let num: extern "C" fn(*mut c_void) -> u32 = vfn(stats, 13);
            let get_name: extern "C" fn(*mut c_void, u32) -> *const c_char = vfn(stats, 14);
            let get_disp: extern "C" fn(
                *mut c_void,
                *const c_char,
                *const c_char,
            ) -> *const c_char = vfn(stats, 11);
            let get_aut: extern "C" fn(*mut c_void, *const c_char, *mut u8, *mut u32) -> u8 =
                vfn(stats, 8);

            // Best-effort global achievement rarity (vtable 33 request, vtable 36 poll).
            // Fire the request first and enumerate while it is in flight; the bounded
            // wait + fill happens after the loop (wait_global_percentages).
            let req_global: extern "C" fn(*mut c_void) -> u64 = vfn(stats, 33);
            let get_pct: extern "C" fn(*mut c_void, *const c_char, *mut f32) -> u8 = vfn(stats, 36);
            let global_call = req_global(stats);
            let global_started = Instant::now();

            let key_name = CString::new("name").unwrap();
            let key_desc = CString::new("desc").unwrap();
            let key_hidden = CString::new("hidden").unwrap();
            let key_icon = CString::new("icon").unwrap();
            let key_icon_gray = CString::new("icon_gray").unwrap();

            let count = num(stats);
            // One schema read + parse serves both the achievement permissions and the
            // stat definitions below (the file is up to a few MB for big games).
            let schema = self.read_schema(app_id);
            // Reads stay lenient: a missing schema just means "no protection info",
            // so display every achievement as unprotected (the write path is the one
            // that must fail closed).
            let ach_perms = schema
                .as_ref()
                .and_then(|s| super::schema_ach_perms(s, app_id))
                .unwrap_or_default();
            let mut achievements = Vec::with_capacity(count as usize);
            for i in 0..count {
                let id_ptr = get_name(stats, i);
                if id_ptr.is_null() {
                    continue;
                }
                let id = cstr(id_ptr);
                if id.is_empty() {
                    continue;
                }
                let idc = match CString::new(id.clone()) {
                    Ok(c) => c,
                    Err(_) => continue,
                };

                let name = cstr(get_disp(stats, idc.as_ptr(), key_name.as_ptr()));
                let desc = cstr(get_disp(stats, idc.as_ptr(), key_desc.as_ptr()));
                let hidden = cstr(get_disp(stats, idc.as_ptr(), key_hidden.as_ptr())) == "1";
                let icon = cstr(get_disp(stats, idc.as_ptr(), key_icon.as_ptr()));
                let icon_gray = cstr(get_disp(stats, idc.as_ptr(), key_icon_gray.as_ptr()));

                let mut achieved: u8 = 0;
                let mut unlock_time: u32 = 0;
                get_aut(stats, idc.as_ptr(), &mut achieved, &mut unlock_time);

                let protected = (ach_perms.get(&id).copied().unwrap_or(0) & 3) != 0;
                achievements.push(AchievementInfo {
                    name: if name.is_empty() { id.clone() } else { name },
                    id,
                    protected,
                    desc,
                    hidden,
                    unlocked: achieved != 0,
                    unlock_time,
                    // Filled below once the global percentages have landed.
                    rarity: 0.0,
                    icon,
                    icon_gray,
                });
            }

            // Rarity last: the enumeration above gave the request a head start, so in
            // the common case the data is already here and this costs no waiting.
            if self.wait_global_percentages(stats, get_pct, global_call, global_started) {
                for a in &mut achievements {
                    let Ok(idc) = CString::new(a.id.as_str()) else {
                        continue;
                    };
                    let mut pct: f32 = 0.0;
                    get_pct(stats, idc.as_ptr(), &mut pct);
                    a.rarity = pct as f64;
                }
            }

            // ---- statistics ----
            let get_int: extern "C" fn(*mut c_void, *const c_char, *mut i32) -> u8 = vfn(stats, 1);
            let get_float: extern "C" fn(*mut c_void, *const c_char, *mut f32) -> u8 =
                vfn(stats, 0);
            let mut stat_infos = Vec::new();
            let stat_defs = schema
                .as_ref()
                .map(|s| self.stat_defs_from(s, app_id))
                .unwrap_or_default();
            for d in stat_defs {
                let idc = match CString::new(d.id.clone()) {
                    Ok(c) => c,
                    Err(_) => continue,
                };
                let value = if d.is_float {
                    let mut v: f32 = 0.0;
                    if get_float(stats, idc.as_ptr(), &mut v) == 0 {
                        continue;
                    }
                    v as f64
                } else {
                    let mut v: i32 = 0;
                    if get_int(stats, idc.as_ptr(), &mut v) == 0 {
                        continue;
                    }
                    v as f64
                };
                stat_infos.push(StatInfo {
                    id: d.id,
                    name: d.name,
                    value,
                    is_float: d.is_float,
                    protected: (d.permission & 2) != 0,
                    increment_only: d.increment_only,
                });
            }

            Ok(GameStats {
                app_id,
                name: self
                    .app_data(app_id, "name")
                    .unwrap_or_else(|| app_id.to_string()),
                achievements,
                stats: stat_infos,
            })
        }
    }

    pub fn write_stats(
        &self,
        app_id: u32,
        ach_changes: &[AchChange],
        stat_changes: &[StatChange],
    ) -> Result<WriteResult, String> {
        unsafe {
            let stats = self.prepare_stats()?;
            let set_ach: extern "C" fn(*mut c_void, *const c_char) -> u8 = vfn(stats, 6);
            let clear_ach: extern "C" fn(*mut c_void, *const c_char) -> u8 = vfn(stats, 7);
            let store: extern "C" fn(*mut c_void) -> u8 = vfn(stats, 9);

            let set_int: extern "C" fn(*mut c_void, *const c_char, i32) -> u8 = vfn(stats, 3);
            let set_float: extern "C" fn(*mut c_void, *const c_char, f32) -> u8 = vfn(stats, 2);

            // One schema read + parse for both the permission gate and the stat defs.
            let schema = self.read_schema(app_id);
            let mut applied = 0u32;
            let mut rejected: Vec<String> = Vec::new();
            if !ach_changes.is_empty() {
                // Fail closed: never modify schema-protected achievements, even if a
                // stale or crafted renderer payload asks us to (these are irreversible
                // Steam mutations). If the permission schema can't be read we can't tell
                // which achievements are protected, so refuse *all* achievement writes.
                match schema
                    .as_ref()
                    .and_then(|s| super::schema_ach_perms(s, app_id))
                {
                    Some(ach_perms) => {
                        for ch in ach_changes {
                            // Same `& 3` mask as the read path, but fail closed for
                            // unknown ids instead of assuming permission 0.
                            if !achievement_write_allowed(&ach_perms, &ch.id) {
                                rejected.push(ch.id.clone());
                                continue;
                            }
                            let idc = match CString::new(ch.id.clone()) {
                                Ok(c) => c,
                                Err(_) => continue,
                            };
                            let ok = if ch.unlock {
                                set_ach(stats, idc.as_ptr())
                            } else {
                                clear_ach(stats, idc.as_ptr())
                            };
                            if ok != 0 {
                                applied += 1;
                            }
                        }
                    }
                    None => {
                        return Err("無法讀取成就權限結構，已拒絕所有成就寫入".into());
                    }
                }
            }

            if !stat_changes.is_empty() {
                let defs = schema
                    .as_ref()
                    .map(|s| self.stat_defs_from(s, app_id))
                    .unwrap_or_default();
                let get_int: extern "C" fn(*mut c_void, *const c_char, *mut i32) -> u8 =
                    vfn(stats, 1);
                let get_float: extern "C" fn(*mut c_void, *const c_char, *mut f32) -> u8 =
                    vfn(stats, 0);
                for sc in stat_changes {
                    let Some(def) = writable_stat_def(&defs, sc) else {
                        rejected.push(sc.id.clone());
                        continue;
                    };
                    let idc = match CString::new(sc.id.clone()) {
                        Ok(c) => c,
                        Err(_) => continue,
                    };
                    let current = if def.is_float {
                        let mut v: f32 = 0.0;
                        if get_float(stats, idc.as_ptr(), &mut v) == 0 {
                            continue;
                        }
                        v as f64
                    } else {
                        let mut v: i32 = 0;
                        if get_int(stats, idc.as_ptr(), &mut v) == 0 {
                            continue;
                        }
                        v as f64
                    };
                    if !stat_value_is_valid(def, sc, current) {
                        rejected.push(sc.id.clone());
                        continue;
                    }
                    let ok = if def.is_float {
                        set_float(stats, idc.as_ptr(), sc.value as f32)
                    } else {
                        let Some(value) = stat_i32_value(sc) else {
                            continue;
                        };
                        set_int(stats, idc.as_ptr(), value)
                    };
                    if ok != 0 {
                        applied += 1;
                    }
                }
            }

            if store(stats) == 0 {
                return Err("StoreStats 失敗（變更未寫入）".into());
            }
            Ok(WriteResult {
                saved: applied,
                rejected,
            })
        }
    }
}

impl Drop for SteamClient {
    fn drop(&mut self) {
        unsafe {
            if !self.client.is_null() && self.pipe != 0 {
                // ReleaseSteamPipe (vtable 1)
                let f: extern "C" fn(*mut c_void, i32) -> u8 = vfn(self.client, 1);
                let _ = f(self.client, self.pipe);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{dylib_path, schema_path, user_stats_path};

    #[test]
    fn dylib_path_is_under_appbundle() {
        assert_eq!(
            dylib_path("/S"),
            "/S/Steam.AppBundle/Steam/Contents/MacOS/steamclient.dylib"
        );
    }

    #[test]
    fn cache_paths_use_forward_slashes() {
        assert_eq!(
            schema_path("/S", 42),
            "/S/appcache/stats/UserGameStatsSchema_42.bin"
        );
        assert_eq!(
            user_stats_path("/S", 7, 42),
            "/S/appcache/stats/UserGameStats_7_42.bin"
        );
    }
}
