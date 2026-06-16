# Steam Achievement Manager — Enhanced

[![License: zlib](https://img.shields.io/badge/License-zlib-blue.svg)](LICENSE.txt)
![Desktop: Windows](https://img.shields.io/badge/desktop-Windows-0078D6?logo=windows&logoColor=white)
![Desktop: macOS](https://img.shields.io/badge/desktop-macOS_Apple_Silicon-555555?logo=apple&logoColor=white)
![React 18](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)
![Vite 5](https://img.shields.io/badge/Vite-5-646CFF?logo=vite&logoColor=white)
![TypeScript 5](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![Tauri 2](https://img.shields.io/badge/Tauri-2-FFC131?logo=tauri&logoColor=black)
![Rust](https://img.shields.io/badge/Rust-stable-000000?logo=rust&logoColor=white)
![i18n: 10 languages](https://img.shields.io/badge/i18n-10_languages-success)

An enhanced fork of [gibbed's **Steam Achievement Manager (SAM)**](https://github.com/gibbed/SteamAchievementManager) that adds a **modern desktop app** — a full UI redesign built with React + Vite + TypeScript and a native **Tauri + Rust** shell — while keeping the original C# SAM intact in this repository.

Like the original, it reads and writes Steam achievements and statistics through the **internal `steamclient.dll` interfaces** (not the public Web API / Steamworks SDK), so it operates against your local, logged-in Steam client.

> **Requirements:** the [Steam client](https://store.steampowered.com/about/) installed, a Steam account, and Steam running + logged in. The desktop (real-Steam) build runs on **Windows** and **macOS (Apple Silicon)** — on macOS it loads `steamclient.dylib` via `dlopen` (see [`web/steam-core/src/imp_macos.rs`](web/steam-core/src/imp_macos.rs)); the Windows path is unchanged.

> **⚠️ This tool writes to your real Steam account.** Unlocking achievements and editing stats is irreversible from the tool's side. Protected and increment-only entries are surfaced and blocked accordingly — but use it on your own account and understand what you change.

---

## ✨ What's enhanced

The new desktop app (in [`web/`](web/)) is a ground-up modern rewrite of the SAM interface:

- **Single-window experience** — Library, Achievements, Statistics, and Settings in one cohesive window with a custom titlebar.
- **Real local Steam read/write** — your owned-games library, achievements (unlock / lock), and stats (edit), written back through the same internal interfaces the original uses, isolated in per-game worker processes. Works on **Windows and macOS (Apple Silicon)** — the macOS port (`steamclient.dylib` via `dlopen`) is read/write; opening a game whose stats aren't cached yet downloads its schema on the first open, so achievements load on the first click.
- **Completion without launching games** — library progress is read straight from Steam's local stats cache (`appcache/stats/*.bin`), so opening the library never launches a game or triggers a cloud-save conflict. This is SAM's approach: no game is ever started just to read its progress.
- **Real Steam art** — game header covers and per-achievement icons pulled from Steam's CDN; greyed icons for locked achievements.
- **Real unlock dates & global rarity %** — shown per achievement.
- **Statistics editor** — view and edit INT / FLOAT stats, with `protected` and `increment-only` flags honored.
- **10-language UI** — 繁體中文 · 简体中文 · English · Español · Português · Français · Deutsch · Italiano · 日本語 · 한국어 — switchable live in Settings (game and achievement names still come from Steam in the game's language).
- **Add by App ID** — open any game, including ones not auto-detected in your library.
- **Polish** — light / dark theme, macOS / Windows window chrome, accent colors, a drag-resizable game list, and an instant local cache for fast launches. Every preference persists.

## 🧱 Tech stack & architecture

| Layer | Tech |
|---|---|
| Frontend | React 18 · Vite 5 · TypeScript · react-router (HashRouter) |
| Desktop shell | Tauri 2 (frameless window + custom titlebar) |
| Steam layer | [`web/steam-core`](web/steam-core) — a Rust crate that calls the internal `steamclient.dll` vtable interfaces (ported from SAM's C# interop) and parses Steam's binary KeyValues stats cache/schema |

**The seam — `SamSource`.** Every screen depends on a single async `SamSource` interface, so the data backend is swappable without touching the UI:

- `MockSource` — bundled demo data (fictional games, nothing touches Steam) — powers the **web build**.
- `TauriSource` — the **real local Steam** client via the Rust `steam-core` layer — powers the **desktop build**.

## 🚀 Build & run

The modern app lives in [`web/`](web/):

```bash
cd web
npm install

# Web demo — mock data, no Steam, runs in a browser
npm run dev

# Desktop app — real local Steam (Windows or macOS/Apple Silicon;
# needs the Rust toolchain + the Tauri CLI). Steam must be running + logged in.
npx @tauri-apps/cli@^2 dev    # or: cargo tauri dev (after `cargo install tauri-cli`)

# Production desktop build (installer / .app)
npx @tauri-apps/cli@^2 build
```

> Read-only Steam smoke tests (safe, never write): from [`web/steam-core`](web/steam-core),
> `cargo run --bin probe <appId>…` checks ownership and `cargo run --bin read-game <appId>`
> dumps a game's achievements/stats. See [`web/README.md`](web/README.md#phase-2-status--verification-boundary)
> for the per-platform verification boundary.

See [`web/README.md`](web/README.md) for a deeper dive into the data layer and the Rust Steam core.

## 📦 The original SAM (C#)

This repository still contains gibbed's original closed-source-turned-open C# SAM (`SAM.API`, `SAM.Game`, `SAM.Picker`), buildable from the Visual Studio solution at the repo root. The original `steamclient.dll` interop in those projects is the reference the Rust `steam-core` layer was ported from.

## Attribution & license

- Based on [gibbed/SteamAchievementManager](https://github.com/gibbed/SteamAchievementManager) by Rick (gibbed), © 2024.
- Licensed under the **zlib License**, same as upstream — see [LICENSE.txt](LICENSE.txt). Per the license, this is an altered version and is marked as such.
- Original icons are from the [Fugue Icons](https://p.yusukekamiyamane.com/) set.
- The modern UI is a port of a [Claude Design](https://claude.ai/design) handoff.
- Steam is a trademark of Valve Corporation. This project is not affiliated with, endorsed by, or sponsored by Valve.
