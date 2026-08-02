//! Read-only preview of a single file.
//!
//! Bytes come back over IPC as base64 rather than through the asset protocol.
//! That is slower for a large image, but it is the only approach that works for
//! a file on a remote host as well, and having one path for both is worth more
//! than the speed on the local one.
//!
//! Nothing here writes, opens, or executes anything: a preview of a file must
//! never be a way to run it.

use std::path::Path;

use base64::Engine as _;
use serde::Serialize;

use crate::error::FsError;

/// Text is held in memory and rendered in one element, so this is about what the
/// UI can display rather than what can be read.
const TEXT_MAX: u64 = 1024 * 1024;

/// Base64 inflates by a third and the whole string crosses the IPC boundary, so
/// this is deliberately well below what the filesystem could hand us.
const BINARY_MAX: u64 = 24 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Preview {
    /// Plain text, already truncated to `TEXT_MAX` if it was longer.
    Text {
        content: String,
        truncated: bool,
    },
    /// Markdown, which the frontend renders rather than showing as source.
    Markdown {
        content: String,
        truncated: bool,
    },
    Image {
        mime: String,
        data: String,
    },
    Pdf {
        data: String,
    },
    /// Nothing sensible to show. The reason is displayed, so it says what the
    /// file is rather than only that it failed.
    Unsupported {
        reason: String,
    },
}

/// What a name suggests the file is. Extension only — sniffing content is left
/// to the fallback below, which is where files with no extension end up.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Kind {
    Text,
    Markdown,
    Image(&'static str),
    Pdf,
    Unknown,
}

fn classify(name: &str) -> Kind {
    let ext = Path::new(name)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    match ext.as_str() {
        "md" | "markdown" | "mdown" => Kind::Markdown,
        "pdf" => Kind::Pdf,
        "png" => Kind::Image("image/png"),
        "jpg" | "jpeg" => Kind::Image("image/jpeg"),
        "gif" => Kind::Image("image/gif"),
        "webp" => Kind::Image("image/webp"),
        "bmp" => Kind::Image("image/bmp"),
        "ico" => Kind::Image("image/x-icon"),
        "avif" => Kind::Image("image/avif"),
        // Rendered through <img>, where scripts inside it do not run. It must
        // never reach an <object> or an iframe for that reason.
        "svg" => Kind::Image("image/svg+xml"),
        "txt" | "log" | "json" | "toml" | "yaml" | "yml" | "xml" | "csv" | "tsv" | "ini"
        | "conf" | "cfg" | "env" | "lock" | "rs" | "ts" | "tsx" | "js" | "jsx" | "mjs" | "cjs"
        | "css" | "scss" | "html" | "htm" | "sh" | "bash" | "zsh" | "fish" | "py" | "rb" | "go"
        | "java" | "kt" | "swift" | "c" | "h" | "cpp" | "hpp" | "cs" | "php" | "pl" | "lua"
        | "sql" | "r" | "jl" | "ex" | "exs" | "erl" | "hs" | "ml" | "vim" | "diff" | "patch"
        | "gitignore" | "dockerfile" | "makefile" => Kind::Text,
        _ => Kind::Unknown,
    }
}

fn human_size(bytes: u64) -> String {
    const UNITS: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];
    let mut size = bytes as f64;
    let mut unit = 0;
    while size >= 1024.0 && unit < UNITS.len() - 1 {
        size /= 1024.0;
        unit += 1;
    }
    if unit == 0 {
        format!("{bytes} {}", UNITS[0])
    } else {
        format!("{size:.1} {}", UNITS[unit])
    }
}

/// Text, but only if it really is text.
///
/// A NUL byte is the giveaway for a binary file that happens to decode: showing
/// one as text fills the window with replacement characters and tells nobody
/// anything.
fn as_text(bytes: &[u8]) -> Option<String> {
    if bytes.contains(&0) {
        return None;
    }
    String::from_utf8(bytes.to_vec()).ok()
}

/// Builds a preview from bytes already read.
///
/// Pure, so the same logic serves a local file and one on a remote host, and so
/// every branch is testable without touching a filesystem.
pub fn build_preview(name: &str, bytes: &[u8], total_size: u64) -> Preview {
    let kind = classify(name);

    // Size limits are per kind, and checked against the real size rather than
    // what was read, so a truncated read still reports honestly.
    let limit = match kind {
        Kind::Image(_) | Kind::Pdf => BINARY_MAX,
        _ => TEXT_MAX,
    };
    if total_size > limit && !matches!(kind, Kind::Text | Kind::Markdown | Kind::Unknown) {
        return Preview::Unsupported {
            reason: format!("{} is too large to preview", human_size(total_size)),
        };
    }

    let truncated = total_size > TEXT_MAX;
    let encode = |b: &[u8]| base64::engine::general_purpose::STANDARD.encode(b);

    match kind {
        Kind::Markdown => match as_text(bytes) {
            Some(content) => Preview::Markdown { content, truncated },
            None => Preview::Unsupported {
                reason: "not valid UTF-8 text".into(),
            },
        },
        Kind::Text => match as_text(bytes) {
            Some(content) => Preview::Text { content, truncated },
            None => Preview::Unsupported {
                reason: "not valid UTF-8 text".into(),
            },
        },
        Kind::Image(mime) => Preview::Image {
            mime: mime.into(),
            data: encode(bytes),
        },
        Kind::Pdf => Preview::Pdf {
            data: encode(bytes),
        },
        // No extension, or one we do not know. Plenty of real files look like
        // this — README, LICENSE, Makefile, a dotfile — so try text before
        // giving up, rather than refusing on the strength of the name alone.
        Kind::Unknown => match as_text(bytes) {
            Some(content) => Preview::Text { content, truncated },
            None => Preview::Unsupported {
                reason: format!("binary file, {}", human_size(total_size)),
            },
        },
    }
}

/// How much to read for a file of this name. Reading a 4 GB video in full to
/// discover it is unsupported would hang the app.
pub fn read_limit(name: &str) -> u64 {
    match classify(name) {
        Kind::Image(_) | Kind::Pdf => BINARY_MAX,
        // One byte past the limit, so truncation can be detected from the read
        // itself when the size is not known up front.
        _ => TEXT_MAX + 1,
    }
}

pub fn file_name(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string())
}

/// Reads a local file and describes it.
#[tauri::command]
pub async fn preview_file(path: String) -> Result<Preview, FsError> {
    tauri::async_runtime::spawn_blocking(move || {
        use std::io::Read;

        // `?` converts through the From<io::Error> impl in error.rs, which is
        // what maps NotFound and PermissionDenied to their own kinds rather
        // than flattening everything into Io.
        let meta = std::fs::metadata(&path)?;
        if meta.is_dir() {
            return Ok(Preview::Unsupported {
                reason: "this is a folder".into(),
            });
        }
        let size = meta.len();
        let name = file_name(&path);

        let file = std::fs::File::open(&path)?;
        let mut bytes = Vec::new();
        file.take(read_limit(&name)).read_to_end(&mut bytes)?;

        Ok(build_preview(&name, &bytes, size))
    })
    .await
    .map_err(|e| FsError::Io(format!("task join error: {e}")))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_by_extension() {
        let p = build_preview("notes.txt", b"hello", 5);
        assert_eq!(
            p,
            Preview::Text {
                content: "hello".into(),
                truncated: false
            }
        );
    }

    #[test]
    fn markdown_is_its_own_kind() {
        assert!(matches!(
            build_preview("README.md", b"# hi", 4),
            Preview::Markdown { .. }
        ));
    }

    #[test]
    fn images_carry_their_mime() {
        match build_preview("a.png", b"\x89PNG", 4) {
            Preview::Image { mime, data } => {
                assert_eq!(mime, "image/png");
                assert_eq!(data, "iVBORw==");
            }
            other => panic!("expected an image, got {other:?}"),
        }
    }

    /// Files with no extension are common and mostly text. Refusing them on the
    /// name alone would rule out README, LICENSE and every dotfile.
    #[test]
    fn an_unknown_name_falls_back_to_text() {
        assert!(matches!(
            build_preview("LICENSE", b"MIT", 3),
            Preview::Text { .. }
        ));
    }

    /// A binary file can decode as UTF-8 by accident; a NUL byte is the signal
    /// that it is not text, and showing it would fill the window with noise.
    #[test]
    fn a_nul_byte_means_it_is_not_text() {
        match build_preview("mystery", b"\x00\x01binary", 8) {
            Preview::Unsupported { reason } => assert!(reason.contains("binary")),
            other => panic!("expected unsupported, got {other:?}"),
        }
    }

    #[test]
    fn an_unreadable_encoding_is_refused_rather_than_mangled() {
        assert!(matches!(
            build_preview("a.txt", &[0xff, 0xfe, 0xfd], 3),
            Preview::Unsupported { .. }
        ));
    }

    #[test]
    fn a_huge_image_is_refused_with_its_size() {
        match build_preview("big.png", b"x", 500 * 1024 * 1024) {
            Preview::Unsupported { reason } => {
                assert!(reason.contains("500.0 MB"), "got {reason}");
            }
            other => panic!("expected unsupported, got {other:?}"),
        }
    }

    /// Long text is shown with a warning rather than refused: the first part of
    /// a big log is usually exactly what is wanted.
    #[test]
    fn long_text_is_truncated_not_refused() {
        match build_preview("big.log", b"start", TEXT_MAX + 10) {
            Preview::Text { truncated, .. } => assert!(truncated),
            other => panic!("expected text, got {other:?}"),
        }
    }

    #[test]
    fn extensions_are_matched_regardless_of_case() {
        assert!(matches!(
            build_preview("PHOTO.JPG", b"x", 1),
            Preview::Image { .. }
        ));
    }

    #[test]
    fn only_binary_kinds_get_the_large_read_limit() {
        assert_eq!(read_limit("a.png"), BINARY_MAX);
        assert_eq!(read_limit("a.txt"), TEXT_MAX + 1);
        assert_eq!(read_limit("noext"), TEXT_MAX + 1);
    }

    #[test]
    fn sizes_read_as_people_write_them() {
        assert_eq!(human_size(512), "512 B");
        assert_eq!(human_size(2048), "2.0 KB");
    }

    #[test]
    fn a_name_is_taken_from_the_end_of_the_path() {
        assert_eq!(file_name("/a/b/c.txt"), "c.txt");
    }
}
