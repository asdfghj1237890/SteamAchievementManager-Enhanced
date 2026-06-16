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

Supported live today: **Windows** (read + write) and **macOS / Apple Silicon**
(read only — list games, read achievements/stats). Writing achievements/stats is
not yet implemented on macOS and returns a clear error
(`macOS 寫入支援尚在開發（本階段僅讀取）`). On macOS, `steamclient.dylib` is
loaded via `dlopen` (see `steam-core/src/imp_macos.rs`); the Windows path is
unchanged.

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
| `loadGame` (achievement read) | **live on Windows + macOS** (ISteamUserStats013: RequestUserStats / GetAchievement* / stats) |
| `saveChanges` (achievement write) | **Windows only**. macOS write path deferred — returns a clear "not yet" error this milestone (next slice: SetAchievement/StoreStats on macOS, user-verified) |

**Important:** unlocking achievements / editing stats writes irreversibly to your
real Steam account. Those paths are the user's to run and verify; this repo does
not auto-write to Steam. `steam-core` faithfully replicates SAM's internal-interface
approach (incl. SAM's `GetISteamApps` no-`this` call quirk), but the live behavior
must be confirmed on a machine with Steam running.

The original design handoff bundle is kept under `../_design_src/` for reference;
the design/spec note is in `docs/`.
