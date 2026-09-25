//! macOS window chrome. `tauri.macos.conf.json` makes the main window a real titled
//! window with an overlay (transparent, full-size-content) title bar, so the traffic
//! lights and the rounded window corners are AppKit's own. This adds an empty unified
//! toolbar on top: a sidebar + toolbar window is what the app is, and AppKit then
//! centres the traffic lights in the toolbar row at the standard inset and uses the
//! toolbar-window corner radius of whatever macOS release is running, instead of the
//! bare-titlebar metrics. The web title bar (TitleBar.tsx) is drawn under that row.

use objc2::MainThreadMarker;
use objc2_app_kit::{NSTitlebarSeparatorStyle, NSToolbar, NSWindow, NSWindowToolbarStyle};
use tauri::{Runtime, WebviewWindow};

pub fn use_unified_toolbar<R: Runtime>(win: &WebviewWindow<R>) {
    let target = win.clone();
    let _ = win.run_on_main_thread(move || {
        let (Some(mtm), Ok(ptr)) = (MainThreadMarker::new(), target.ns_window()) else {
            return;
        };
        // SAFETY: `ns_window` is the live NSWindow backing this Tauri window, and we are
        // on the main thread (checked above), where AppKit objects may be touched.
        let ns_window: &NSWindow = unsafe { &*ptr.cast() };
        let toolbar = NSToolbar::new(mtm);
        ns_window.setToolbar(Some(&toolbar));
        ns_window.setToolbarStyle(NSWindowToolbarStyle::Unified);
        // The web title bar draws its own bottom border.
        ns_window.setTitlebarSeparatorStyle(NSTitlebarSeparatorStyle::None);
    });
}
