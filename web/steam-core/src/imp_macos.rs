//! macOS port of the internal-steamclient read layer. Loads steamclient.dylib
//! via dlopen and mirrors the read surface of the Windows `imp` module. Writes
//! are deferred this milestone (see lib.rs `write_game`).

use super::{AchChange, AchievementInfo, GameStats, OwnedGame, StatChange, StatInfo};
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

fn find_account_id(root: &str) -> Option<u32> {
    for entry in std::fs::read_dir(format!("{root}/userdata")).ok()?.flatten() {
        if let Some(id) = entry.file_name().to_str().and_then(|n| n.parse::<u32>().ok()) {
            if id != 0 {
                return Some(id);
            }
        }
    }
    None
}

struct StatDef {
    id: String,
    name: String,
    is_float: bool,
    permission: i32,
    increment_only: bool,
}

fn resolve_stat_type(stat: &super::Kv) -> u8 {
    let raw = stat
        .child("type")
        .map(|n| {
            if let Some(s) = n.as_str() {
                s.parse::<i32>().unwrap_or_else(|_| match s.to_ascii_lowercase().as_str() {
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
        1 => 1,      // Integer
        2 | 3 => 2,  // Float / AverageRate
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
pub fn completion_local(app_id: u32) -> Option<(u32, u32)> {
    let root = steam_root()?;

    let schema = std::fs::read(schema_path(&root, app_id)).ok()?;
    let schema_kv = super::parse_kv(&schema)?;
    let stats = schema_kv.child(&app_id.to_string())?.child("stats")?;
    let total = count_children(stats, "bits");
    if total == 0 {
        return None;
    }

    let earned = find_account_id(&root)
        .and_then(|account_id| std::fs::read(user_stats_path(&root, account_id, app_id)).ok())
        .and_then(|d| super::parse_kv(&d))
        .and_then(|kv| kv.child("cache").map(|c| count_children(c, "AchievementTimes")))
        .unwrap_or(0);

    Some((earned.min(total), total))
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

            Ok(SteamClient { module, client, pipe, user, apps008, apps001, root })
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
            let n = f(self.apps001, app_id, k.as_ptr(), buf.as_mut_ptr() as *mut c_char, buf.len() as i32);
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
                kind: if kind.is_empty() { "normal".into() } else { kind.clone() },
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
            let mut msg = CallbackMsg { user: 0, id: 0, param: std::ptr::null_mut(), param_size: 0 };
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
        let want_app: u32 = std::env::var("SteamAppId").ok().and_then(|s| s.parse().ok()).unwrap_or(0);
        let num: extern "C" fn(*mut c_void) -> u32 = vfn(stats, 13);

        let (Ok(get_cb), Ok(free_cb)) = (
            self.export::<extern "C" fn(i32, *mut CallbackMsg, *mut i32) -> u8>("Steam_BGetCallback"),
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
        loop {
            let mut got_ok = false;
            let mut msg = CallbackMsg { user: 0, id: 0, param: std::ptr::null_mut(), param_size: 0 };
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
            std::thread::sleep(Duration::from_millis(80));
        }
    }

    /// ISteamApps008.GetCurrentGameLanguage (vtable 4).
    fn game_language(&self) -> String {
        unsafe {
            let f: extern "C" fn(*mut c_void) -> *const c_char = vfn(self.apps008, 4);
            cstr(f(self.apps008))
        }
    }

    fn read_ach_perms(&self, app_id: u32) -> std::collections::HashMap<String, i32> {
        let mut out = std::collections::HashMap::new();
        let Ok(data) = std::fs::read(schema_path(&self.root, app_id)) else { return out };
        let Some(root) = super::parse_kv(&data) else { return out };
        let Some(stats) = root.child(&app_id.to_string()).and_then(|a| a.child("stats")) else {
            return out;
        };
        for group in &stats.children {
            let Some(bits) = group.child("bits") else { continue };
            for bit in &bits.children {
                if let Some(id) = bit.child("name").and_then(|n| n.as_str()) {
                    let perm = bit.child("permission").map(|p| p.as_int()).unwrap_or(0);
                    out.insert(id.to_string(), perm);
                }
            }
        }
        out
    }

    fn read_stat_defs(&self, app_id: u32) -> Vec<StatDef> {
        let Ok(data) = std::fs::read(schema_path(&self.root, app_id)) else {
            return Vec::new();
        };
        let Some(root) = super::parse_kv(&data) else {
            return Vec::new();
        };
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
            let id = stat.child("name").and_then(|n| n.as_str()).unwrap_or("").to_string();
            if id.is_empty() {
                continue;
            }
            defs.push(StatDef {
                name: resolve_display_name(stat, &lang, &id),
                is_float: kind == 2,
                permission: stat.child("permission").map(|p| p.as_int()).unwrap_or(0),
                increment_only: stat.child("incrementonly").map(|p| p.as_bool()).unwrap_or(false),
                id,
            });
        }
        defs
    }

    pub fn read_stats(&self, app_id: u32) -> Result<GameStats, String> {
        unsafe {
            let stats = self.prepare_stats()?;

            let num: extern "C" fn(*mut c_void) -> u32 = vfn(stats, 13);
            let get_name: extern "C" fn(*mut c_void, u32) -> *const c_char = vfn(stats, 14);
            let get_disp: extern "C" fn(*mut c_void, *const c_char, *const c_char) -> *const c_char =
                vfn(stats, 11);
            let get_aut: extern "C" fn(*mut c_void, *const c_char, *mut u8, *mut u32) -> u8 =
                vfn(stats, 8);

            // Best-effort global achievement rarity (vtable 33 request, vtable 36 poll).
            let req_global: extern "C" fn(*mut c_void) -> u64 = vfn(stats, 33);
            let get_pct: extern "C" fn(*mut c_void, *const c_char, *mut f32) -> u8 = vfn(stats, 36);
            req_global(stats);
            let mut have_global = false;
            let probe_ptr = if num(stats) > 0 { get_name(stats, 0) } else { std::ptr::null() };
            if !probe_ptr.is_null() {
                if let Ok(probe) = CString::new(cstr(probe_ptr)) {
                    if let (Ok(get_cb), Ok(free_cb)) = (
                        self.export::<extern "C" fn(i32, *mut CallbackMsg, *mut i32) -> u8>("Steam_BGetCallback"),
                        self.export::<extern "C" fn(i32) -> u8>("Steam_FreeLastCallback"),
                    ) {
                        let start = Instant::now();
                        while start.elapsed() < Duration::from_secs(8) {
                            let mut m = CallbackMsg { user: 0, id: 0, param: std::ptr::null_mut(), param_size: 0 };
                            let mut c: i32 = 0;
                            while get_cb(self.pipe, &mut m, &mut c) != 0 {
                                free_cb(self.pipe);
                            }
                            let mut p: f32 = 0.0;
                            if get_pct(stats, probe.as_ptr(), &mut p) != 0 {
                                have_global = true;
                                break;
                            }
                            std::thread::sleep(Duration::from_millis(50));
                        }
                    }
                }
            }

            let key_name = CString::new("name").unwrap();
            let key_desc = CString::new("desc").unwrap();
            let key_hidden = CString::new("hidden").unwrap();
            let key_icon = CString::new("icon").unwrap();
            let key_icon_gray = CString::new("icon_gray").unwrap();

            let count = num(stats);
            let ach_perms = self.read_ach_perms(app_id);
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
                let idc = CString::new(id.clone()).unwrap();

                let name = cstr(get_disp(stats, idc.as_ptr(), key_name.as_ptr()));
                let desc = cstr(get_disp(stats, idc.as_ptr(), key_desc.as_ptr()));
                let hidden = cstr(get_disp(stats, idc.as_ptr(), key_hidden.as_ptr())) == "1";
                let icon = cstr(get_disp(stats, idc.as_ptr(), key_icon.as_ptr()));
                let icon_gray = cstr(get_disp(stats, idc.as_ptr(), key_icon_gray.as_ptr()));

                let mut achieved: u8 = 0;
                let mut unlock_time: u32 = 0;
                get_aut(stats, idc.as_ptr(), &mut achieved, &mut unlock_time);

                let mut rarity: f32 = 0.0;
                if have_global {
                    get_pct(stats, idc.as_ptr(), &mut rarity);
                }

                let protected = (ach_perms.get(&id).copied().unwrap_or(0) & 3) != 0;
                achievements.push(AchievementInfo {
                    name: if name.is_empty() { id.clone() } else { name },
                    id,
                    protected,
                    desc,
                    hidden,
                    unlocked: achieved != 0,
                    unlock_time,
                    rarity: rarity as f64,
                    icon,
                    icon_gray,
                });
            }

            // ---- statistics ----
            let get_int: extern "C" fn(*mut c_void, *const c_char, *mut i32) -> u8 = vfn(stats, 1);
            let get_float: extern "C" fn(*mut c_void, *const c_char, *mut f32) -> u8 = vfn(stats, 0);
            let mut stat_infos = Vec::new();
            for d in self.read_stat_defs(app_id) {
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
                name: self.app_data(app_id, "name").unwrap_or_else(|| app_id.to_string()),
                achievements,
                stats: stat_infos,
            })
        }
    }

    pub fn count_achievements(&self) -> Result<(u32, u32), String> {
        unsafe {
            let stats = self.prepare_stats()?;
            let num: extern "C" fn(*mut c_void) -> u32 = vfn(stats, 13);
            let get_name: extern "C" fn(*mut c_void, u32) -> *const c_char = vfn(stats, 14);
            let get_ach: extern "C" fn(*mut c_void, *const c_char, *mut u8) -> u8 = vfn(stats, 5);
            let total = num(stats);
            let mut earned = 0u32;
            for i in 0..total {
                let id_ptr = get_name(stats, i);
                if id_ptr.is_null() {
                    continue;
                }
                let id = cstr(id_ptr);
                if id.is_empty() {
                    continue;
                }
                let idc = match CString::new(id) {
                    Ok(c) => c,
                    Err(_) => continue,
                };
                let mut achieved: u8 = 0;
                if get_ach(stats, idc.as_ptr(), &mut achieved) != 0 && achieved != 0 {
                    earned += 1;
                }
            }
            Ok((earned, total))
        }
    }

    pub fn write_stats(
        &self,
        app_id: u32,
        ach_changes: &[AchChange],
        stat_changes: &[StatChange],
    ) -> Result<u32, String> {
        unsafe {
            let stats = self.prepare_stats()?;
            let set_ach: extern "C" fn(*mut c_void, *const c_char) -> u8 = vfn(stats, 6);
            let clear_ach: extern "C" fn(*mut c_void, *const c_char) -> u8 = vfn(stats, 7);
            let store: extern "C" fn(*mut c_void) -> u8 = vfn(stats, 9);

            let set_int: extern "C" fn(*mut c_void, *const c_char, i32) -> u8 = vfn(stats, 3);
            let set_float: extern "C" fn(*mut c_void, *const c_char, f32) -> u8 = vfn(stats, 2);

            let mut applied = 0u32;
            for ch in ach_changes {
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

            if !stat_changes.is_empty() {
                let floats: std::collections::HashSet<String> = self
                    .read_stat_defs(app_id)
                    .into_iter()
                    .filter(|d| d.is_float)
                    .map(|d| d.id)
                    .collect();
                for sc in stat_changes {
                    let idc = match CString::new(sc.id.clone()) {
                        Ok(c) => c,
                        Err(_) => continue,
                    };
                    let ok = if floats.contains(&sc.id) {
                        set_float(stats, idc.as_ptr(), sc.value as f32)
                    } else {
                        set_int(stats, idc.as_ptr(), sc.value as i32)
                    };
                    if ok != 0 {
                        applied += 1;
                    }
                }
            }

            if store(stats) == 0 {
                return Err("StoreStats 失敗（變更未寫入）".into());
            }
            Ok(applied)
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
        assert_eq!(schema_path("/S", 42), "/S/appcache/stats/UserGameStatsSchema_42.bin");
        assert_eq!(user_stats_path("/S", 7, 42), "/S/appcache/stats/UserGameStats_7_42.bin");
    }
}
