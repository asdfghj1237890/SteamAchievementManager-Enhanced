# AGENTS.md

給 coding agents（Claude Code、Codex 等）的 repo 指引。`CLAUDE.md` 直接 import 本檔，規則只寫在這裡。使用者當下的指示優先於本檔。

## 專案

Steam Achievement Manager 的 fork。主線是 `web/`：React 19 + TypeScript 7 + Vite 8 前端、Tauri 2 桌面殼，加上 Rust `steam-core`，透過 steamclient 的內部 vtable 讀寫**真實的** Steam 成就與統計（Windows、macOS Apple Silicon）。Web build 用假資料（`MockSource`），不碰 Steam。

根目錄的 `SAM.API/`、`SAM.Game/`、`SAM.Picker/` 是上游的 legacy C# WinForms，只當 FFI 參考。除非使用者明確要求，不要審查、修改或回報它們的問題。

## 指令（在 `web/` 下執行）

| 用途 | 指令 |
|---|---|
| 安裝 | `npm ci` |
| Web demo（假資料） | `npm run dev` → http://localhost:5173 |
| 桌面 app（Steam 要在執行中且已登入） | `npm run tauri -- dev` |
| 型別、lint | `npm run typecheck`、`npm run lint`（oxlint） |
| 單元測試 + 覆蓋率門檻 | `npm run test:coverage` |
| 瀏覽器 e2e（Chromium、Firefox、WebKit） | `npm run test:e2e` |
| Rust 測試；fmt + clippy | `npm run test:rust`；`npm run lint:rust` |
| Native debug build + smoke | `npm run test:native` |
| 與 CI 相同的全套 | `npm run test:all` |

`npm test` 只跑 Vitest，**不等於 CI**。

## 架構

- `web/src/data/source.ts`：`SamSource` 介面，所有畫面只依賴它。`mockSource.ts` 給 web、`tauriSource.ts` 給桌面，`index.ts` 在執行期挑選。網址加 `?mock=large` 會換成 2000 款遊戲的壓力測試資料。
- `web/src/state/`：`store.ts`（state、reducer、初始設定）、`AppContext.tsx`（路由相關 action、存檔、更新）。
- `web/src/components/`、`web/src/lib/`；`web/src/i18n/index.ts` 單一檔案放 10 個語系。
- `web/src-tauri/src/lib.rs`：Tauri commands。每個遊戲的讀寫在獨立的 worker 子行程（`--steam-worker`）裡做；library 完成度則直接讀本機快取，不開任何 Steam 介面。
- `web/steam-core/src/lib.rs`（Windows，`steamclient.dll`）與 `imp_macos.rs`（macOS，`dlopen` `steamclient.dylib`）。兩平台共用的邏輯（KV/VDF 解析、schema 權限、帳號挑選）放在 `lib.rs` 頂層。
- `web/scripts/`：CI 與發佈用腳本。`release-manifest.mjs` 產生 updater 用的 `latest.json`。
- 深入文件：`web/TESTING.md`（測試分層、CI、發佈與簽章）、`web/README.md`（資料層、各平台驗證邊界）。

## 規則

### 一律

- 寫入 Steam 的路徑 fail closed：不在 schema 權限表裡的成就 ID、protected、increment-only 的項目一律拒絕。
- 存檔契約是 `WriteResult { saved, rejected }`。UI 用 `rejected.length > 0` 判斷部分儲存，再由 `applyPartialSave` 合併存檔期間的新編輯。兩層都要保留，不要二選一。
- 新增 i18n key 要補齊 10 個語系，`{placeholder}` 名稱要跟 zh-TW 一致。
- 動畫時長用 `index.css` 的 `--m-fast`、`--m-base`、`--m-slow`、`--m-ease`，不要寫死秒數；`prefers-reduced-motion` 會把它們歸零。
- 從 `react-router` import；v8 起不再發佈 `react-router-dom`。
- macOS 相關改動要對稱：
  - `imp_macos.rs` 跟著 `lib.rs` 的 Windows 路徑一起改。
  - `tauri.macos.conf.json` 必須完整重複主視窗設定（Tauri 用 JSON Merge Patch，陣列會整個被取代），只有 `decorations`、`titleBarStyle`、`hiddenTitle` 可以不同。`src/__tests__/tauriConfig.test.ts` 會檢查。
- 發佈流程的邏輯寫成 `web/scripts/*.mjs` 並加測試，不要直接寫在 workflow YAML 裡。

### 先問

- 任何會真的寫入 Steam 帳號的操作，包括手動在 app 裡存檔。
- push、打 tag、觸發 release、改 GitHub secrets 或 repo 設定。
- 在 `web/scripts/audit-gate.mjs` 的 `ALLOWED` 加例外。優先升級修掉。
- 新增依賴。

### 絕不

- 讓自動化測試寫入真實 Steam。需要真 Steam 的 Rust 測試要加 `#[ignore]`，並檢查 `SAM_LIVE_STEAM=1`。
- 為了讀進度而啟動遊戲。Library 進度只讀 `appcache/stats/*.bin`。
- 把 updater 私鑰或任何密鑰放進 repo。私鑰在維護者本機，CI 用 secrets `TAURI_SIGNING_PRIVATE_KEY`、`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`。
- 讓主視窗一建立就可見。它是 `visible: false`，由 `AppLayout` 首次 commit 呼叫 `winShow()`，Rust 端 3 秒後保底 show，這樣啟動時才不會先閃一片白。

## 品質關卡（依改動類型）

宣稱完成前，跑對應的指令並看過輸出：

| 改動 | 至少要跑 |
|---|---|
| 前端邏輯、元件 | `typecheck`、`lint`、`test:coverage`（含門檻）、`build` |
| 使用者看得到的 UI | 上一列全部 + `test:e2e`，並在 dev server 上實際看過 |
| Rust | `test:rust`、`lint:rust` |
| Tauri 設定、commands、啟動流程 | Rust 那一列 + `test:native` |
| Workflow、發佈腳本 | 腳本的 Vitest 測試 + YAML 解析。實際發佈行為要等下次 release 才驗得到，回報時要講明 |
| 依賴升級 | `test:all` + `node scripts/audit-gate.mjs` |

覆蓋率門檻：整體 70/60/70/70，`src/{data,lib,state}/**/*.ts` 85/70/85/85（statements/branches/functions/lines）。加 memo 或做熱路徑優化時，擴充 `src/__tests__/renderCounts.test.tsx` 來證明，不要只靠推理。

## 常見陷阱

- 非 CI 環境下 Playwright 會 `reuseExistingServer`，固定連 5173。如果別的專案的 Vite 佔著 5173，整套 e2e 會對錯的 app 跑然後失敗。先確認 port，必要時用另一個 port 的臨時設定。
- Playwright 升版後，本機要先 `npm exec -- playwright install chromium firefox webkit`。
- 在 Windows 上 `cfg(target_os = "macos")` 的程式碼不會編譯。只在 Windows 分支用到的 helper，在 macOS 會變成 dead code，讓 CI 的 clippy `-D warnings` 失敗；要測試的話用 `#[cfg(any(windows, test))]`。macOS 的最終檢查是 CI 的 macOS job。
- Lint 用 oxlint 而不是 ESLint，因為 typescript-eslint 還不支援 TypeScript 7。
- `vitest` 與 `@vitest/coverage-v8` 互相鎖定版本，只能一起升；Dependabot 已經設好群組。
- DMG 背景要淺色：有背景圖時，Finder 的圖示標籤一律是黑字。

## 已決定，不要再提

- **作業系統層的程式碼簽章**（Authenticode、Apple Developer ID + notarization）還沒做。需要付費憑證，由維護者決定。App 內更新已經有 minisign 驗簽。不要當成新發現回報。
- **不新增 `SteamClientApi` trait**。win/mac 對稱、cfg-gated 的 free functions 已經在編譯期釘住介面，trait 只會多一層轉發。
- **macOS 上沒有本機快取的遊戲不顯示完成度**。外部行程走不了 `IClientUserStats`（`CreateSteamPipe` 回傳 0）。
- **Legacy C# 的已知問題刻意不處理**：成就寫入沒檢查 Permission、stat 沒套 schema 限制、`SetDllDirectory` 的 DLL 搜尋路徑。

## 提交

- Conventional Commits：`feat:`、`fix:`、`test:`、`ci:`、`docs:`、`build(deps):`。
- 決策的來龍去脈寫在 commit message 或 PR 描述，不要寫回本檔。本檔只放長期有效的規則。
