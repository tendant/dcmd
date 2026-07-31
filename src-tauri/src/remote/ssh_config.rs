//! Reading host aliases out of `~/.ssh/config`.
//!
//! Read-only, and only the `Host` and `Include` directives. Everything else —
//! resolving which key, port, user or ProxyJump applies — is left to `ssh`
//! itself, which already does it correctly. Offering the names is enough: an
//! alias is all the app needs to hand back.

use std::path::{Path, PathBuf};

/// Follows `Include` this many levels. Enough for real configs, and a bound
/// against a file that includes itself.
const MAX_INCLUDE_DEPTH: usize = 8;

/// Host aliases declared in an ssh config, in the order they appear.
///
/// Patterns are skipped: `Host *.example.com` is a rule for matching, not a
/// host anyone can connect to by that name. Negations are skipped for the same
/// reason.
pub fn parse_hosts(contents: &str) -> Vec<String> {
    let mut out = Vec::new();
    for line in contents.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let Some(rest) = strip_keyword(line, "host") else {
            continue;
        };
        for alias in rest.split_whitespace() {
            let alias = alias.trim_matches('"');
            if alias.is_empty() || alias.contains(['*', '?', '!']) {
                continue;
            }
            if !out.iter().any(|h| h == alias) {
                out.push(alias.to_string());
            }
        }
    }
    out
}

/// `Include` targets declared in an ssh config.
pub fn parse_includes(contents: &str) -> Vec<String> {
    contents
        .lines()
        .filter_map(|line| strip_keyword(line.trim(), "include"))
        .flat_map(|rest| {
            rest.split_whitespace()
                .map(|s| s.trim_matches('"').to_string())
                .collect::<Vec<_>>()
        })
        .collect()
}

/// Matches a directive name case-insensitively, allowing the `Key=value` form
/// ssh also accepts.
fn strip_keyword<'a>(line: &'a str, keyword: &str) -> Option<&'a str> {
    let i = line.find(['=', ' ', '\t'])?;
    let (head, rest) = (&line[..i], line[i + 1..].trim());
    head.eq_ignore_ascii_case(keyword).then_some(rest)
}

/// Reads every host alias reachable from `path`, following `Include`.
pub fn hosts_from_file(path: &Path) -> Vec<String> {
    let mut out = Vec::new();
    read_into(path, 0, &mut out);
    out
}

fn read_into(path: &Path, depth: usize, out: &mut Vec<String>) {
    if depth > MAX_INCLUDE_DEPTH {
        return;
    }
    let Ok(contents) = std::fs::read_to_string(path) else {
        return;
    };

    for alias in parse_hosts(&contents) {
        if !out.contains(&alias) {
            out.push(alias);
        }
    }

    let base = path.parent().unwrap_or(Path::new("."));
    for include in parse_includes(&contents) {
        for target in expand_include(&include, base) {
            read_into(&target, depth + 1, out);
        }
    }
}

/// Resolves an `Include` target: relative paths are relative to the config's own
/// directory, `~` is the home directory, and a trailing glob is expanded one
/// level so `Include conf.d/*` works.
fn expand_include(pattern: &str, base: &Path) -> Vec<PathBuf> {
    let expanded = if let Some(rest) = pattern.strip_prefix("~/") {
        match std::env::var("HOME") {
            Ok(home) => PathBuf::from(home).join(rest),
            Err(_) => return Vec::new(),
        }
    } else if pattern.starts_with('/') {
        PathBuf::from(pattern)
    } else {
        base.join(pattern)
    };

    let name = expanded
        .file_name()
        .map(|n| n.to_string_lossy().to_string());
    match name {
        Some(n) if n.contains('*') => {
            let dir = expanded.parent().unwrap_or(Path::new("."));
            let prefix = n.split('*').next().unwrap_or("").to_string();
            let mut found: Vec<PathBuf> = std::fs::read_dir(dir)
                .into_iter()
                .flatten()
                .flatten()
                .map(|e| e.path())
                .filter(|p| {
                    p.is_file()
                        && p.file_name()
                            .map(|f| f.to_string_lossy().starts_with(&prefix))
                            .unwrap_or(false)
                })
                .collect();
            // Directory order is arbitrary; sort so the list is stable.
            found.sort();
            found
        }
        _ => vec![expanded],
    }
}

/// The user's own ssh config, if they have one.
pub fn default_config_path() -> Option<PathBuf> {
    let home = std::env::var("HOME").ok()?;
    let p = PathBuf::from(home).join(".ssh/config");
    p.is_file().then_some(p)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_host_aliases() {
        let hosts = parse_hosts("Host build\n  HostName 10.0.0.1\nHost web\n  User deploy\n");
        assert_eq!(hosts, ["build", "web"]);
    }

    #[test]
    fn reads_several_aliases_on_one_line() {
        assert_eq!(parse_hosts("Host web web1 web2"), ["web", "web1", "web2"]);
    }

    // A pattern is a rule for matching, not a host anyone can connect to.
    #[test]
    fn skips_patterns_and_negations() {
        let hosts = parse_hosts("Host *\n  User me\nHost *.example.com\nHost !bad\nHost real\n");
        assert_eq!(hosts, ["real"]);
    }

    #[test]
    fn skips_a_wildcard_but_keeps_real_aliases_on_the_same_line() {
        assert_eq!(parse_hosts("Host * real"), ["real"]);
    }

    #[test]
    fn ignores_comments_and_blank_lines() {
        assert_eq!(
            parse_hosts("# Host commented\n\n   \nHost real\n"),
            ["real"]
        );
    }

    #[test]
    fn is_case_insensitive_as_ssh_is() {
        assert_eq!(parse_hosts("HOST a\nhost b\nHoSt c"), ["a", "b", "c"]);
    }

    #[test]
    fn accepts_the_equals_form() {
        assert_eq!(parse_hosts("Host=build"), ["build"]);
    }

    #[test]
    fn does_not_repeat_an_alias_declared_twice() {
        assert_eq!(parse_hosts("Host a\nHost a"), ["a"]);
    }

    #[test]
    fn does_not_mistake_hostname_for_host() {
        // The most likely parsing slip: HostName starts with "Host".
        assert!(parse_hosts("Host real\n  HostName decoy\n").contains(&"real".to_string()));
        assert!(!parse_hosts("Host real\n  HostName decoy\n").contains(&"decoy".to_string()));
    }

    #[test]
    fn reads_include_directives() {
        assert_eq!(parse_includes("Include conf.d/*\nHost a"), ["conf.d/*"]);
        assert_eq!(parse_includes("Include a b"), ["a", "b"]);
    }

    #[test]
    fn follows_an_include() {
        let tmp = tempfile::TempDir::new().unwrap();
        std::fs::write(tmp.path().join("extra"), "Host from-include\n").unwrap();
        std::fs::write(tmp.path().join("config"), "Host direct\nInclude extra\n").unwrap();

        let hosts = hosts_from_file(&tmp.path().join("config"));
        assert!(hosts.contains(&"direct".to_string()));
        assert!(hosts.contains(&"from-include".to_string()));
    }

    #[test]
    fn expands_a_glob_include() {
        let tmp = tempfile::TempDir::new().unwrap();
        std::fs::create_dir(tmp.path().join("conf.d")).unwrap();
        std::fs::write(tmp.path().join("conf.d/one"), "Host one\n").unwrap();
        std::fs::write(tmp.path().join("conf.d/two"), "Host two\n").unwrap();
        std::fs::write(tmp.path().join("config"), "Include conf.d/*\n").unwrap();

        let hosts = hosts_from_file(&tmp.path().join("config"));
        assert!(hosts.contains(&"one".to_string()));
        assert!(hosts.contains(&"two".to_string()));
    }

    // A config that includes itself must not hang the app.
    #[test]
    fn a_self_including_config_terminates() {
        let tmp = tempfile::TempDir::new().unwrap();
        let path = tmp.path().join("config");
        std::fs::write(&path, "Host loop\nInclude config\n").unwrap();
        assert_eq!(hosts_from_file(&path), ["loop"]);
    }

    #[test]
    fn a_missing_file_yields_nothing_rather_than_failing() {
        assert!(hosts_from_file(Path::new("/nonexistent/ssh/config")).is_empty());
    }
}
