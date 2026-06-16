//! macOS port of the internal-steamclient read layer. Loads steamclient.dylib
//! via dlopen and mirrors the read surface of the Windows `imp` module. Writes
//! are deferred this milestone (see lib.rs `write_game`).

use super::{AchievementInfo, GameStats, OwnedGame, StatInfo};
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
