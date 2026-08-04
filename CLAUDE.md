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

- **(2026-08-04 React 19 + react-router 8)** 使用者指示升級。原本掛在 tracked concerns 的 `GHSA-qwww-vcr4-c8h2`（react-router RSC Mode CSRF）**改為真正修復，不再是「判定不可達所以接受」**：
  - `react`/`react-dom` 18.3.1 → 19.2.8（含 `@types`）。**零程式碼改動**——沒用到 v19 移除的 `ReactDOM.render`、PropTypes、string refs，`createRoot` 一路沿用。
  - `react-router-dom` 7.18.2 → `react-router` 8.3.0。v8 起不再發佈 `react-router-dom`（npm 最新永遠停在 7.18.2），所以 9 處 import 全改成 `from 'react-router'`（8 個 src + `App.ui.test.tsx`）。用到的 API（`HashRouter`/`Routes`/`Route`/`Navigate`/`Outlet`/`useParams`/`useNavigate`/`useLocation`）在 v8 簽章不變。
  - **CI Node 20 → 24**（`test.yml` 3 處 + `release.yml` 2 處）：react-router 8 的 `engines` 要求 `node >= 22.22.0`，不改 CI 會裝到不符引擎的 Node。本機是 24.18.0，選 24 讓 CI 與開發環境一致。
  - **`audit-gate.mjs` 的 `ALLOWED` 已清空**。腳本內建的「allowlist 過期」偵測正確報出該刪（`npm audit` 不再回報該 advisory）。往後優先修復、而非加入 allowlist。
  - 驗證：`npm audit` **found 0 vulnerabilities**、typecheck/build 乾淨、`npm test` 58 pass、dev server 實跑（library → game → stats → catch-all 導回 → settings）console 零錯誤。Bundle gzip 97.87 → 110.78 kB。
- **(2026-08-04 merge origin/master ← 1.2.5-era batch)** 本機那批 1.2.5 時代的修復與遠端 1.2.6/1.2.7 線（批次 library 掃描、自動化測試框架、圖片 lazy-load 修復）合併。7 個檔衝突，取捨如下，**後續不要再「二選一」地回頭改**：
  - **partial-save 保留兩層，不是二選一**：Rust `WriteResult { saved, rejected }` 當偵測訊號（`AppContext` 的 `res.rejected.length > 0`），遠端的 `applyPartialSave` 當狀態合流（能保住存檔期間使用者新做的編輯）。兩邊當初獨立收斂到同一設計，所以寫入路徑幾乎自動併乾淨。
  - **completion 載入器**：採遠端的單次批次 API `loadProgressBatch`（取代原本 3-worker 逐一 `loadProgress`），但把「跳過已載入詳情的遊戲」過濾器接回去——少了它，側欄完成度會被磁碟快取覆蓋而閃動。
  - **鍵盤操作**：統一用 `lib/a11y.ts` 的 `activate()` helper（語意與遠端 inline handler 等價），同時保留遠端的 `data-testid`（`App.ui.test.tsx` 靠它抓元素）與較完整的 `aria-label`（含 `stateText`）。
  - **Rust import**：`GameProgress`（遠端 `game_progress_many` 在用）與 `WriteResult`（寫入路徑在用）都還活著，取聯集。
  - **v7 遷移點**：`HashRouter` 的 `future={{ v7_startTransition, v7_relativeSplatPath }}` 是 v6 opt-in flag，v7 已成預設且該 prop 不再接受，`main.tsx` 與 `App.ui.test.tsx` 各刪一處。
  - **兩個測試更新為合併後契約**：`tauriSource.test.ts` 的 `saveChanges` 預期補上 `rejected: []`；`App.ui.test.tsx` 的旅程在離開有未存編輯的遊戲時補一步確認離開（順帶把未存變更守衛納入覆蓋）。
  - 驗證：`npm run build` 乾淨、`npm test` 58 pass（12 檔）、steam-core `cargo test` 9 pass + clippy、src-tauri workspace test + clippy 全綠、dev server 實跑路由與 catch-all 無 console 錯誤。
  - **本輪教訓：`npm test` 只是 vitest，不等於 CI。** 這個 repo 的 CI 另外把關 `npm run test:e2e`（Playwright，4 個瀏覽器）、`cargo fmt --check`、`npm audit`。第一次推上去 master 就因為這三項全紅。要對齊 CI 請跑 `npm run test:all`（或至少 `test:web` + `lint:rust`），不要只跑 `npm test` 就宣稱綠燈。
- **(2026-08-04 CI 修復)** 上面那次合併推上去後 CI 三處失敗，已修：
  - `cargo fmt --check`：`WriteResult` 讓兩個 `write_game` 簽章超過 100 字元，手動解衝突時沒照 rustfmt 換行。
  - e2e `ui.spec.ts` 的 "edits a stat and persists appearance preferences"：與 vitest 那個同因——未存的統計編輯讓守衛擋住往設定頁的導航，補一步點 Leave。
  - `npm audit` 關卡：改走新增的 `web/scripts/audit-gate.mjs`（workflow 的 `npm audit` 換成 `node scripts/audit-gate.mjs`）。它跑 `npm audit --json`，只放行 `ALLOWED` 裡列出且附理由的 GHSA，其餘照樣 fail。已驗證：allowlist 清空時 exit 1、有 entry 時 exit 0，不是永遠綠的假關卡。
- **(2026-08-04 Dependabot 依賴更新)** 清掉當時 4 個 open alerts（#7 #8 #9 #10）：
  - `postcss` 8.5.15 → 8.5.25（dev-only，經 vite 傳遞；順帶吃掉 npm advisory DB 多列的 `GHSA-fxqj-rqcc-2cmp`）。lockfile 內版本提升，vite 8.0.16 要的是 `^8.5.15`，無破壞性。
  - `react-router-dom` 6.30.4 → 7.18.2。**原始碼零改動**——v7 的 `react-router-dom` 只是 `react-router` 的 re-export shim，8 處 import 原封不動通過 `tsc -b`。專案用宣告式 `HashRouter`，v7 那些 future flags 只影響 data router / splat 相對路由，皆未使用。6.x 對 `GHSA-jjmj-jmhj-qwj2` 永遠不會有 patch，所以只能上 v7。
  - 註：這 4 個 advisory 在本 app 其實**都不可達**——三個 open-redirect 類需要攻擊者可控字串進 `to`/`navigate()`，但導航目標全是字面量前綴 + 經 `/^\d+$/` 驗證的 appId（`AppContext.tsx` 的 `navigate` 呼叫、`Sidebar.tsx` 的 `onAdd`）；`deserializeErrors` 需要 SSR hydration；postcss 是 build-time 且 CSS 全為第一方。升級目的是清 alert 佇列，不是修可利用漏洞。副作用見上方 tracked concern（換來一個同樣不可達的 high）。
  - 驗證：`npm run build`（tsc -b + vite build）乾淨、`npm test` 49 pass、起 dev server 實跑路由一輪（library → game → stats → 亂打 hash 觸發 `*` 導回 `/` → settings → 冷啟深連結 → 未存變更守衛擋住＋放行）console 零錯誤。bundle gzip 91.64 → 98.78 kB。
  - 新增 `.github/dependabot.yml`：npm `/web`、cargo `/web/src-tauri`、cargo `/web/steam-core`、github-actions `/`，皆 weekly，dev deps 分組。Legacy WinForms 依既有指示未納入。
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
