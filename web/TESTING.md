# Automated testing

The modern React + Tauri application is protected by five complementary
layers. All JavaScript commands use dependencies installed from
`package-lock.json`.

| Layer | Command | Coverage |
|---|---|---|
| Static checks | `npm run typecheck`, `npm run lint` | `tsc -b`, and oxlint with `react-hooks/rules-of-hooks` + `react-hooks/exhaustive-deps` as errors (the mechanical guard for `useMemo`/`useCallback` dependency lists) |
| Unit and state logic | `npm test` | Achievement rules, merging, caches, versioning, virtualization, themes, `MockSource`, and the completion-batch filter |
| Provider, component, and IPC integration | `npm test` | `AppProvider` driven through `renderHook` with a recording fake source (completion batching, silent-reload TTL, save diff, partial-save merge), a full React journey with Testing Library, render-count guards for the memoized hot paths, and the renderer-to-Tauri command contract |
| Browser UI, smoke, accessibility | `npm run test:e2e` | Chromium, Firefox, WebKit; route smoke, edit/save journeys, runtime errors, persistence, and axe WCAG A/AA |
| Native and Rust | commands below | Both Rust crates (pure rules plus file-only paths against synthetic Steam cache fixtures), clippy, a real Tauri debug build, and headless worker dispatch |

## One-time setup

```bash
cd web
npm ci
npm exec -- playwright install chromium firefox webkit
```

CI uses `npm exec -- playwright install --with-deps <browser>`, so browser
revisions come from the lockfile-pinned Playwright CLI rather than a floating
global install.

## Fast local loop

```bash
npm run typecheck
npm run lint
npm test
npm run test:coverage
npm run build
```

`npm run lint` runs oxlint (`.oxlintrc.json`) with warnings denied. It exists
for the two React Hooks rules; `react/refs` and `react/set-state-in-effect` are
switched off on purpose because they flag patterns this codebase uses
deliberately and documents inline (the latest-value refs in `AppContext`, the
reset-during-render in `Cover`, the metrics sync in `useVirtualScroll`).
ESLint was not an option: `typescript-eslint` does not support the TypeScript 7
compiler this project builds with.

`npm run test:coverage` measures everything under `src/` (components included)
with no allowlist to maintain — only tests, scaffolding, the entry point,
type-only files, the locale dictionaries, bundled demo data, the mocked data
seam, and the two Tauri-only shims are excluded. Two thresholds apply: a floor
of 70% statements, functions, and lines plus 60% branches over the whole tree,
and the stricter 85% / 70% bar over `src/{data,lib,state}/**/*.ts`. Use
`npm run test:watch` while developing. Generated reports under `coverage/`,
`test-results/`, and `playwright-report/` are ignored by Git.

On a supported Windows or macOS development host, `npm run test:all` runs the
complete web, browser, Rust, clippy, Tauri build, and native smoke sequence.

## UI, smoke, and accessibility

```bash
npm run test:e2e:smoke # quick Chromium route smoke
npm run test:a11y      # quick Chromium WCAG scan
npm run test:e2e       # complete Chromium + Firefox + WebKit suite
```

Every browser test starts with deterministic English/dark-theme settings and
the web-only `MockSource`; it never reads or writes the user's Steam account.
The shared fixture fails on uncaught page exceptions or `console.error`.
Failures retain a trace, screenshot, and video; CI uploads those diagnostics for
seven days.

## Rust and native shell

```bash
cargo fmt --manifest-path steam-core/Cargo.toml --all -- --check
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo test --manifest-path steam-core/Cargo.toml --all-targets --all-features
cargo clippy --manifest-path steam-core/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --workspace --all-targets --all-features
cargo clippy --manifest-path src-tauri/Cargo.toml --workspace --all-targets --all-features -- -D warnings

npm run tauri -- build --debug --no-bundle --ci
npm run smoke:native
```

The native smoke executes the built application with an intentionally unknown
worker mode. This proves the packaged entrypoint and worker dispatch run, then
exits before connecting to Steam.

`cargo test` in `steam-core` covers two kinds of code without a Steam install:
pure rules (write permissions, stat validation, KeyValues depth guard, app-list
parsing, call-result handles) and the file-only paths. For the latter the test
support module writes synthetic Steam cache files — `UserGameStatsSchema_*.bin`,
`UserGameStats_*.bin`, `sharedconfig.vdf`, the Collections cloud-storage JSON —
into a throwaway root under the OS temp dir and runs the real readers against
them: schema-derived permissions and stat definitions, completion counting and
account selection, the parallel completion scan, and category merging. Only
the FFI paths that need a live `steamclient` (reads, writes, ownership) remain
outside automated tests.

## CI matrix

`.github/workflows/test.yml` runs on pull requests, pushes to `master`, manual
dispatch, and as a required release gate:

- Ubuntu: typecheck, lint, coverage, production web build, and `npm audit`.
- Ubuntu: one isolated job per Chromium, Firefox, and WebKit UI suite.
- Windows and macOS: formatting, tests, and Clippy for both Rust crates, Tauri debug build,
  and native smoke.
- Ubuntu: both Cargo lockfiles audited with pinned `cargo-audit` 0.22.2.

All third-party GitHub Actions use immutable commit SHAs and all test jobs have
read-only repository permissions.

Rust dependency warnings are denied in CI. The only advisory exceptions are
listed individually in `.cargo/audit.toml`: they are Tauri's `cfg(linux)` GTK3
backend, which Cargo records in the cross-platform lockfile but this project
does not build or release. CI also fails if those crates ever become reachable
from the Windows or macOS target graphs. Tauri's former `urlpattern` 0.3
implementation is bridged to maintained 0.6 so its five unmaintained UNIC
crates are absent from the lockfile. Remove the GTK3 exceptions when upstream
Tauri migrates its Linux backend, or before adding Linux as a supported target.

## Steam safety boundary

CI deliberately does not perform live Steam writes: achievement/stat changes
are irreversible and hosted runners have no authenticated Steam client. The
renderer write journey uses `MockSource`, the Tauri IPC payload is
contract-tested, and Rust permission/write rules are unit-tested.

Live read-only integration remains opt-in on a machine with Steam running:

```bash
cargo run --manifest-path steam-core/Cargo.toml --bin probe -- <appId>
cargo run --manifest-path steam-core/Cargo.toml --bin read-game -- <appId>
```

Automated tests must never add a real-account write smoke test.

## Adding coverage

- Pure rules and reducers: colocate `*.test.ts` under `src/`.
- Provider behaviour (effects, loaders, save flow): extend
  `src/state/__tests__/AppContext.test.tsx`; its `FakeSource` records every
  call and can hold a save open, so assertions are about what was requested,
  not about timing.
- Memoization on a hot path: add a case to `src/__tests__/renderCounts.test.tsx`.
  It counts renders by wrapping a helper the component calls once per render,
  which is deterministic — never assert on durations.
- React journeys: add Testing Library cases under `src/__tests__/`.
- Renderer/Tauri changes: update `tauriSource.test.ts` to lock command names,
  argument validation, payload shape, and response mapping.
- User-visible flows: add a Playwright scenario under `e2e/`; tag startup
  critical cases with `@smoke` and accessibility scans with `@a11y`.
- Rust/Steam parsing changes: add deterministic tests that do not require an
  installed or authenticated Steam client. For anything that reads Steam's
  cache files, build the fixture with `test_support` (`kv_bytes`,
  `schema_bytes`, `user_stats_bytes`) and point the reader at a temp root, as
  the `imp::tests` module does.
