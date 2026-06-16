# Steam 整合 + 動態載入 + Routing — 設計

_2026-06-16_

Extends the v1 React port of the Steam Achievement Manager UI with: dynamic data
loading, client-side routing, and (Phase 2) a real local-Steam read/write backend
matching the original SAM's approach.

## Goal mapping

| Request | Phase | How |
|---|---|---|
| 加 routing | 1 | `react-router-dom` (HashRouter) |
| demo 資料換成動態載入 | 1 | async `SamSource` interface + `MockSource` |
| 接真正的 Steam API（原版做法）| 2 | Tauri + Rust FFI to the local steamclient interfaces |

## The seam: `SamSource`

All screens depend only on this async interface, so the data backend is swappable
without touching UI. (`resetStats` stays a client-side revert of unsaved edits, so
it is not part of the source.)

```ts
interface SamSource {
  listGames(): Promise<GameSummary[]>                       // library + sidebar (no achievements)
  loadGame(appId: string): Promise<GameDetail>              // achievements + stats + current state
  saveChanges(appId: string, changes: GameChanges): Promise<SaveResult> // unlock/lock + stats + StoreStats
}

interface GameSummary { appId; name; genre; type; hue; completion?: { earned; total; pct } }
interface GameDetail  { appId; name; genre; hue; appId; lastPlayed; achievements: Achievement[]; stats: Stat[] }
interface GameChanges { achievements: Record<string, boolean>; stats: Record<string, number> }
interface SaveResult  { saved: number }
```

- `MockSource` (Phase 1): wraps the existing 16-game demo data, simulated latency,
  in-session persistence for saves. `completion` populated (cheap).
- `TauriSource` (Phase 2): calls Rust commands. `completion` may be omitted/lazy.
- Selection at runtime: in Tauri → `TauriSource`, else `MockSource` (web build keeps working).

## Phase 1 — data model + routing (fully verifiable here)

### Data model shift (lazy load)
v1 held all 16 games + every achievement in state at once. New model mirrors SAM:
games list loads once; a game's achievements/stats load when opened.

Store holds: `games`/`gamesStatus`/`gamesError`; one **active** game keyed by appId:
`detail`/`detailStatus`/working `achState`,`statState` + baselines `origAch`,`origStat`.
Settings (theme/platform/accent), search/filter/view unchanged. `screen`/`tab`/selected
game are now **derived from the route**, not stored.

### Routing (HashRouter — zero-config across dev/preview/Tauri/static)
```
/                       Library
/game/:appId            Game detail → Achievements (index)
/game/:appId/stats      Game detail → Statistics
/settings               Settings
```
- Layout route renders PageHeader + window (TitleBar + Sidebar + `<Outlet/>`).
- `game/:appId` route: an effect calls `ensureGame(appId)` to load detail; renders
  GameHeader + nested `<Outlet/>` (Achievements / Statistics).
- Navigation replaces state switches: select game → `/game/:appId`; tabs → `/game/:appId(/stats)`;
  back / library nav → `/`; settings → `/settings`. Sidebar highlights active appId from URL.
- Invalid/unknown appId → redirect to `/`.

### Loading / error UI
Library shows a loading state until `listGames` resolves; game detail shows a
loading state until `loadGame` resolves; errors render an inline message.

### Tests / verify
- Unit tests for `MockSource` (list/load/save) + existing logic tests stay green.
- `vite build` clean; browser run: navigate all routes, no console errors.

## Phase 2 — Tauri + Rust local-Steam backend (compile-verified here; live-verified by user)

- Add `src-tauri/`; React becomes the Tauri frontend. Rust exposes commands
  `list_games`, `load_game`, `save_changes` consumed by `TauriSource`.
- Rust replicates SAM's **internal steamclient interface** approach via FFI (not the
  public Steamworks SDK, so the whole library is browsable):
  - locate + load `steamclient.dll` (registry `HKCU\Software\Valve\Steam\SteamPath`)
  - `CreateInterface("SteamClient018")` → `CreateSteamPipe` → `ConnectToGlobalUser`
  - `ISteamApps008.BIsSubscribedApp` over the `games.xml` app list + `ISteamApps001.GetAppData` (name/capsule)
  - `ISteamUserStats013`: `RequestCurrentStats`, `GetAchievement`/`GetStatValue` (read),
    `SetAchievement`/`ClearAchievement`/`SetStat` + `StoreStats`, `ResetAllStats` (write)
  - per-appId Steam init (per-app worker process, as SAM does)

### Verification boundary (important)
- Phase 1: fully verified in this environment.
- Phase 2: only **compiles** + architecture verified here. Real read/write requires the
  user's machine with Steam running and an owned game. Unlocking real achievements is an
  irreversible write to the user's account and will **not** be auto-tested by the agent.
