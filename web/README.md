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

### Read-only Steam smoke test (safe)
Before the desktop app, you can verify the Steam FFI in isolation. This connects
to your running Steam and prints which of a sample of App IDs you own — it
**never writes** to Steam:
```bash
cd web/steam-core
cargo run --bin probe
```

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
  steam-core/          Rust: internal steamclient.dll FFI (lib) + `probe` bin
  src-tauri/           Tauri v2 app: list_games / load_game / save_changes commands
```

## Phase 2 status & verification boundary

| Piece | State |
|---|---|
| `steam-core` FFI (client init, owned-games list) | **compiles + links** here; live read tested via `cargo run --bin probe` on a machine with Steam |
| Tauri app (`list_games` command + `TauriSource`) | wired; `cargo check` verified |
| `loadGame` / `saveChanges` (achievement read/write) | **stubbed** — next slice (ISteamUserStats013: GetAchievement/SetAchievement/StoreStats) |

**Important:** unlocking achievements / editing stats writes irreversibly to your
real Steam account. Those paths are the user's to run and verify; this repo does
not auto-write to Steam. `steam-core` faithfully replicates SAM's internal-interface
approach (incl. SAM's `GetISteamApps` no-`this` call quirk), but the live behavior
must be confirmed on a machine with Steam running.

The original design handoff bundle is kept under `../_design_src/` for reference;
the design/spec note is in `docs/`.
