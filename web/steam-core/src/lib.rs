//! Local-Steam read/write layer using the **internal** `steamclient.dll`
//! interfaces (not the public Steamworks SDK), ported from gibbed's SAM so the
//! whole owned-games library is browsable and per-game achievements/stats are
//! readable and writable.
//!
//! Per-game work (`read_game` / `write_game`) must run in a process whose
//! `SteamAppId` env var is set to that app BEFORE steamclient is loaded — exactly
//! how SAM uses a separate process per game.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
pub struct OwnedGame {
    pub app_id: u32,
    pub name: String,
    #[serde(rename = "type")]
    pub kind: String,
}

/// Parse the SAM games.xml: entries are `<game>APPID</game>` or
/// `<game type="demo">APPID</game>`. Returns (appId, type) pairs.
pub fn parse_app_list(xml: &str) -> Vec<(u32, String)> {
    let mut out = Vec::new();
    for chunk in xml.split("<game").skip(1) {
        let Some(gt) = chunk.find('>') else { continue };
        let head = &chunk[..gt];
        let kind = head
            .find("type=\"")
            .and_then(|i| {
                let rest = &head[i + 6..];
                rest.find('"').map(|j| rest[..j].to_string())
            })
            .unwrap_or_default();
        let body = &chunk[gt + 1..];
        let Some(end) = body.find("</game>") else {
            continue;
        };
        if let Ok(id) = body[..end].trim().parse::<u32>() {
            out.push((id, kind));
        }
    }
    out
}

/// Download + parse the SAM master app list (all apps with stats/achievements).
pub fn fetch_app_list() -> Result<Vec<(u32, String)>, String> {
    let body = ureq::get("https://gib.me/sam/games.xml")
        .timeout(std::time::Duration::from_secs(20))
        .call()
        .map_err(|e| format!("下載 games.xml 失敗：{e}"))?
        .into_string()
        .map_err(|e| e.to_string())?;
    let list = parse_app_list(&body);
    if list.is_empty() {
        Err("games.xml 解析為空".into())
    } else {
        Ok(list)
    }
}

/// Resolve a game's real header-image URL via Steam's appdetails API. Newer games
/// serve art from content-hash paths that can't be guessed from the appid, so this
/// is the only reliable source for them. Network read-only; None on any failure.
pub fn fetch_header_url(app_id: u32) -> Option<String> {
    let url =
        format!("https://store.steampowered.com/api/appdetails?appids={app_id}&filters=basic");
    let body = ureq::get(&url)
        .timeout(std::time::Duration::from_secs(10))
        .call()
        .ok()?
        .into_string()
        .ok()?;
    let v: serde_json::Value = serde_json::from_str(&body).ok()?;
    let header = v
        .get(app_id.to_string())?
        .get("data")?
        .get("header_image")?
        .as_str()?;
    (!header.is_empty()).then(|| header.to_string())
}

#[derive(Debug, Clone, Serialize)]
pub struct AchievementInfo {
    /// Steam achievement API name (stable id).
    pub id: String,
    pub name: String,
    pub desc: String,
    pub hidden: bool,
    pub unlocked: bool,
    /// Unlock time (unix seconds), 0 if locked.
    pub unlock_time: u32,
    /// Global achieved percentage (0..100), 0 if unavailable.
    pub rarity: f64,
    /// Icon file name (unlocked) from the display attributes.
    pub icon: String,
    /// Icon file name (locked/gray).
    pub icon_gray: String,
    /// Schema permission bits set (Steam/Valve-controlled) → UI blocks toggling.
    pub protected: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct GameStats {
    pub app_id: u32,
    pub name: String,
    pub achievements: Vec<AchievementInfo>,
    pub stats: Vec<StatInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AchChange {
    pub id: String,
    pub unlock: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct StatInfo {
    pub id: String,
    pub name: String,
    pub value: f64,
    pub is_float: bool,
    pub protected: bool,
    pub increment_only: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StatChange {
    pub id: String,
    pub value: f64,
}

#[derive(Debug, Clone)]
struct StatDef {
    id: String,
    name: String,
    is_float: bool,
    permission: i32,
    increment_only: bool,
    min_value: f64,
    max_value: f64,
    max_change: f64,
}

fn writable_stat_def<'a>(defs: &'a [StatDef], change: &StatChange) -> Option<&'a StatDef> {
    defs.iter()
        .find(|d| d.id == change.id)
        .filter(|d| (d.permission & 2) == 0)
}

fn stat_min_default(is_float: bool) -> f64 {
    if is_float {
        f32::MIN as f64
    } else {
        i32::MIN as f64
    }
}

fn stat_max_default(is_float: bool) -> f64 {
    if is_float {
        f32::MAX as f64
    } else {
        i32::MAX as f64
    }
}

fn stat_bound(stat: &Kv, key: &str, default: f64) -> f64 {
    let value = stat.child(key).map(Kv::as_float).unwrap_or(default);
    if value.is_finite() {
        value
    } else {
        default
    }
}

fn stat_i32_value(change: &StatChange) -> Option<i32> {
    let value = change.value;
    if !value.is_finite() || value.fract() != 0.0 {
        return None;
    }
    if value < i32::MIN as f64 || value > i32::MAX as f64 {
        return None;
    }
    Some(value as i32)
}

fn stat_value_is_valid(def: &StatDef, change: &StatChange, current: f64) -> bool {
    let value = change.value;
    if !value.is_finite() || !current.is_finite() {
        return false;
    }
    if !def.is_float && stat_i32_value(change).is_none() {
        return false;
    }
    if def.is_float && (value < f32::MIN as f64 || value > f32::MAX as f64) {
        return false;
    }
    if value < def.min_value || value > def.max_value {
        return false;
    }
    if def.increment_only && value < current {
        return false;
    }
    def.max_change <= 0.0 || (value - current).abs() <= def.max_change
}

#[cfg(test)]
fn choose_account_id<I, F>(accounts: I, has_game_cache: F) -> Option<u32>
where
    I: IntoIterator<Item = u32>,
    F: FnMut(u32) -> bool,
{
    choose_account_id_with_preferred(accounts, None, has_game_cache)
}

fn choose_account_id_with_preferred<I, F>(
    accounts: I,
    preferred: Option<u32>,
    mut has_game_cache: F,
) -> Option<u32>
where
    I: IntoIterator<Item = u32>,
    F: FnMut(u32) -> bool,
{
    let ids: Vec<u32> = accounts.into_iter().filter(|id| *id != 0).collect();
    if let Some(id) = preferred.filter(|id| ids.contains(id)) {
        return Some(id);
    }
    ids.iter()
        .copied()
        .find(|id| has_game_cache(*id))
        .or_else(|| ids.first().copied())
}

fn account_id_from_steam_id(steam_id: u64) -> Option<u32> {
    let account_id = (steam_id & 0xFFFF_FFFF) as u32;
    (account_id != 0).then_some(account_id)
}

fn parse_most_recent_account_id(loginusers_vdf: &str, accounts: &[u32]) -> Option<u32> {
    let tokens = text_vdf_tokens(loginusers_vdf);
    let mut i = 0usize;
    while i + 1 < tokens.len() {
        let Some(account_id) = tokens[i]
            .parse::<u64>()
            .ok()
            .and_then(account_id_from_steam_id)
            .filter(|id| accounts.contains(id))
        else {
            i += 1;
            continue;
        };
        if tokens.get(i + 1).map(String::as_str) != Some("{") {
            i += 1;
            continue;
        }
        i += 2;
        let mut depth = 1usize;
        while i + 1 < tokens.len() && depth > 0 {
            match tokens[i].as_str() {
                "{" => depth += 1,
                "}" => depth -= 1,
                key if depth == 1 && key.eq_ignore_ascii_case("MostRecent") => {
                    if tokens.get(i + 1).map(String::as_str) == Some("1") {
                        return Some(account_id);
                    }
                    i += 1;
                }
                _ => {}
            }
            i += 1;
        }
    }
    None
}

/// Tokenize text VDF into quoted-string / `{` / `}` tokens (skips `//` comments).
fn text_vdf_tokens(s: &str) -> Vec<String> {
    let b = s.as_bytes();
    let mut i = 0usize;
    let mut out = Vec::new();
    while i < b.len() {
        match b[i] {
            b'"' => {
                i += 1;
                let start = i;
                while i < b.len() && b[i] != b'"' {
                    if b[i] == b'\\' {
                        i += 1;
                    }
                    i += 1;
                }
                out.push(s[start..i.min(s.len())].to_string());
                i += 1;
            }
            b'{' => {
                out.push("{".into());
                i += 1;
            }
            b'}' => {
                out.push("}".into());
                i += 1;
            }
            b'/' if i + 1 < b.len() && b[i + 1] == b'/' => {
                while i < b.len() && b[i] != b'\n' {
                    i += 1;
                }
            }
            _ => i += 1,
        }
    }
    out
}

// ---------- Valve binary KeyValues (for UserGameStatsSchema_<appid>.bin) ----------
// Strings are UTF-8 null-terminated; numbers little-endian; nested objects end at
// a type byte of 8.

enum KvValue {
    None,
    Str(String),
    Int(i32),
    UInt64(u64),
    Float(f32),
    U32(u32),
}

struct Kv {
    name: String,
    value: KvValue,
    children: Vec<Kv>,
}

impl Kv {
    fn child(&self, key: &str) -> Option<&Kv> {
        self.children
            .iter()
            .find(|c| c.name.eq_ignore_ascii_case(key))
    }
    fn as_str(&self) -> Option<&str> {
        if let KvValue::Str(s) = &self.value {
            Some(s)
        } else {
            None
        }
    }
    fn as_int(&self) -> i32 {
        match &self.value {
            KvValue::Int(i) => *i,
            KvValue::U32(u) => *u as i32,
            KvValue::UInt64(u) => *u as i32,
            KvValue::Float(f) => *f as i32,
            KvValue::Str(s) => s.parse().unwrap_or(0),
            KvValue::None => 0,
        }
    }
    fn as_float(&self) -> f64 {
        match &self.value {
            KvValue::Int(i) => *i as f64,
            KvValue::U32(u) => *u as f64,
            KvValue::UInt64(u) => *u as f64,
            KvValue::Float(f) => *f as f64,
            KvValue::Str(s) => s.parse().unwrap_or(0.0),
            KvValue::None => 0.0,
        }
    }
    fn as_bool(&self) -> bool {
        self.as_int() != 0
    }
}

struct KvReader<'a> {
    data: &'a [u8],
    pos: usize,
}

impl<'a> KvReader<'a> {
    fn u8(&mut self) -> Option<u8> {
        let b = *self.data.get(self.pos)?;
        self.pos += 1;
        Some(b)
    }
    fn take(&mut self, n: usize) -> Option<&'a [u8]> {
        if self.pos + n > self.data.len() {
            return None;
        }
        let s = &self.data[self.pos..self.pos + n];
        self.pos += n;
        Some(s)
    }
    fn cstr(&mut self) -> Option<String> {
        let start = self.pos;
        while *self.data.get(self.pos)? != 0 {
            self.pos += 1;
        }
        let s = String::from_utf8_lossy(&self.data[start..self.pos]).into_owned();
        self.pos += 1; // skip the null
        Some(s)
    }
    fn i32(&mut self) -> Option<i32> {
        Some(i32::from_le_bytes(self.take(4)?.try_into().ok()?))
    }
    fn u32(&mut self) -> Option<u32> {
        Some(u32::from_le_bytes(self.take(4)?.try_into().ok()?))
    }
    fn u64(&mut self) -> Option<u64> {
        Some(u64::from_le_bytes(self.take(8)?.try_into().ok()?))
    }
    fn f32(&mut self) -> Option<f32> {
        Some(f32::from_le_bytes(self.take(4)?.try_into().ok()?))
    }
}

fn parse_kv_children(r: &mut KvReader) -> Option<Vec<Kv>> {
    let mut out = Vec::new();
    loop {
        let t = r.u8()?;
        if t == 8 {
            break; // End
        }
        let name = r.cstr()?;
        let (value, children) = match t {
            0 => (KvValue::None, parse_kv_children(r)?),
            1 => (KvValue::Str(r.cstr()?), Vec::new()),
            2 => (KvValue::Int(r.i32()?), Vec::new()),
            3 => (KvValue::Float(r.f32()?), Vec::new()),
            4 | 6 => (KvValue::U32(r.u32()?), Vec::new()), // Pointer / Color
            7 => (KvValue::UInt64(r.u64()?), Vec::new()),
            _ => return None, // WideString / unknown
        };
        out.push(Kv {
            name,
            value,
            children,
        });
    }
    Some(out)
}

fn parse_kv(data: &[u8]) -> Option<Kv> {
    let mut r = KvReader { data, pos: 0 };
    let children = parse_kv_children(&mut r)?;
    Some(Kv {
        name: "<root>".into(),
        value: KvValue::None,
        children,
    })
}

#[cfg(test)]
mod tests {
    use super::{
        choose_account_id, stat_i32_value, stat_value_is_valid, writable_stat_def, StatChange,
        StatDef,
    };

    fn stat(id: &str, is_float: bool, permission: i32, increment_only: bool) -> StatDef {
        StatDef {
            id: id.to_string(),
            name: id.to_string(),
            is_float,
            permission,
            increment_only,
            min_value: if is_float { -10.0 } else { 0.0 },
            max_value: if is_float { 10.0 } else { 100.0 },
            max_change: 0.0,
        }
    }

    #[test]
    fn writable_stat_def_rejects_protected_and_unknown_stats() {
        let defs = vec![
            stat("kills", false, 0, false),
            stat("rank", false, 2, false),
        ];

        let writable = writable_stat_def(
            &defs,
            &StatChange {
                id: "kills".into(),
                value: 7.0,
            },
        );
        assert_eq!(writable.map(|d| d.id.as_str()), Some("kills"));

        let protected = writable_stat_def(
            &defs,
            &StatChange {
                id: "rank".into(),
                value: 9.0,
            },
        );
        assert!(protected.is_none());

        let unknown = writable_stat_def(
            &defs,
            &StatChange {
                id: "crafted".into(),
                value: 1.0,
            },
        );
        assert!(unknown.is_none());
    }

    #[test]
    fn stat_value_validation_enforces_schema_bounds_and_integer_shape() {
        let mut int_def = stat("kills", false, 0, false);
        int_def.max_change = 10.0;

        assert!(stat_value_is_valid(
            &int_def,
            &StatChange {
                id: "kills".into(),
                value: 15.0,
            },
            10.0,
        ));
        assert!(!stat_value_is_valid(
            &int_def,
            &StatChange {
                id: "kills".into(),
                value: 15.5,
            },
            10.0,
        ));
        assert!(!stat_value_is_valid(
            &int_def,
            &StatChange {
                id: "kills".into(),
                value: 25.0,
            },
            10.0,
        ));
        assert!(!stat_value_is_valid(
            &int_def,
            &StatChange {
                id: "kills".into(),
                value: 101.0,
            },
            95.0,
        ));
    }

    #[test]
    fn stat_value_validation_blocks_increment_only_decreases_and_non_finite_values() {
        let inc_def = stat("xp", true, 0, true);
        assert!(!stat_value_is_valid(
            &inc_def,
            &StatChange {
                id: "xp".into(),
                value: 4.0,
            },
            5.0,
        ));
        assert!(!stat_value_is_valid(
            &inc_def,
            &StatChange {
                id: "xp".into(),
                value: f64::NAN,
            },
            5.0,
        ));
        assert_eq!(
            stat_i32_value(&StatChange {
                id: "xp".into(),
                value: 7.0,
            }),
            Some(7),
        );
    }

    #[test]
    fn choose_account_id_prefers_account_with_game_cache() {
        let accounts = [101, 202, 303];
        let chosen = choose_account_id(accounts, |id| id == 202);
        assert_eq!(chosen, Some(202));
    }

    #[test]
    fn choose_account_id_falls_back_to_first_account() {
        let accounts = [101, 202, 303];
        let chosen = choose_account_id(accounts, |_| false);
        assert_eq!(chosen, Some(101));
    }
}

#[cfg(windows)]
mod imp {
    use super::{
        choose_account_id_with_preferred, parse_most_recent_account_id, stat_bound,
        stat_i32_value, stat_max_default, stat_min_default, stat_value_is_valid, text_vdf_tokens,
        writable_stat_def, AchChange, AchievementInfo, GameStats, OwnedGame, StatChange, StatDef,
        StatInfo,
    };
    use std::ffi::{c_char, c_void, CStr, CString};
    use std::path::Path;
    use std::time::{Duration, Instant};

    #[allow(non_snake_case)]
    extern "system" {
        fn SetDllDirectoryW(path: *const u16) -> i32;
        fn LoadLibraryExW(name: *const u16, file: *mut c_void, flags: u32) -> *mut c_void;
        fn GetProcAddress(module: *mut c_void, name: *const c_char) -> *const c_void;
    }
    const LOAD_WITH_ALTERED_SEARCH_PATH: u32 = 0x08;

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

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    unsafe fn cstr(p: *const c_char) -> String {
        if p.is_null() {
            return String::new();
        }
        CStr::from_ptr(p).to_string_lossy().into_owned()
    }

    fn install_path() -> Option<String> {
        use winreg::enums::*;
        use winreg::RegKey;
        if let Ok(k) = RegKey::predef(HKEY_CURRENT_USER).open_subkey(r"Software\Valve\Steam") {
            if let Ok(p) = k.get_value::<String, _>("SteamPath") {
                if !p.is_empty() {
                    return Some(p.replace('/', "\\"));
                }
            }
        }
        if let Ok(k) = RegKey::predef(HKEY_LOCAL_MACHINE)
            .open_subkey_with_flags(r"SOFTWARE\Valve\Steam", KEY_READ | KEY_WOW64_32KEY)
        {
            if let Ok(p) = k.get_value::<String, _>("InstallPath") {
                if !p.is_empty() {
                    return Some(p);
                }
            }
        }
        None
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
        // localized: try the game language, then english, then any child
        name_node
            .child(lang)
            .and_then(|c| c.as_str())
            .or_else(|| name_node.child("english").and_then(|c| c.as_str()))
            .or_else(|| name_node.children.iter().find_map(|c| c.as_str()))
            .unwrap_or(fallback)
            .to_string()
    }

    fn account_ids(install: &str) -> Vec<u32> {
        let mut ids: Vec<u32> = std::fs::read_dir(format!(r"{install}\userdata"))
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

    fn user_stats_path(install: &str, account_id: u32, app_id: u32) -> String {
        format!(r"{install}\appcache\stats\UserGameStats_{account_id}_{app_id}.bin")
    }

    fn most_recent_account_id(install: &str, accounts: &[u32]) -> Option<u32> {
        let path = format!(r"{install}\config\loginusers.vdf");
        let txt = std::fs::read_to_string(path).ok()?;
        parse_most_recent_account_id(&txt, accounts)
    }

    fn find_account_id(install: &str) -> Option<u32> {
        let accounts = account_ids(install);
        let preferred = most_recent_account_id(install, &accounts);
        choose_account_id_with_preferred(accounts, preferred, |_| false)
    }

    fn find_account_id_for_game(install: &str, app_id: u32) -> Option<u32> {
        let accounts = account_ids(install);
        let preferred = most_recent_account_id(install, &accounts);
        choose_account_id_with_preferred(accounts, preferred, |account_id| {
            Path::new(&user_stats_path(install, account_id, app_id)).is_file()
        })
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
        let install = install_path()?;

        // total = achievement "bits" defined in the schema
        let schema = std::fs::read(format!(
            r"{install}\appcache\stats\UserGameStatsSchema_{app_id}.bin"
        ))
        .ok()?;
        let schema_kv = super::parse_kv(&schema)?;
        let stats = schema_kv.child(&app_id.to_string())?.child("stats")?;
        let total = count_children(stats, "bits");
        if total == 0 {
            return None;
        }

        // earned = AchievementTimes entries in the per-user cache
        let earned = find_account_id_for_game(&install, app_id)
            .and_then(|account_id| {
                std::fs::read(user_stats_path(&install, account_id, app_id)).ok()
            })
            .and_then(|d| super::parse_kv(&d))
            .and_then(|kv| {
                kv.child("cache")
                    .map(|c| count_children(c, "AchievementTimes"))
            })
            .unwrap_or(0);

        Some((earned.min(total), total))
    }

    // ---- user library categories (parsed from sharedconfig.vdf, a text VDF) ----

    enum VdfVal {
        Str(String),
        Obj(Vec<(String, VdfVal)>),
    }

    fn parse_vdf(tokens: &[String], pos: &mut usize) -> Vec<(String, VdfVal)> {
        let mut out = Vec::new();
        while *pos < tokens.len() {
            if tokens[*pos] == "}" {
                *pos += 1;
                break;
            }
            let key = tokens[*pos].clone();
            *pos += 1;
            if *pos >= tokens.len() {
                break;
            }
            if tokens[*pos] == "{" {
                *pos += 1;
                out.push((key, VdfVal::Obj(parse_vdf(tokens, pos))));
            } else {
                out.push((key, VdfVal::Str(tokens[*pos].clone())));
                *pos += 1;
            }
        }
        out
    }

    /// First object anywhere under `node` with the given key (case-insensitive).
    fn vdf_find<'a>(node: &'a [(String, VdfVal)], key: &str) -> Option<&'a Vec<(String, VdfVal)>> {
        for (k, v) in node {
            if let VdfVal::Obj(children) = v {
                if k.eq_ignore_ascii_case(key) {
                    return Some(children);
                }
                if let Some(found) = vdf_find(children, key) {
                    return Some(found);
                }
            }
        }
        None
    }

    fn vdf_child<'a>(node: &'a [(String, VdfVal)], key: &str) -> Option<&'a Vec<(String, VdfVal)>> {
        node.iter().find_map(|(k, v)| match v {
            VdfVal::Obj(c) if k.eq_ignore_ascii_case(key) => Some(c),
            _ => None,
        })
    }

    /// Merge the user's modern library Collections (cloud-storage JSON) with the
    /// legacy sharedconfig.vdf categories into appId -> category names.
    fn collect_categories(
        install: &str,
        account: u32,
        map: &mut std::collections::HashMap<u32, std::collections::BTreeSet<String>>,
    ) {
        // 1) Modern Collections: config/cloudstorage/cloud-storage-namespace-1.json
        //    is a JSON array of [key, entry]; each `user-collections.*` entry has a
        //    JSON `value` string of { name, added: [appid, ...] }. Manual collections
        //    list their apps; pure dynamic (filter) collections have no `added`.
        let json = format!(
            r"{install}\userdata\{account}\config\cloudstorage\cloud-storage-namespace-1.json"
        );
        if let Ok(txt) = std::fs::read_to_string(&json) {
            if let Ok(root) = serde_json::from_str::<serde_json::Value>(&txt) {
                for pair in root.as_array().into_iter().flatten() {
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
            }
        }

        // 2) Legacy categories: userdata/<id>/7/remote/sharedconfig.vdf (apps/<id>/tags).
        let vdf = format!(r"{install}\userdata\{account}\7\remote\sharedconfig.vdf");
        if let Ok(txt) = std::fs::read_to_string(&vdf) {
            let tokens = text_vdf_tokens(&txt);
            let mut pos = 0;
            let tree = parse_vdf(&tokens, &mut pos);
            if let Some(apps) = vdf_find(&tree, "apps") {
                for (app_str, v) in apps {
                    let VdfVal::Obj(app) = v else { continue };
                    let Ok(app_id) = app_str.parse::<u32>() else {
                        continue;
                    };
                    if let Some(tags) = vdf_child(app, "tags") {
                        for (_, tv) in tags {
                            if let VdfVal::Str(s) = tv {
                                if !s.is_empty() {
                                    map.entry(app_id).or_default().insert(s.clone());
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    /// The user's Steam library categories per owned app — modern Collections +
    /// legacy sharedconfig, merged. Read-only; no Steam connection.
    pub fn read_categories() -> Vec<(u32, Vec<String>)> {
        let Some(install) = install_path() else {
            return Vec::new();
        };
        let Some(account) = find_account_id(&install) else {
            return Vec::new();
        };
        let mut map: std::collections::HashMap<u32, std::collections::BTreeSet<String>> =
            std::collections::HashMap::new();
        collect_categories(&install, account, &mut map);
        map.into_iter()
            .map(|(id, set)| (id, set.into_iter().collect()))
            .collect()
    }

    pub struct SteamClient {
        module: *mut c_void,
        client: *mut c_void,
        pipe: i32,
        user: i32,
        apps008: *mut c_void,
        apps001: *mut c_void,
        install: String,
    }

    impl SteamClient {
        pub fn connect() -> Result<Self, String> {
            let install = install_path().ok_or("找不到 Steam 安裝路徑（請確認已安裝 Steam）")?;
            unsafe {
                let search = format!(r"{install};{install}\bin");
                SetDllDirectoryW(wide(&search).as_ptr());

                // 64-bit process needs steamclient64.dll; the bare one is 32-bit.
                let dll_name = if cfg!(target_pointer_width = "64") {
                    "steamclient64.dll"
                } else {
                    "steamclient.dll"
                };
                let dll = format!(r"{install}\{dll_name}");
                let module = LoadLibraryExW(
                    wide(&dll).as_ptr(),
                    std::ptr::null_mut(),
                    LOAD_WITH_ALTERED_SEARCH_PATH,
                );
                if module.is_null() {
                    return Err(format!("無法載入 {dll}"));
                }

                let create_name = CString::new("CreateInterface").unwrap();
                let create_ptr = GetProcAddress(module, create_name.as_ptr());
                if create_ptr.is_null() {
                    return Err("steamclient.dll 缺少 CreateInterface 匯出".into());
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

                // GetISteamApps (vtable 15) — pass `this` (see Phase-2 notes; SAM's
                // no-`this` form is a 32-bit-only quirk that breaks on x64).
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
                    install,
                })
            }
        }

        unsafe fn export<T: Copy>(&self, name: &str) -> Result<T, String> {
            let c = CString::new(name).unwrap();
            let p = GetProcAddress(self.module, c.as_ptr());
            if p.is_null() {
                return Err(format!("steamclient 缺少匯出 {name}"));
            }
            Ok(std::mem::transmute_copy::<*const c_void, T>(&p))
        }

        // ---------- owned-games listing (ISteamApps) ----------

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

        /// Owned games among (appId, type) entries — keeps the type from the app list.
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

        // ---------- per-game stats (ISteamUser + ISteamUserStats) ----------

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

        /// Pump callbacks until `callback_id` arrives (or timeout). Frees each
        /// callback it dequeues. Returns whether the target was seen.
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

        /// Request the current user's stats for the active app and wait for
        /// UserStatsReceived. Returns the ISteamUserStats interface.
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
                    if msg.id == USER_STATS_RECEIVED && !msg.param.is_null() && msg.param_size >= 12
                    {
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

                // Best-effort global achievement rarity. RequestGlobalAchievementPercentages
                // (vtable 33) completes as a call *result* (not a broadcast callback), so we
                // pump callbacks and poll GetAchievementAchievedPercent (vtable 36) on the
                // first achievement until the data lands or we time out.
                let req_global: extern "C" fn(*mut c_void) -> u64 = vfn(stats, 33);
                let get_pct: extern "C" fn(*mut c_void, *const c_char, *mut f32) -> u8 =
                    vfn(stats, 36);
                req_global(stats);
                let mut have_global = false;
                let probe_ptr = if num(stats) > 0 {
                    get_name(stats, 0)
                } else {
                    std::ptr::null()
                };
                if !probe_ptr.is_null() {
                    if let Ok(probe) = CString::new(cstr(probe_ptr)) {
                        if let (Ok(get_cb), Ok(free_cb)) = (
                            self.export::<extern "C" fn(i32, *mut CallbackMsg, *mut i32) -> u8>(
                                "Steam_BGetCallback",
                            ),
                            self.export::<extern "C" fn(i32) -> u8>("Steam_FreeLastCallback"),
                        ) {
                            let start = Instant::now();
                            while start.elapsed() < Duration::from_secs(8) {
                                let mut m = CallbackMsg {
                                    user: 0,
                                    id: 0,
                                    param: std::ptr::null_mut(),
                                    param_size: 0,
                                };
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
                // Reads stay lenient: a missing schema just means "no protection info",
                // so display every achievement as unprotected (the write path is the one
                // that must fail closed).
                let ach_perms = self.read_ach_perms(app_id).unwrap_or_default();
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
                let get_int: extern "C" fn(*mut c_void, *const c_char, *mut i32) -> u8 =
                    vfn(stats, 1);
                let get_float: extern "C" fn(*mut c_void, *const c_char, *mut f32) -> u8 =
                    vfn(stats, 0);
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
        ) -> Result<u32, String> {
            unsafe {
                let stats = self.prepare_stats()?;
                let set_ach: extern "C" fn(*mut c_void, *const c_char) -> u8 = vfn(stats, 6);
                let clear_ach: extern "C" fn(*mut c_void, *const c_char) -> u8 = vfn(stats, 7);
                let store: extern "C" fn(*mut c_void) -> u8 = vfn(stats, 9);

                let set_int: extern "C" fn(*mut c_void, *const c_char, i32) -> u8 = vfn(stats, 3);
                let set_float: extern "C" fn(*mut c_void, *const c_char, f32) -> u8 = vfn(stats, 2);

                let mut applied = 0u32;
                if !ach_changes.is_empty() {
                    // Fail closed: never modify schema-protected achievements, even if a
                    // stale or crafted renderer payload asks us to (these are irreversible
                    // Steam mutations). If the permission schema can't be read we can't tell
                    // which achievements are protected, so refuse *all* achievement writes.
                    match self.read_ach_perms(app_id) {
                        Some(ach_perms) => {
                            for ch in ach_changes {
                                // Same `& 3` mask as the read path; an unknown id (perm 0)
                                // stays writable — Steam itself rejects bogus names.
                                if (ach_perms.get(&ch.id).copied().unwrap_or(0) & 3) != 0 {
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
                    let defs = self.read_stat_defs(app_id);
                    let get_int: extern "C" fn(*mut c_void, *const c_char, *mut i32) -> u8 =
                        vfn(stats, 1);
                    let get_float: extern "C" fn(*mut c_void, *const c_char, *mut f32) -> u8 =
                        vfn(stats, 0);
                    for sc in stat_changes {
                        let Some(def) = writable_stat_def(&defs, sc) else {
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
                Ok(applied)
            }
        }

        /// Lightweight completion count (earned, total) — skips display attrs/icons.
        pub fn count_achievements(&self) -> Result<(u32, u32), String> {
            unsafe {
                let stats = self.prepare_stats()?;
                let num: extern "C" fn(*mut c_void) -> u32 = vfn(stats, 13);
                let get_name: extern "C" fn(*mut c_void, u32) -> *const c_char = vfn(stats, 14);
                let get_ach: extern "C" fn(*mut c_void, *const c_char, *mut u8) -> u8 =
                    vfn(stats, 5);
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

        /// ISteamApps008.GetCurrentGameLanguage (vtable 4).
        fn game_language(&self) -> String {
            unsafe {
                let f: extern "C" fn(*mut c_void) -> *const c_char = vfn(self.apps008, 4);
                cstr(f(self.apps008))
            }
        }

        /// Map achievement API name -> schema `permission` bits (for protected detection).
        /// Achievement permission bits keyed by id, parsed from the local schema.
        /// Returns `None` when the schema can't be read or parsed — callers that
        /// gate writes on protection must fail closed in that case rather than
        /// treat every achievement as unprotected.
        fn read_ach_perms(&self, app_id: u32) -> Option<std::collections::HashMap<String, i32>> {
            let path = format!(
                r"{}\appcache\stats\UserGameStatsSchema_{}.bin",
                self.install, app_id
            );
            let data = std::fs::read(&path).ok()?;
            let root = super::parse_kv(&data)?;
            let stats = root
                .child(&app_id.to_string())
                .and_then(|a| a.child("stats"))?;
            let mut out = std::collections::HashMap::new();
            for group in &stats.children {
                let Some(bits) = group.child("bits") else {
                    continue;
                };
                for bit in &bits.children {
                    if let Some(id) = bit.child("name").and_then(|n| n.as_str()) {
                        let perm = bit.child("permission").map(|p| p.as_int()).unwrap_or(0);
                        out.insert(id.to_string(), perm);
                    }
                }
            }
            Some(out)
        }

        /// Parse the local schema .bin for this game's int/float stat definitions.
        fn read_stat_defs(&self, app_id: u32) -> Vec<StatDef> {
            let path = format!(
                r"{}\appcache\stats\UserGameStatsSchema_{}.bin",
                self.install, app_id
            );
            let Ok(data) = std::fs::read(&path) else {
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
    }

    impl Drop for SteamClient {
        fn drop(&mut self) {
            unsafe {
                if !self.client.is_null() && self.pipe != 0 {
                    let f: extern "C" fn(*mut c_void, i32) -> u8 = vfn(self.client, 1);
                    let _ = f(self.client, self.pipe);
                }
            }
        }
    }
}

#[cfg(windows)]
pub use imp::SteamClient;

/// Read one game's achievements (sets SteamAppId, so run in a per-game process).
#[cfg(windows)]
pub fn read_game(app_id: u32) -> Result<GameStats, String> {
    std::env::set_var("SteamAppId", app_id.to_string());
    let client = imp::SteamClient::connect()?;
    client.read_stats(app_id)
}

/// Apply achievement + stat changes and StoreStats. Per-game process.
#[cfg(windows)]
pub fn write_game(app_id: u32, ach: &[AchChange], stats: &[StatChange]) -> Result<u32, String> {
    std::env::set_var("SteamAppId", app_id.to_string());
    let client = imp::SteamClient::connect()?;
    client.write_stats(app_id, ach, stats)
}

/// Light (earned, total) achievement completion for one game. Per-game process.
#[cfg(windows)]
pub fn progress_game(app_id: u32) -> Result<(u32, u32), String> {
    std::env::set_var("SteamAppId", app_id.to_string());
    let client = imp::SteamClient::connect()?;
    client.count_achievements()
}

/// Full owned-games library via the SAM master list (fetch games.xml + ownership scan).
#[cfg(windows)]
pub fn list_owned() -> Result<Vec<OwnedGame>, String> {
    let entries = fetch_app_list()?;
    let client = imp::SteamClient::connect()?;
    Ok(client.owned_games_typed(&entries))
}

/// (earned, total) achievement completion read from Steam's local cache files.
/// Reads files only — no Steam connection — so it never launches the game.
#[cfg(windows)]
pub use imp::completion_local;

/// The user's Steam library categories per owned app (from sharedconfig.vdf).
#[cfg(windows)]
pub use imp::read_categories;

/// Library categories: Windows + macOS read them from the local Steam config;
/// stubbed on any other platform so the crate still type-checks.
#[cfg(not(any(windows, target_os = "macos")))]
pub fn read_categories() -> Vec<(u32, Vec<String>)> {
    Vec::new()
}

#[cfg(target_os = "macos")]
mod imp_macos;

#[cfg(target_os = "macos")]
pub use imp_macos::{completion_local, read_categories, SteamClient};

#[cfg(target_os = "macos")]
pub fn list_owned() -> Result<Vec<OwnedGame>, String> {
    let entries = fetch_app_list()?;
    Ok(imp_macos::SteamClient::connect()?.owned_games_typed(&entries))
}

#[cfg(target_os = "macos")]
pub fn read_game(app_id: u32) -> Result<GameStats, String> {
    std::env::set_var("SteamAppId", app_id.to_string());
    imp_macos::SteamClient::connect()?.read_stats(app_id)
}

#[cfg(target_os = "macos")]
pub fn progress_game(app_id: u32) -> Result<(u32, u32), String> {
    std::env::set_var("SteamAppId", app_id.to_string());
    imp_macos::SteamClient::connect()?.count_achievements()
}

#[cfg(target_os = "macos")]
pub fn write_game(app_id: u32, ach: &[AchChange], stats: &[StatChange]) -> Result<u32, String> {
    std::env::set_var("SteamAppId", app_id.to_string());
    imp_macos::SteamClient::connect()?.write_stats(app_id, ach, stats)
}

// ---- Non-Windows fallbacks so the crate still type-checks off-platform. ----
#[cfg(not(any(windows, target_os = "macos")))]
pub struct SteamClient;

#[cfg(not(any(windows, target_os = "macos")))]
impl SteamClient {
    pub fn connect() -> Result<Self, String> {
        Err("Steam 整合僅支援 Windows".into())
    }
    pub fn is_subscribed(&self, _app_id: u32) -> bool {
        false
    }
    pub fn app_data(&self, _app_id: u32, _key: &str) -> Option<String> {
        None
    }
    pub fn owned_games(&self, _candidates: &[u32]) -> Vec<OwnedGame> {
        Vec::new()
    }
}

#[cfg(not(any(windows, target_os = "macos")))]
pub fn read_game(_app_id: u32) -> Result<GameStats, String> {
    Err("Steam 整合僅支援 Windows".into())
}

#[cfg(not(any(windows, target_os = "macos")))]
pub fn write_game(_app_id: u32, _ach: &[AchChange], _stats: &[StatChange]) -> Result<u32, String> {
    Err("Steam 整合僅支援 Windows".into())
}

#[cfg(not(any(windows, target_os = "macos")))]
pub fn progress_game(_app_id: u32) -> Result<(u32, u32), String> {
    Err("Steam 整合僅支援 Windows".into())
}

#[cfg(not(any(windows, target_os = "macos")))]
pub fn list_owned() -> Result<Vec<OwnedGame>, String> {
    Err("Steam 整合僅支援 Windows".into())
}

#[cfg(not(any(windows, target_os = "macos")))]
pub fn completion_local(_app_id: u32) -> Option<(u32, u32)> {
    None
}
