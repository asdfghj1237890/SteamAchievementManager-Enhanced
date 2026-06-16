// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // When re-spawned with `--steam-worker <mode> <appId> [payload]`, run headless
    // in that app's Steam context (SteamAppId set), print JSON, and exit — never
    // start the GUI. This is how per-game achievement read/write gets its own
    // process, like the original SAM.
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).map(String::as_str) == Some("--steam-worker") {
        app_lib::worker_main(&args[2..]);
        return;
    }
    app_lib::run();
}
