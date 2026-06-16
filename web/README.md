# Steam 成就管理器 — 介面重構

A modern UI redesign of **Steam Achievement Manager (SAM)** — React + Vite +
TypeScript — that runs two ways:

- **Web build** — the full UI driven by a bundled demo data source (`MockSource`),
  fictional games, nothing talks to Steam.
- **Desktop build (Tauri)** — the same UI talking to the **real local Steam
  client** through a Rust FFI layer (`steam-core`), the way the original C# SAM
  does (internal `steamclient.dll` interfaces, not the public Web API/SDK).

The UI is a faithful port of the [Claude Design](https://claude.ai/design)
handoff; every color/size/layout value is kept 1:1.

## The seam: `SamSource`

Every screen depends only on one async interface, so the data backend is
swappable without touching UI:

```ts
interface SamSource {
  listGames(): Promise<GameSummary[]>
  loadGame(appId): Promise<Game>
  saveChanges(appId, changes): Promise<SaveResult>
}
```

`getSource()` picks the implementation at runtime: `TauriSource` inside the Tauri
shell, otherwise `MockSource`.

## Screens & routing (HashRouter)

```
/                    遊戲庫 (library)
/game/:appId         成就 (achievements)
/game/:appId/stats   統計 (statistics)
/settings            設定 (theme / window style / accent)
```

Library and game detail load **lazily** (games list on mount; a game's
achievements/stats when opened), mirroring SAM's picker → manager flow.

## Run

### Web (demo data — fully working today)
```bash
cd web
npm install
npm run dev       # http://localhost:5173
npm run build     # tsc -b + vite build
npm test          # vitest (logic + MockSource)
```

### Desktop (real Steam — Phase 2)
Requires Rust + the Tauri CLI (`cargo install tauri-cli`). **Steam must be
running and logged in.**
```bash
cd web
cargo tauri dev   # builds src-tauri + loads the Vite UI in a desktop window
```

Supported live today on **Windows** and **macOS / Apple Silicon**: list games,
read achievements/stats, and **write** (unlock/clear achievements, set stats,
StoreStats). On macOS, `steamclient.dylib` is loaded via `dlopen` (see
`steam-core/src/imp_macos.rs`); the Windows path is unchanged.

**Writing is irreversible** — unlocking/clearing achievements and editing stats
changes your real Steam account immediately. The macOS write path was validated
with an idempotent re-set of an already-unlocked achievement (no net change);
clearing achievements is the user's to verify.

### Read-only Steam smoke test (safe)
Before the desktop app, you can verify the Steam FFI in isolation. These connect
to your running Steam and **never write** to it:
```bash
cd web/steam-core
cargo run --bin probe 3350200 3478050   # check specific app ids (fast)
cargo run --bin probe                     # full library scan via the SAM list
cargo run --bin read-game <appId>         # dump one game's achievements/stats
```
On macOS these exercise the `dlopen`-based `imp_macos` layer; on Windows, the
`steamclient.dll` layer.

## Layout

```
web/
  src/
    data/
      source.ts        SamSource interface + types
      mockSource.ts     demo data source (web)
      tauriSource.ts    real source → Rust commands (desktop)
      steamAppIds.ts    candidate App IDs for ownership check (slice)
      index.ts          getSource() factory (Tauri vs Mock)
      games.ts          16 fictional games (demo data)
    lib/                theme, achievements logic, library, styles, hooks
    state/              store (async) + AppContext (route-aware actions)
    components/         AppLayout, TitleBar, Sidebar, Library, GameScreen,
                        GameHeader, Achievements, Statistics, Settings, Toast, Panes, ui/Seg
  steam-core/          Rust: internal Steam FFI — imp (steamclient.dll, Windows)
                        + imp_macos (steamclient.dylib via dlopen) + probe/read-game bins
  src-tauri/           Tauri v2 app: list_games / load_game / save_changes commands
```

## Phase 2 status & verification boundary

| Piece | State |
|---|---|
| `steam-core` FFI (client init, owned-games list) | **Windows + macOS (arm64)**: live-validated. macOS via `dlopen` (`imp_macos`); owned-games + per-game achievement read confirmed against running Steam (`cargo run --bin probe <appid>`, `cargo run --bin read-game <appid>`) on an Apple Silicon machine |
| Tauri app (`list_games` command + `TauriSource`) | wired; `cargo check`/`cargo build` verified on Windows + macOS |
| `loadGame` (achievement read) | **live on Windows + macOS** (ISteamUserStats013: RequestUserStats / GetAchievement* / stats). For a game whose schema isn't cached on disk yet, the schema downloads asynchronously — `prepare_stats` waits for that app's `UserStatsReceived` with `k_EResultOK` (not the first callback), so achievements load correctly on the **first** open |
| `saveChanges` (achievement write) | **live on Windows + macOS** (ISteamUserStats013: SetAchievement/ClearAchievement/SetStat/StoreStats). macOS validated via an idempotent re-set; clears are user-verified |
| Library progress bars | `completion_local` reads Steam's on-disk stats cache (`appcache/stats/*.bin`), so bars fill only for games Steam has cached locally — same on both platforms (no game is launched, no cloud sync). Full-library progress *without* a local cache would need the internal `IClientUserStats` path, which is **blocked for an external process on macOS** (`CreateSteamPipe` via the client engine returns 0); see [docs/superpowers/specs/2026-06-16-clientuserstats-spike-results.md](docs/superpowers/specs/2026-06-16-clientuserstats-spike-results.md). The pragmatic alternative is the Steam Web API |

**Important:** unlocking achievements / editing stats writes irreversibly to your
real Steam account. Those paths are the user's to run and verify; this repo does
not auto-write to Steam. `steam-core` faithfully replicates SAM's internal-interface
approach (incl. SAM's `GetISteamApps` no-`this` call quirk), but the live behavior
must be confirmed on a machine with Steam running.

The original design handoff bundle is kept under `../_design_src/` for reference;
the design/spec note is in `docs/`.
