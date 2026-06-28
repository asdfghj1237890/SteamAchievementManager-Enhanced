# Claude Local Notes

本檔是給 Claude/Codex 類本地 agents 的 repo-local 備忘。優先遵守使用者當前指示；若沒有新指示，依照以下內容工作。

## Review Context

- 目前主線是 `web/` 的 React + Tauri v2 + Rust `steam-core` app。
- Legacy WinForms 專案仍在 repo 內：`SAM.API/`、`SAM.Game/`、`SAM.Picker/`。
- 使用者已指示：**ignore 對於舊版設計的 concern**。除非使用者明確要求 review/fix legacy WinForms，請不要把舊版 WinForms 設計、安全或效能 concern 當成待辦或 release blocker。

## Current Tracked Concerns

- 目前沒有開放中的 repo-local tracked concern。

## Recently Fixed

- Rust/Tauri 寫入路徑已改為 fail closed：achievement ID 若不在 schema permission map 內，會拒絕寫入，而不是視為 permission `0` 可寫。
  - Windows path: `web/steam-core/src/lib.rs`
  - macOS path: `web/steam-core/src/imp_macos.rs`
  - 測試：`achievement_write_allowed_rejects_protected_and_unknown_ids`

## Legacy Findings To Ignore For Now

以下 findings 已知但暫不追蹤，因為使用者要求忽略舊版設計 concern：

- `SAM.Game.exe` achievement write path 未檢查 `Permission`。
- `SAM.Game.exe` stat write path 未套用 schema `min/max/maxchange/incrementonly`。
- `SAM.API/Steam.cs` 使用 `SetDllDirectory(path + ";" + binPath)` 的 legacy DLL search 設計。

## Verification Notes

最近一次全 repo review 已跑過：

- `npm test`
- `npm run build`
- `cargo test` in `web/steam-core`
- `cargo test` in `web/src-tauri`
- `cargo clippy --all-targets --all-features -- -D warnings` in both Rust crates
- `npm audit --omit=dev`
- `cargo audit`
- `npx @tauri-apps/cli@^2 build --debug --no-bundle --ci`

注意：本機沒有 `dotnet`，legacy C# 未編譯驗證。
