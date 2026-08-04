//! Compatibility bridge for upstream consumers still constrained to
//! `urlpattern` 0.3. The 0.6 public API remains source-compatible with the
//! subset used by Tauri, while replacing the unmaintained UNIC dependency.

pub use urlpattern06::*;

#[cfg(test)]
mod tests {
    use super::{UrlPattern, UrlPatternInit, UrlPatternMatchInput};

    #[test]
    fn preserves_the_remote_capability_api_used_by_tauri() {
        let mut init = UrlPatternInit::parse_constructor_string::<regex::Regex>(
            "https://*.steampowered.com/*",
            None,
        )
        .expect("valid URLPattern");
        init.search = Some("*".into());
        init.hash = Some("*".into());

        let pattern: UrlPattern =
            UrlPattern::parse(init, Default::default()).expect("parsed URLPattern");
        let allowed = url::Url::parse("https://store.steampowered.com/app/10").unwrap();
        let rejected = url::Url::parse("https://example.com/app/10").unwrap();

        assert!(pattern
            .test(UrlPatternMatchInput::Url(allowed))
            .expect("match succeeds"));
        assert!(!pattern
            .test(UrlPatternMatchInput::Url(rejected))
            .expect("match succeeds"));
    }
}
