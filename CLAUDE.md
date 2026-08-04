# Claude Local Notes

本檔是給 Claude/Codex 類本地 agents 的 repo-local 備忘。優先遵守使用者當前指示；若沒有新指示，依照以下內容工作。

## Review Context

- 目前主線是 `web/` 的 React + Tauri v2 + Rust `steam-core` app。
- Legacy WinForms 專案仍在 repo 內：`SAM.API/`、`SAM.Game/`、`SAM.Picker/`。
- 使用者已指示：**ignore 對於舊版設計的 concern**。除非使用者明確要求 review/fix legacy WinForms，請不要把舊版 WinForms 設計、安全或效能 concern 當成待辦或 release blocker。

## Current Tracked Concerns

- **[安全/需決策] 更新流程無簽章驗證**（唯一仍開放項）：`latest_version()` 僅抓版本字串、`open_releases()` 開固定 GitHub Releases 頁供手動下載未簽章安裝檔（無 tauri-plugin-updater / pubkey）。需簽章金鑰 + CI 變更，屬 secops 決策，未自動實作。註：`open_releases` URL 為寫死，偽造的 latest.json 只能改顯示的版本字串、無法改下載目的地。
- **[架構/已評估不做] `SteamClientApi` 統一 trait**：win/mac 的 client contract 其實已由對稱、cfg-gated 的 free functions（`read_game`/`write_game`/`list_owned` 各自呼叫該平台 client 的方法）在編譯期釘住——任一平台方法或簽章 drift 會直接讓該平台的 free function 編譯失敗。額外 trait 只是重複 forwarding boilerplate，不增安全性；stub 刻意精簡（其 free functions 直接回 Err，不經 client 方法）。故不新增。

（原先此處列的 `saved<n` 誤判、completion 雙來源、bulk/reset+關窗未存提醒、aria-label 寫死——皆已於下方 deferred-fix batch 修復。）

## Recently Fixed

- **(2026-07-06 deferred-fix batch)** 上一輪標記的項目已實作並驗證（steam-core+src-tauri cargo test/clippy、npm build tsc、npm test 49 pass 全綠）：
  - **Save 契約**：`write_game`/`write_stats` 改回傳 `WriteResult { saved, rejected: Vec<String> }`（win+mac+stub、worker JSON、`SaveResult`、`store()` 一路貫通）。UI 改以 `rejected.length > 0` 判斷部分儲存，不再用 `saved < n`——修掉「no-op 重寫被 Steam 回報未套用」而誤判成拒絕的假 partial-save。
  - **未存變更保護**：新增 `ConfirmDialog` + AppContext `requestConfirm`/`confirmResolve`；bulk 解鎖/鎖定/反向、reset stats、切換遊戲、關窗（Tauri `onCloseRequested`）在有未存編輯時先確認。新增 `confirm.*` i18n（7×10 語系）。
  - **completion 單一來源**：背景 completion loader 跳過已載入詳情的遊戲，避免磁碟快取覆蓋即時值造成側欄閃動。
  - **清理**：移除 dead FFI `progress_game`/`count_achievements`（win/mac/stub，grep 確認無呼叫者）。
  - **a11y i18n**：TitleBar 視窗控制與 UpdateBanner 的 aria-label 改走 i18n（`a11y.*`，4×10 語系）。
- **(2026-07-06 web/ scan)** 安全/正確性/效能/UX 一輪修復（全數 npm test 49 pass、npm build tsc 乾淨、steam-core cargo test+clippy、src-tauri clippy 全綠）：
  - 安全：`parse_kv_children`/`parse_vdf` 加遞迴深度上限（防 crafted schema/vdf stack-overflow，新增 `parse_kv_depth_guard` 測試）；`read_stats` 的 `CString::new(id).unwrap()`→`match…continue`（lib.rs + imp_macos.rs）；`list_games` `app_ids` 長度上限；CSP `connect-src` 移除 2 個 webview 未用來源；成就 icon 檔名 `encodeURIComponent`。
  - 正確性：`TauriSource` achievement `points` 改由 rarity 推導（原寫死 0）；`Stat.isFloat` 帶過 seam，整數 stat 於 `setStat` 截斷。
  - 效能：`completionFor` O(n)→Map；`Achievements`/`Sidebar` 清單衍生值 `useMemo`；`Cover` `<img>` 移除 `key={src}` remount。
  - a11y/UX：成就切換、遊戲列、library 卡片可鍵盤操作（role/tabIndex/Enter+Space/aria-label）；Save 進行中禁用；加入 App ID 內嵌錯誤＋Enter 送出；移除 4 個未用 i18n keys。
  - 註：`imp_macos.rs` 為 macOS-only，本機 Windows 未編譯，改動與已編譯 Windows 路徑字元級一致。
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
