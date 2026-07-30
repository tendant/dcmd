use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// Bumped when the shape changes incompatibly. Every field also carries a serde
/// default, so adding one does not invalidate an existing file.
pub const CURRENT_VERSION: u32 = 1;

fn default_version() -> u32 {
    CURRENT_VERSION
}
fn default_split() -> f64 {
    0.5
}
fn default_sort_key() -> String {
    "name".to_string()
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PaneSettings {
    pub sort_key: String,
    pub sort_ascending: bool,
    pub show_hidden: bool,
}

impl Default for PaneSettings {
    fn default() -> Self {
        Self {
            sort_key: default_sort_key(),
            sort_ascending: true,
            show_hidden: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    #[serde(default = "default_version")]
    pub version: u32,
    #[serde(default = "default_split")]
    pub split_ratio: f64,
    pub left: PaneSettings,
    pub right: PaneSettings,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            version: CURRENT_VERSION,
            split_ratio: default_split(),
            left: PaneSettings::default(),
            right: PaneSettings::default(),
        }
    }
}

const VALID_SORT_KEYS: &[&str] = &["name", "size", "modified", "created", "kind"];

impl Settings {
    /// Brings a loaded file into a usable state rather than trusting it.
    ///
    /// The file is user-editable and survives downgrades, so a value that would
    /// break the UI — a split of 0, a sort key this build does not know — is
    /// replaced with the default instead of being passed through.
    pub fn sanitised(mut self) -> Self {
        self.split_ratio = self.split_ratio.clamp(0.15, 0.85);
        if !self.split_ratio.is_finite() {
            self.split_ratio = default_split();
        }
        for pane in [&mut self.left, &mut self.right] {
            if !VALID_SORT_KEYS.contains(&pane.sort_key.as_str()) {
                pane.sort_key = default_sort_key();
            }
        }
        self.version = CURRENT_VERSION;
        self
    }
}

/// Parses settings, falling back to defaults for anything unreadable.
///
/// Settings are a convenience; a corrupt or hand-mangled file must never stop
/// the app starting, so every failure path here yields defaults rather than an
/// error the caller has to handle.
pub fn parse(contents: &str) -> Settings {
    serde_json::from_str::<Settings>(contents)
        .unwrap_or_default()
        .sanitised()
}

pub fn serialise(settings: &Settings) -> String {
    serde_json::to_string_pretty(settings).unwrap_or_else(|_| "{}".to_string())
}

pub fn load_from(path: &Path) -> Settings {
    match std::fs::read_to_string(path) {
        Ok(contents) => parse(&contents),
        Err(_) => Settings::default(),
    }
}

/// Writes settings, replacing any existing file atomically.
///
/// Via a temporary sibling and a rename, so an interrupted write cannot leave a
/// half-written file that then fails to parse on next start. Here replacing is
/// the intent, unlike a file transfer, so the rename is allowed to clobber.
pub fn save_to(path: &Path, settings: &Settings) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp: PathBuf = path.with_extension("json.tmp");
    std::fs::write(&tmp, serialise(settings))?;
    std::fs::rename(&tmp, path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn round_trips() {
        let s = Settings {
            split_ratio: 0.7,
            left: PaneSettings {
                sort_key: "size".into(),
                sort_ascending: false,
                ..PaneSettings::default()
            },
            right: PaneSettings {
                show_hidden: true,
                ..PaneSettings::default()
            },
            ..Settings::default()
        };

        assert_eq!(parse(&serialise(&s)), s);
    }

    #[test]
    fn missing_file_gives_defaults() {
        let tmp = TempDir::new().unwrap();
        assert_eq!(
            load_from(&tmp.path().join("nope.json")),
            Settings::default()
        );
    }

    // A corrupt file must not stop the app starting.
    #[test]
    fn unparseable_contents_give_defaults() {
        for junk in [
            "",
            "{",
            "null",
            "[]",
            "not json at all",
            "{\"splitRatio\": \"wide\"}",
        ] {
            assert_eq!(parse(junk), Settings::default(), "input: {junk:?}");
        }
    }

    #[test]
    fn unknown_fields_are_ignored_rather_than_failing() {
        let s = parse(r#"{"splitRatio": 0.6, "somethingFromLater": true}"#);
        assert_eq!(s.split_ratio, 0.6);
    }

    #[test]
    fn absent_fields_fall_back_individually() {
        let s = parse(r#"{"splitRatio": 0.6}"#);
        assert_eq!(s.split_ratio, 0.6);
        assert_eq!(s.left, PaneSettings::default());
    }

    #[test]
    fn a_split_that_would_hide_a_pane_is_clamped() {
        assert!(parse(r#"{"splitRatio": 0.0}"#).split_ratio >= 0.15);
        assert!(parse(r#"{"splitRatio": 1.0}"#).split_ratio <= 0.85);
        assert!(parse(r#"{"splitRatio": -5}"#).split_ratio >= 0.15);
    }

    #[test]
    fn a_sort_key_this_build_does_not_know_falls_back() {
        let s = parse(r#"{"left": {"sortKey": "colour"}}"#);
        assert_eq!(s.left.sort_key, "name");
    }

    #[test]
    fn every_real_sort_key_survives() {
        for key in VALID_SORT_KEYS {
            let s = parse(&format!(r#"{{"left": {{"sortKey": "{key}"}}}}"#));
            assert_eq!(&s.left.sort_key, key);
        }
    }

    #[test]
    fn saving_creates_the_directory_and_leaves_no_temp_file() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("nested/dir/settings.json");
        let s = Settings {
            split_ratio: 0.62,
            ..Settings::default()
        };

        save_to(&path, &s).unwrap();
        assert_eq!(load_from(&path).split_ratio, 0.62);
        assert!(
            !path.with_extension("json.tmp").exists(),
            "temp file left behind"
        );
    }

    #[test]
    fn saving_over_an_existing_file_replaces_it() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("settings.json");
        save_to(&path, &Settings::default()).unwrap();

        let s = Settings {
            right: PaneSettings {
                show_hidden: true,
                ..PaneSettings::default()
            },
            ..Settings::default()
        };
        save_to(&path, &s).unwrap();

        assert!(load_from(&path).right.show_hidden);
    }

    #[test]
    fn a_truncated_file_does_not_carry_stale_values_through() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("settings.json");
        std::fs::write(&path, r#"{"splitRatio": 0.7, "left": {"sortK"#).unwrap();
        assert_eq!(load_from(&path), Settings::default());
    }
}
