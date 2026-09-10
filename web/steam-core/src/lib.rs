//! Local-Steam read/write layer using the **internal** `steamclient.dll`
//! interfaces (not the public Steamworks SDK), ported from gibbed's SAM so the
//! whole owned-games library is browsable and per-game achievements/stats are
//! readable and writable.
//!
//! Per-game work (`read_game` / `write_game`) must run in a process whose
//! `SteamAppId` env var is set to that app BEFORE steamclient is loaded — exactly
//! how SAM uses a separate process per game.

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::Duration;

const APP_LIST_CACHE_TTL: Duration = Duration::from_secs(24 * 60 * 60);
const APP_LIST_MAX_BYTES: u64 = 8 * 1024 * 1024;
const APP_LIST_MAX_ENTRIES: usize = 250_000;

/// Upper bound on how long `read_stats` waits for global achievement percentages
/// (rarity) after the request was issued. Rarity is cosmetic, so a slow or failed
/// call result must not hold the whole achievement list hostage.
const GLOBAL_PCT_WAIT: Duration = Duration::from_secs(3);

/// k_iSteamUtilsCallbacks (700) + 3 = SteamAPICallCompleted_t. The pipe posts one when
/// an async call result finishes — success or failure — which lets a poll loop stop as
/// soon as the request is over instead of running to its deadline.
#[cfg_attr(not(any(windows, target_os = "macos")), allow(dead_code))]
const API_CALL_COMPLETED: i32 = 703;

/// If a callback message is a SteamAPICallCompleted_t, return the SteamAPICall_t handle
/// it refers to. Layout: `uint64 m_hAsyncCall; int m_iCallback; uint32 m_cubParam;` —
/// only the leading handle is read (unaligned), and only when the payload can hold it.
///
/// # Safety
/// `param` must be null or point at `param_size` readable bytes. It comes straight from
/// Steam_BGetCallback, which owns the buffer until Steam_FreeLastCallback.
#[cfg_attr(not(any(windows, target_os = "macos")), allow(dead_code))]
unsafe fn completed_call_handle(id: i32, param: *const u8, param_size: i32) -> Option<u64> {
    if id != API_CALL_COMPLETED || param.is_null() || param_size < 8 {
        return None;
    }
    Some(std::ptr::read_unaligned(param as *const u64))
}

/// Threads for the file-only completion scan: one per core up to 8, and never more
/// than one per 16 apps so a small library doesn't pay for threads it can't use.
#[cfg_attr(not(any(windows, target_os = "macos")), allow(dead_code))]
fn scan_threads(app_count: usize) -> usize {
    let cores = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(1);
    cores.min(8).min(app_count.div_ceil(16)).max(1)
}

/// Achievement permission bits keyed by API name, from one parsed schema tree
/// (`UserGameStatsSchema_<appid>.bin`). `None` when the tree has no stats block for
/// the app — callers that gate writes on protection must fail closed in that case
/// rather than treat every achievement as unprotected.
#[cfg_attr(not(any(windows, target_os = "macos")), allow(dead_code))]
fn schema_ach_perms(root: &Kv, app_id: u32) -> Option<std::collections::HashMap<String, i32>> {
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

#[derive(Debug, Clone, Serialize)]
pub struct OwnedGame {
    pub app_id: u32,
    pub name: String,
    #[serde(rename = "type")]
    pub kind: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct GameProgress {
    pub app_id: u32,
    pub earned: u32,
    pub total: u32,
}

/// Parse the SAM games.xml: entries are `<game>APPID</game>` or
/// `<game type="demo">APPID</game>`. Returns (appId, type) pairs.
pub fn parse_app_list(xml: &str) -> Vec<(u32, String)> {
    parse_app_list_with_limit(xml, APP_LIST_MAX_ENTRIES).unwrap_or_default()
}

fn parse_app_list_with_limit(xml: &str, max_entries: usize) -> Result<Vec<(u32, String)>, String> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for chunk in xml.split("<game").skip(1) {
        let Some(gt) = chunk.find('>') else { continue };
        let head = &chunk[..gt];
        let raw_kind = head
            .find("type=\"")
            .and_then(|i| {
                let rest = &head[i + 6..];
                rest.find('"').map(|j| &rest[..j])
            })
            .unwrap_or_default();
        let kind = match raw_kind {
            "demo" | "mod" => raw_kind.to_string(),
            _ => String::new(),
        };
        let body = &chunk[gt + 1..];
        let Some(end) = body.find("</game>") else {
            continue;
        };
        if let Ok(id) = body[..end].trim().parse::<u32>() {
            if id == 0 || !seen.insert(id) {
                continue;
            }
            if out.len() >= max_entries {
                return Err(format!("games.xml 超過 {max_entries} 筆唯一 appId 上限"));
            }
            out.push((id, kind));
        }
    }
    Ok(out)
}

fn app_list_cache_path() -> Option<PathBuf> {
    #[cfg(windows)]
    let base = std::env::var_os("LOCALAPPDATA").map(PathBuf::from);
    #[cfg(target_os = "macos")]
    let base = std::env::var_os("HOME")
        .map(PathBuf::from)
        .map(|home| home.join("Library").join("Caches"));
    #[cfg(not(any(windows, target_os = "macos")))]
    let base = std::env::var_os("XDG_CACHE_HOME")
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var_os("HOME")
                .map(PathBuf::from)
                .map(|home| home.join(".cache"))
        });

    base.map(|base| {
        base.join("steam-achievement-manager-enhanced")
            .join("games.xml")
    })
}

fn load_cached_app_list(path: &Path) -> Option<Vec<(u32, String)>> {
    if std::fs::metadata(path).ok()?.len() > APP_LIST_MAX_BYTES {
        return None;
    }
    let body = std::fs::read_to_string(path).ok()?;
    let list = parse_app_list_with_limit(&body, APP_LIST_MAX_ENTRIES).ok()?;
    (!list.is_empty()).then_some(list)
}

fn app_list_cache_is_fresh(path: &Path) -> bool {
    std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|modified| modified.elapsed().ok())
        .is_some_and(|age| age <= APP_LIST_CACHE_TTL)
}

fn save_app_list_cache(path: &Path, body: &str) {
    let Some(parent) = path.parent() else { return };
    if std::fs::create_dir_all(parent).is_ok() {
        // A partial cache is harmless: every read revalidates size, syntax, and entry count
        // before use, and falls back to the network/bundled candidate list on failure.
        let _ = std::fs::write(path, body);
    }
}

fn download_app_list() -> Result<(String, Vec<(u32, String)>), String> {
    let mut response = ureq::get("https://gib.me/sam/games.xml")
        .config()
        .timeout_global(Some(Duration::from_secs(20)))
        .build()
        .call()
        .map_err(|e| format!("下載 games.xml 失敗：{e}"))?;
    let mut bytes = Vec::new();
    // `as_reader` caps at ureq's own 10 MiB default, but APP_LIST_MAX_BYTES is 8 MiB, so the
    // take() below is what actually bounds the read and the size check stays authoritative.
    response
        .body_mut()
        .as_reader()
        .take(APP_LIST_MAX_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > APP_LIST_MAX_BYTES {
        return Err(format!(
            "games.xml 超過 {} MiB 上限",
            APP_LIST_MAX_BYTES / 1024 / 1024
        ));
    }
    let body = String::from_utf8(bytes).map_err(|_| "games.xml 不是有效 UTF-8".to_string())?;
    let list = parse_app_list_with_limit(&body, APP_LIST_MAX_ENTRIES)?;
    if list.is_empty() {
        Err("games.xml 解析為空".into())
    } else {
        Ok((body, list))
    }
}

/// Download + parse the SAM master app list (all apps with stats/achievements).
pub fn fetch_app_list() -> Result<Vec<(u32, String)>, String> {
    let cache_path = app_list_cache_path();
    // A fresh cache is served without touching the network. A stale one is only
    // read (1.6 MB, 80k entries) if the download fails — not parsed up front and
    // then thrown away when the download succeeds.
    if let Some(path) = cache_path.as_deref() {
        if app_list_cache_is_fresh(path) {
            if let Some(list) = load_cached_app_list(path) {
                return Ok(list);
            }
        }
    }

    match download_app_list() {
        Ok((body, list)) => {
            if let Some(path) = cache_path.as_deref() {
                save_app_list_cache(path, &body);
            }
            Ok(list)
        }
        Err(error) => cache_path
            .as_deref()
            .and_then(load_cached_app_list)
            .ok_or(error),
    }
}

/// Resolve a game's real header-image URL via Steam's appdetails API. Newer games
/// serve art from content-hash paths that can't be guessed from the appid, so this
/// is the only reliable source for them. Network read-only; None on any failure.
pub fn fetch_header_url(app_id: u32) -> Option<String> {
    let url =
        format!("https://store.steampowered.com/api/appdetails?appids={app_id}&filters=basic");
    let body = ureq::get(&url)
        .config()
        .timeout_global(Some(std::time::Duration::from_secs(10)))
        .build()
        .call()
        .ok()?
        .body_mut()
        .read_to_string()
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

/// Outcome of a `write_game`/`write_stats` call.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct WriteResult {
    /// Number of changes Steam actually applied (after StoreStats succeeded).
    pub saved: u32,
    /// Ids Steam refused: a schema-protected/unknown achievement, a protected/unknown
    /// stat, or a stat value that failed validation. This lets the UI report a *true*
    /// partial save instead of inferring rejection from `saved < requested` — Steam
    /// also returns "not applied" for a no-op re-write (e.g. re-locking an already
    /// locked achievement), which is not a rejection and must not be treated as one.
    pub rejected: Vec<String>,
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

fn achievement_write_allowed(
    ach_perms: &std::collections::HashMap<String, i32>,
    achievement_id: &str,
) -> bool {
    ach_perms
        .get(achievement_id)
        .is_some_and(|permission| (permission & 3) == 0)
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

/// A schema stat's kind: 1 = integer, 2 = float (AverageRate counts as float),
/// 0 = not a user-writable numeric stat. Schemas spell the type as a number, a
/// name, or a separate `type_int` key depending on their vintage.
#[cfg_attr(not(any(windows, target_os = "macos")), allow(dead_code))]
fn resolve_stat_type(stat: &Kv) -> u8 {
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

/// A stat's display name: a plain string, else the game language, then english,
/// then any localized child, else `fallback` (the API name).
#[cfg_attr(not(any(windows, target_os = "macos")), allow(dead_code))]
fn resolve_display_name(stat: &Kv, lang: &str, fallback: &str) -> String {
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

/// This game's int/float stat definitions from one parsed schema tree
/// (`UserGameStatsSchema_<appid>.bin`), display names resolved for `lang`.
/// Shared by the Windows and macOS clients; both read the tree once per command.
#[cfg_attr(not(any(windows, target_os = "macos")), allow(dead_code))]
fn schema_stat_defs(root: &Kv, app_id: u32, lang: &str) -> Vec<StatDef> {
    let Some(stats) = root
        .child(&app_id.to_string())
        .and_then(|a| a.child("stats"))
    else {
        return Vec::new();
    };
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
            name: resolve_display_name(stat, lang, &id),
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

/// Max KeyValues nesting depth. Real Steam schemas nest only a handful of levels;
/// a crafted `.bin` with unbounded type-0 nesting would otherwise recurse until the
/// stack overflows and aborts the process. Past this depth we reject the file.
const MAX_KV_DEPTH: usize = 64;

fn parse_kv_children(r: &mut KvReader, depth: usize) -> Option<Vec<Kv>> {
    if depth > MAX_KV_DEPTH {
        return None;
    }
    let mut out = Vec::new();
    loop {
        let t = r.u8()?;
        if t == 8 {
            break; // End
        }
        let name = r.cstr()?;
        let (value, children) = match t {
            0 => (KvValue::None, parse_kv_children(r, depth + 1)?),
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
    let children = parse_kv_children(&mut r, 0)?;
    Some(Kv {
        name: "<root>".into(),
        value: KvValue::None,
        children,
    })
}

/// Fixture helpers shared by the tests in this file and in the platform modules: a
/// writer for Steam's binary KeyValues format (the inverse of `parse_kv`), so tests
/// can lay down realistic `UserGameStatsSchema_*.bin` / `UserGameStats_*.bin` files
/// without a Steam install.
#[cfg(test)]
pub(crate) mod test_support {
    /// One node of a binary KeyValues tree.
    pub(crate) enum KvNode {
        Obj(String, Vec<KvNode>),
        Str(String, String),
        Int(String, i32),
        Float(String, f32),
    }

    pub(crate) fn kv_obj(name: &str, children: Vec<KvNode>) -> KvNode {
        KvNode::Obj(name.to_string(), children)
    }
    pub(crate) fn kv_str(name: &str, value: &str) -> KvNode {
        KvNode::Str(name.to_string(), value.to_string())
    }
    pub(crate) fn kv_int(name: &str, value: i32) -> KvNode {
        KvNode::Int(name.to_string(), value)
    }
    pub(crate) fn kv_float(name: &str, value: f32) -> KvNode {
        KvNode::Float(name.to_string(), value)
    }

    fn write_cstr(out: &mut Vec<u8>, text: &str) {
        out.extend_from_slice(text.as_bytes());
        out.push(0);
    }

    fn write_node(out: &mut Vec<u8>, node: &KvNode) {
        match node {
            KvNode::Obj(name, children) => {
                out.push(0);
                write_cstr(out, name);
                for child in children {
                    write_node(out, child);
                }
                out.push(8);
            }
            KvNode::Str(name, value) => {
                out.push(1);
                write_cstr(out, name);
                write_cstr(out, value);
            }
            KvNode::Int(name, value) => {
                out.push(2);
                write_cstr(out, name);
                out.extend_from_slice(&value.to_le_bytes());
            }
            KvNode::Float(name, value) => {
                out.push(3);
                write_cstr(out, name);
                out.extend_from_slice(&value.to_le_bytes());
            }
        }
    }

    /// Serialize a root-level node sequence the way Steam's `.bin` files are laid out.
    pub(crate) fn kv_bytes(nodes: &[KvNode]) -> Vec<u8> {
        let mut out = Vec::new();
        for node in nodes {
            write_node(&mut out, node);
        }
        out.push(8);
        out
    }

    /// A `UserGameStatsSchema_<app>.bin`: each entry of `groups` becomes one
    /// achievement group of `(name, permission)` bits; `stats` are appended as
    /// further stat nodes under the same `stats` block.
    pub(crate) fn schema_bytes(
        app_id: u32,
        groups: &[&[(&str, i32)]],
        stats: Vec<KvNode>,
    ) -> Vec<u8> {
        let mut nodes: Vec<KvNode> = groups
            .iter()
            .enumerate()
            .map(|(n, bits)| {
                let bits = bits
                    .iter()
                    .enumerate()
                    .map(|(b, (name, perm))| {
                        kv_obj(
                            &b.to_string(),
                            vec![kv_str("name", name), kv_int("permission", *perm)],
                        )
                    })
                    .collect();
                kv_obj(
                    &n.to_string(),
                    vec![kv_str("type", "4"), kv_obj("bits", bits)],
                )
            })
            .collect();
        nodes.extend(stats);
        kv_bytes(&[kv_obj(&app_id.to_string(), vec![kv_obj("stats", nodes)])])
    }

    /// A `UserGameStats_<account>_<app>.bin` with one AchievementTimes entry per
    /// unlocked achievement.
    pub(crate) fn user_stats_bytes(unlocked: &[&str]) -> Vec<u8> {
        let times = unlocked
            .iter()
            .map(|name| kv_int(name, 1_700_000_000))
            .collect();
        kv_bytes(&[kv_obj(
            "cache",
            vec![kv_obj("0", vec![kv_obj("AchievementTimes", times)])],
        )])
    }
}

#[cfg(test)]
mod tests {
    use super::test_support::{kv_bytes, kv_float, kv_int, kv_obj, kv_str, schema_bytes};
    use super::{
        achievement_write_allowed, choose_account_id, completed_call_handle,
        parse_app_list_with_limit, scan_threads, schema_ach_perms, schema_stat_defs,
        stat_i32_value, stat_min_default, stat_value_is_valid, writable_stat_def, Kv, KvValue,
        StatChange, StatDef, API_CALL_COMPLETED,
    };
    use std::collections::HashMap;

    #[test]
    fn kv_fixture_writer_round_trips_through_parse_kv() {
        let bytes = kv_bytes(&[kv_obj(
            "root",
            vec![
                kv_str("name", "kills"),
                kv_int("permission", 2),
                kv_float("ratio", 0.5),
                kv_obj("nested", vec![kv_str("x", "y")]),
            ],
        )]);
        let tree = super::parse_kv(&bytes).expect("well-formed");
        let root = tree.child("root").expect("root object");
        assert_eq!(root.child("name").and_then(|n| n.as_str()), Some("kills"));
        assert_eq!(root.child("permission").map(|n| n.as_int()), Some(2));
        assert_eq!(root.child("ratio").map(|n| n.as_float()), Some(0.5));
        assert_eq!(
            root.child("nested")
                .and_then(|n| n.child("x"))
                .and_then(|x| x.as_str()),
            Some("y")
        );
    }

    #[test]
    fn schema_stat_defs_resolves_types_names_and_bounds_from_one_tree() {
        let bytes = schema_bytes(
            440,
            &[&[("ACH_A", 0)]],
            vec![
                kv_obj(
                    "kills",
                    vec![
                        kv_str("type", "1"),
                        kv_str("name", "kills"),
                        kv_obj(
                            "display",
                            vec![kv_obj(
                                "name",
                                vec![kv_str("english", "Kills"), kv_str("tchinese", "擊殺")],
                            )],
                        ),
                        kv_int("permission", 2),
                        kv_int("incrementonly", 1),
                        kv_str("min", "0"),
                        kv_str("max", "1000"),
                        kv_str("maxchange", "50"),
                    ],
                ),
                kv_obj(
                    "accuracy",
                    vec![
                        kv_str("type", "float"),
                        kv_str("name", "accuracy"),
                        kv_obj("display", vec![kv_str("name", "Accuracy")]),
                    ],
                ),
                // Integer type spelled the old way, but no API name → skipped.
                kv_obj("anon", vec![kv_int("type_int", 1), kv_str("name", "")]),
            ],
        );
        let root = super::parse_kv(&bytes).expect("fixture parses");
        let defs = schema_stat_defs(&root, 440, "tchinese");
        assert_eq!(defs.len(), 2, "achievement group and empty id are skipped");
        let kills = &defs[0];
        assert_eq!(kills.id, "kills");
        assert_eq!(kills.name, "擊殺", "game language wins");
        assert!(!kills.is_float);
        assert_eq!(kills.permission, 2);
        assert!(kills.increment_only);
        assert_eq!(
            (kills.min_value, kills.max_value, kills.max_change),
            (0.0, 1000.0, 50.0)
        );
        let accuracy = &defs[1];
        assert!(accuracy.is_float);
        assert_eq!(accuracy.name, "Accuracy", "plain display name");
        assert_eq!(accuracy.min_value, stat_min_default(true));
        assert_eq!(accuracy.max_change, 0.0);
        assert_eq!(
            schema_stat_defs(&root, 440, "german")[0].name,
            "Kills",
            "english fallback"
        );
        assert!(schema_stat_defs(&root, 570, "english").is_empty());
        // The same parsed tree feeds the permission map: one read serves both.
        assert_eq!(schema_ach_perms(&root, 440).unwrap().get("ACH_A"), Some(&0));
    }

    /// A binary KeyValues blob nesting `depth` type-0 objects, each closed again.
    fn nested_kv(depth: usize) -> Vec<u8> {
        let mut data = Vec::new();
        for _ in 0..depth {
            data.push(0); // type 0: nested object
            data.extend_from_slice(b"a\0"); // name
        }
        // End markers: one per opened level plus the root sequence.
        data.extend(std::iter::repeat_n(8u8, depth + 1));
        data
    }

    #[test]
    fn parse_kv_depth_guard_rejects_pathological_nesting() {
        // Shallow, well-formed nesting still parses.
        assert!(super::parse_kv(&nested_kv(10)).is_some());
        // A crafted schema nested past the cap is rejected, not stack-overflowed.
        assert!(super::parse_kv(&nested_kv(5000)).is_none());
    }

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
    fn achievement_write_allowed_rejects_protected_and_unknown_ids() {
        let perms = HashMap::from([("known".to_string(), 0), ("protected".to_string(), 3)]);

        assert!(achievement_write_allowed(&perms, "known"));
        assert!(!achievement_write_allowed(&perms, "protected"));
        assert!(!achievement_write_allowed(&perms, "crafted"));
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

    #[test]
    fn app_list_deduplicates_ids_and_normalizes_types() {
        let xml = r#"<games>
            <game type="demo">10</game>
            <game type="unexpected">20</game>
            <game type="mod">10</game>
            <game>0</game>
        </games>"#;

        assert_eq!(
            parse_app_list_with_limit(xml, 10).unwrap(),
            vec![(10, "demo".into()), (20, String::new())]
        );
    }

    #[test]
    fn app_list_rejects_more_unique_ids_than_the_limit() {
        let xml = "<game>1</game><game>2</game><game>3</game>";
        assert!(parse_app_list_with_limit(xml, 2).is_err());
    }

    #[test]
    fn schema_ach_perms_collects_bits_across_groups_for_the_app_only() {
        let leaf = |name: &str, value: KvValue| Kv {
            name: name.into(),
            value,
            children: Vec::new(),
        };
        let node = |name: &str, children: Vec<Kv>| Kv {
            name: name.into(),
            value: KvValue::None,
            children,
        };
        let bit = |id: &str, perm: i32| {
            node(
                "0",
                vec![
                    leaf("name", KvValue::Str(id.into())),
                    leaf("permission", KvValue::Int(perm)),
                ],
            )
        };
        let root = node(
            "",
            vec![node(
                "440",
                vec![node(
                    "stats",
                    vec![
                        node(
                            "1",
                            vec![node("bits", vec![bit("ACH_A", 0), bit("ACH_B", 3)])],
                        ),
                        node("2", vec![node("bits", vec![bit("ACH_C", 2)])]),
                        // A stat group without bits contributes nothing.
                        node("3", vec![leaf("type", KvValue::Int(1))]),
                    ],
                )],
            )],
        );
        let perms = schema_ach_perms(&root, 440).expect("stats block present");
        assert_eq!(perms.len(), 3);
        assert_eq!(perms.get("ACH_A"), Some(&0));
        assert_eq!(perms.get("ACH_B"), Some(&3));
        assert_eq!(perms.get("ACH_C"), Some(&2));
        // No stats block for another app id → None, so writers fail closed.
        assert!(schema_ach_perms(&root, 570).is_none());
    }

    #[test]
    fn scan_threads_never_exceeds_cores_or_one_per_sixteen_apps() {
        assert_eq!(scan_threads(0), 1);
        assert_eq!(scan_threads(15), 1);
        assert!(scan_threads(32) <= 2);
        assert!(scan_threads(10_000) <= 8);
        assert!(scan_threads(10_000) >= 1);
    }

    #[test]
    fn completed_call_handle_reads_only_matching_call_results() {
        let handle: u64 = 0x1122_3344_5566_7788;
        // SteamAPICallCompleted_t: the handle leads, followed by m_iCallback + m_cubParam.
        let mut buf = [0u8; 16];
        buf[..8].copy_from_slice(&handle.to_ne_bytes());
        let p = buf.as_ptr();
        assert_eq!(
            unsafe { completed_call_handle(API_CALL_COMPLETED, p, 16) },
            Some(handle)
        );
        // A different callback id, a truncated payload, or a null pointer never match.
        assert_eq!(unsafe { completed_call_handle(1101, p, 16) }, None);
        assert_eq!(
            unsafe { completed_call_handle(API_CALL_COMPLETED, p, 4) },
            None
        );
        assert_eq!(
            unsafe { completed_call_handle(API_CALL_COMPLETED, std::ptr::null(), 16) },
            None
        );
    }
}

#[cfg(windows)]
mod imp {
    use super::{
        achievement_write_allowed, choose_account_id_with_preferred, parse_most_recent_account_id,
        stat_i32_value, stat_value_is_valid, text_vdf_tokens, writable_stat_def, AchChange,
        AchievementInfo, GameProgress, GameStats, OwnedGame, StatChange, StatInfo, WriteResult,
    };
    use std::ffi::{c_char, c_void, CStr, CString};
    use std::time::{Duration, Instant};

    #[allow(non_snake_case)]
    extern "system" {
        fn AddDllDirectory(path: *const u16) -> *mut c_void;
        fn RemoveDllDirectory(cookie: *mut c_void) -> i32;
        fn LoadLibraryExW(name: *const u16, file: *mut c_void, flags: u32) -> *mut c_void;
        fn GetProcAddress(module: *mut c_void, name: *const c_char) -> *const c_void;
    }
    const LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR: u32 = 0x0000_0100;
    const LOAD_LIBRARY_SEARCH_USER_DIRS: u32 = 0x0000_0400;
    const LOAD_LIBRARY_SEARCH_SYSTEM32: u32 = 0x0000_0800;

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

    #[derive(Default)]
    struct DllDirectoryGuard {
        cookies: Vec<*mut c_void>,
    }

    impl DllDirectoryGuard {
        fn add(&mut self, path: &str) -> Result<(), String> {
            let cookie = unsafe { AddDllDirectory(wide(path).as_ptr()) };
            if cookie.is_null() {
                return Err(format!("無法加入 DLL 搜尋目錄：{path}"));
            }
            self.cookies.push(cookie);
            Ok(())
        }
    }

    impl Drop for DllDirectoryGuard {
        fn drop(&mut self) {
            for cookie in self.cookies.drain(..).rev() {
                unsafe {
                    let _ = RemoveDllDirectory(cookie);
                }
            }
        }
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
        install: &str,
        accounts: &[u32],
        preferred: Option<u32>,
        app_id: u32,
    ) -> Option<GameProgress> {
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
        let earned =
            choose_account_id_with_preferred(accounts.iter().copied(), preferred, |account_id| {
                std::path::Path::new(&user_stats_path(install, account_id, app_id)).is_file()
            })
            .and_then(|account_id| std::fs::read(user_stats_path(install, account_id, app_id)).ok())
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

    /// Batch completion scan. Steam root/account discovery is shared across the full
    /// library instead of repeated once per Tauri command and app id, and the per-app
    /// schema reads + parses (tens of MB for a large library) run on a few threads:
    /// this path opens no Steam interface — pure local file I/O — so it is safe to
    /// parallelize.
    pub fn completion_local_many(app_ids: &[u32]) -> Vec<GameProgress> {
        let Some(install) = install_path() else {
            return Vec::new();
        };
        completion_local_many_in(&install, app_ids)
    }

    /// The scan itself for a given Steam install root (tests point this at a
    /// fixture directory instead of the registry-resolved install).
    fn completion_local_many_in(install: &str, app_ids: &[u32]) -> Vec<GameProgress> {
        let accounts = account_ids(install);
        let preferred = most_recent_account_id(install, &accounts);
        let scan = |ids: &[u32]| -> Vec<GameProgress> {
            ids.iter()
                .copied()
                .filter_map(|app_id| {
                    completion_local_with_context(install, &accounts, preferred, app_id)
                })
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

    // ---- user library categories (parsed from sharedconfig.vdf, a text VDF) ----

    enum VdfVal {
        Str(String),
        Obj(Vec<(String, VdfVal)>),
    }

    /// Max text-VDF nesting depth. sharedconfig.vdf is only a few levels deep; a
    /// crafted file with unbounded `{` nesting would otherwise overflow the stack.
    const MAX_VDF_DEPTH: usize = 100;

    /// Consume tokens up to and including the brace that closes the block we are
    /// already inside — iteratively, so skipping an over-deep block costs no stack.
    fn skip_vdf_block(tokens: &[String], pos: &mut usize) {
        let mut depth = 1usize;
        while *pos < tokens.len() && depth > 0 {
            match tokens[*pos].as_str() {
                "{" => depth += 1,
                "}" => depth -= 1,
                _ => {}
            }
            *pos += 1;
        }
    }

    fn parse_vdf(tokens: &[String], pos: &mut usize, depth: usize) -> Vec<(String, VdfVal)> {
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
                if depth >= MAX_VDF_DEPTH {
                    // Too deep to be a real config; skip the block instead of recursing.
                    skip_vdf_block(tokens, pos);
                } else {
                    out.push((key, VdfVal::Obj(parse_vdf(tokens, pos, depth + 1))));
                }
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
            let tree = parse_vdf(&tokens, &mut pos, 0);
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
        _dll_dirs: DllDirectoryGuard,
    }

    impl SteamClient {
        pub fn connect() -> Result<Self, String> {
            let install = install_path().ok_or("找不到 Steam 安裝路徑（請確認已安裝 Steam）")?;
            let mut dll_dirs = DllDirectoryGuard::default();
            dll_dirs.add(&install)?;
            dll_dirs.add(&format!(r"{install}\bin"))?;
            unsafe {
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
                    LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR
                        | LOAD_LIBRARY_SEARCH_USER_DIRS
                        | LOAD_LIBRARY_SEARCH_SYSTEM32,
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
                    _dll_dirs: dll_dirs,
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
                std::thread::sleep(delay);
                delay = (delay * 2).min(Duration::from_millis(80));
            }
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

                // Best-effort global achievement rarity. RequestGlobalAchievementPercentages
                // (vtable 33) completes as a call *result* (not a broadcast callback), so
                // fire it first and enumerate the achievements while it is in flight; the
                // bounded wait + fill happens after the loop (wait_global_percentages).
                let req_global: extern "C" fn(*mut c_void) -> u64 = vfn(stats, 33);
                let get_pct: extern "C" fn(*mut c_void, *const c_char, *mut f32) -> u8 =
                    vfn(stats, 36);
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
                let get_int: extern "C" fn(*mut c_void, *const c_char, *mut i32) -> u8 =
                    vfn(stats, 1);
                let get_float: extern "C" fn(*mut c_void, *const c_char, *mut f32) -> u8 =
                    vfn(stats, 0);
                let mut stat_infos = Vec::new();
                let stat_defs = schema
                    .as_ref()
                    .map(|s| super::schema_stat_defs(s, app_id, &self.game_language()))
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
                        .map(|s| super::schema_stat_defs(s, app_id, &self.game_language()))
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
            let path = format!(
                r"{}\appcache\stats\UserGameStatsSchema_{}.bin",
                self.install, app_id
            );
            let data = std::fs::read(&path).ok()?;
            super::parse_kv(&data)
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

    /// File-only paths exercised against a throwaway Steam install root under the
    /// OS temp dir — no Steam client, no registry.
    #[cfg(test)]
    mod tests {
        use super::{
            account_ids, collect_categories, completion_local_many_in,
            completion_local_with_context, user_stats_path,
        };
        use crate::test_support::{kv_obj, kv_str, schema_bytes, user_stats_bytes};
        use std::collections::{BTreeSet, HashMap};

        fn fixture_root(tag: &str) -> String {
            let nanos = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0);
            let dir = std::env::temp_dir().join(format!(
                "steam-core-test-{tag}-{}-{nanos}",
                std::process::id()
            ));
            std::fs::create_dir_all(&dir).expect("temp fixture dir");
            dir.to_string_lossy().trim_end_matches('\\').to_string()
        }

        fn write(path: String, bytes: &[u8]) {
            let path = std::path::Path::new(&path);
            std::fs::create_dir_all(path.parent().expect("has parent")).expect("mkdir");
            std::fs::write(path, bytes).expect("write fixture");
        }

        fn schema_path(root: &str, app_id: u32) -> String {
            format!(r"{root}\appcache\stats\UserGameStatsSchema_{app_id}.bin")
        }

        #[test]
        fn completion_reads_total_from_the_schema_and_earned_from_the_account_with_a_cache() {
            let root = fixture_root("completion");
            std::fs::create_dir_all(format!(r"{root}\userdata\111")).unwrap();
            std::fs::create_dir_all(format!(r"{root}\userdata\222")).unwrap();
            write(
                schema_path(&root, 440),
                &schema_bytes(440, &[&[("A", 0), ("B", 3)], &[("C", 0)]], Vec::new()),
            );
            write(
                user_stats_path(&root, 222, 440),
                &user_stats_bytes(&["A", "C"]),
            );
            write(
                schema_path(&root, 570),
                &schema_bytes(570, &[&[("ONLY", 0)]], Vec::new()),
            );
            write(
                schema_path(&root, 730),
                &schema_bytes(
                    730,
                    &[],
                    vec![kv_obj(
                        "s",
                        vec![kv_str("type", "1"), kv_str("name", "kills")],
                    )],
                ),
            );

            let accounts = account_ids(&root);
            assert_eq!(accounts, vec![111, 222]);
            // No loginusers.vdf → no preferred account → the one holding the cache wins.
            let p = completion_local_with_context(&root, &accounts, None, 440)
                .expect("schema has bits");
            assert_eq!((p.app_id, p.earned, p.total), (440, 2, 3));
            let p = completion_local_with_context(&root, &accounts, None, 570)
                .expect("schema has bits");
            assert_eq!(
                (p.earned, p.total),
                (0, 1),
                "no per-user cache → nothing earned"
            );
            assert!(
                completion_local_with_context(&root, &accounts, None, 730).is_none(),
                "stats-only schema has no achievements"
            );
            assert!(
                completion_local_with_context(&root, &accounts, None, 999).is_none(),
                "missing schema"
            );
            let _ = std::fs::remove_dir_all(&root);
        }

        #[test]
        fn completion_scan_covers_every_app_across_threads() {
            let root = fixture_root("scan");
            std::fs::create_dir_all(format!(r"{root}\userdata\111")).unwrap();
            let ids: Vec<u32> = (1000..1040).collect();
            for (n, app_id) in ids.iter().enumerate() {
                let bits: Vec<(&str, i32)> = (0..=n % 5).map(|_| ("X", 0)).collect();
                write(
                    schema_path(&root, *app_id),
                    &schema_bytes(*app_id, &[bits.as_slice()], Vec::new()),
                );
                if n % 2 == 0 {
                    write(
                        user_stats_path(&root, 111, *app_id),
                        &user_stats_bytes(&["X"]),
                    );
                }
            }
            // 40 apps → several scan threads on a multi-core box, one on a single core;
            // the result must be the same either way.
            let mut got = completion_local_many_in(&root, &ids);
            got.sort_by_key(|p| p.app_id);
            assert_eq!(got.len(), ids.len());
            for (n, p) in got.iter().enumerate() {
                assert_eq!(p.app_id, ids[n]);
                assert_eq!(p.total as usize, n % 5 + 1);
                assert_eq!(p.earned, if n % 2 == 0 { 1 } else { 0 });
            }
            let _ = std::fs::remove_dir_all(&root);
        }

        #[test]
        fn categories_merge_modern_collections_with_legacy_tags() {
            let root = fixture_root("categories");
            write(
                format!(r"{root}\userdata\111\config\cloudstorage\cloud-storage-namespace-1.json"),
                br#"[["user-collections.abc",{"value":"{\"name\":\"Favorites\",\"added\":[440,570]}"}],["user-collections.dyn",{"value":"{\"name\":\"Dynamic\"}"}],["other",{"value":"x"}]]"#,
            );
            write(
                format!(r"{root}\userdata\111\7\remote\sharedconfig.vdf"),
                br#""UserRoleConfigStore"
{
    "Software"
    {
        "Valve"
        {
            "Steam"
            {
                "apps"
                {
                    "440"
                    {
                        "tags"
                        {
                            "0"        "Shooter"
                        }
                    }
                    "730"
                    {
                        "tags"
                        {
                            "0"        "FPS"
                            "1"        ""
                        }
                    }
                }
            }
        }
    }
}"#,
            );
            let mut map: HashMap<u32, BTreeSet<String>> = HashMap::new();
            collect_categories(&root, 111, &mut map);
            let names = |id: u32| -> Vec<String> {
                map.get(&id)
                    .map(|set| set.iter().cloned().collect())
                    .unwrap_or_default()
            };
            assert_eq!(names(440), vec!["Favorites", "Shooter"]);
            assert_eq!(
                names(570),
                vec!["Favorites"],
                "dynamic collection adds nothing"
            );
            assert_eq!(names(730), vec!["FPS"], "empty tag is skipped");
            assert!(!map.contains_key(&999));
            let _ = std::fs::remove_dir_all(&root);
        }
    }
}

/// Opt-in live checks against the local Steam client. Read-only — nothing here
/// writes — and `#[ignore]`d, so plain `cargo test` skips them and CI never runs
/// them (it has no logged-in client). On a development machine with Steam running:
///
/// ```text
/// SAM_LIVE_STEAM=1 cargo test --release -- --ignored live_ --nocapture      # bash
/// $env:SAM_LIVE_STEAM=1; cargo test --release -- --ignored live_ --nocapture # PowerShell
/// ```
///
/// `SAM_LIVE_APP_ID` picks the app for the per-game read (default 480, Spacewar,
/// which every account owns). Reading a game puts the account "in" that app on
/// Steam for a moment, exactly as opening it in the app does.
#[cfg(all(test, any(windows, target_os = "macos")))]
mod live_tests {
    use std::sync::{Mutex, MutexGuard};
    use std::time::Instant;

    /// The live checks share one Steam client and one disk, so they run one at a
    /// time (cargo's default is parallel) — otherwise their timings measure each
    /// other. `None` when the opt-in flag is missing.
    static LIVE: Mutex<()> = Mutex::new(());
    fn live_guard() -> Option<MutexGuard<'static, ()>> {
        if std::env::var_os("SAM_LIVE_STEAM").is_none() {
            eprintln!("SAM_LIVE_STEAM is not set — live check skipped");
            return None;
        }
        Some(LIVE.lock().unwrap_or_else(|poisoned| poisoned.into_inner()))
    }

    #[test]
    #[ignore = "needs a running, logged-in Steam client; set SAM_LIVE_STEAM=1"]
    fn live_list_owned_scans_the_library() {
        let Some(_live) = live_guard() else {
            return;
        };
        let started = Instant::now();
        let games = crate::list_owned().expect("ownership scan");
        eprintln!(
            "list_owned: {} games in {:?}",
            games.len(),
            started.elapsed()
        );
        assert!(
            !games.is_empty(),
            "a logged-in account owns at least Spacewar"
        );
        assert!(games.iter().all(|g| g.app_id != 0 && !g.name.is_empty()));
    }

    #[test]
    #[ignore = "needs a running, logged-in Steam client; set SAM_LIVE_STEAM=1"]
    fn live_completion_scan_reads_the_local_cache() {
        let Some(_live) = live_guard() else {
            return;
        };
        let ids: Vec<u32> = crate::list_owned()
            .expect("ownership scan")
            .iter()
            .map(|g| g.app_id)
            .collect();
        let started = Instant::now();
        let progress = crate::completion_local_many(&ids);
        eprintln!(
            "completion_local_many: {} of {} apps have a local cache, {:?}",
            progress.len(),
            ids.len(),
            started.elapsed()
        );
        assert!(progress.iter().all(|p| p.total > 0 && p.earned <= p.total));
    }

    #[test]
    #[ignore = "needs a running, logged-in Steam client; set SAM_LIVE_STEAM=1"]
    fn live_read_game_returns_achievements() {
        let Some(_live) = live_guard() else {
            return;
        };
        let app_id: u32 = std::env::var("SAM_LIVE_APP_ID")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(480);
        let started = Instant::now();
        let game = crate::read_game(app_id).expect("per-game read");
        let with_rarity = game.achievements.iter().filter(|a| a.rarity > 0.0).count();
        eprintln!(
            "read_game({app_id}) \"{}\": {} achievements ({} with rarity), {} stats, {:?}",
            game.name,
            game.achievements.len(),
            with_rarity,
            game.stats.len(),
            started.elapsed()
        );
        assert_eq!(game.app_id, app_id);
        assert!(
            !game.achievements.is_empty(),
            "the app should define achievements"
        );
        assert!(game.achievements.iter().all(|a| !a.id.is_empty()));
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
pub fn write_game(
    app_id: u32,
    ach: &[AchChange],
    stats: &[StatChange],
) -> Result<WriteResult, String> {
    std::env::set_var("SteamAppId", app_id.to_string());
    let client = imp::SteamClient::connect()?;
    client.write_stats(app_id, ach, stats)
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
pub use imp::{completion_local, completion_local_many};

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
pub use imp_macos::{completion_local, completion_local_many, read_categories, SteamClient};

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
pub fn write_game(
    app_id: u32,
    ach: &[AchChange],
    stats: &[StatChange],
) -> Result<WriteResult, String> {
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
pub fn write_game(
    _app_id: u32,
    _ach: &[AchChange],
    _stats: &[StatChange],
) -> Result<WriteResult, String> {
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

#[cfg(not(any(windows, target_os = "macos")))]
pub fn completion_local_many(_app_ids: &[u32]) -> Vec<GameProgress> {
    Vec::new()
}
