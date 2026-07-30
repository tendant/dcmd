use serde::Serialize;
use std::io;
use thiserror::Error;

#[derive(Debug, Error, Serialize)]
#[serde(tag = "kind", content = "message", rename_all = "camelCase")]
pub enum FsError {
    #[error("not found: {0}")]
    NotFound(String),
    #[error("already exists: {0}")]
    AlreadyExists(String),
    #[error("permission denied: {0}")]
    PermissionDenied(String),
    #[error("invalid name: {0}")]
    InvalidName(String),
    #[error("not a directory: {0}")]
    NotADirectory(String),
    #[error("trash error: {0}")]
    Trash(String),
    #[error("io error: {0}")]
    Io(String),
    #[error("cancelled: {0}")]
    Cancelled(String),
}

impl FsError {
    /// The same wire name serde emits, so per-item failures can be mapped by the
    /// frontend exactly like a top-level error. Kept in step with the serde
    /// rename_all by the kind_contract test.
    pub fn kind_name(&self) -> &'static str {
        match self {
            FsError::NotFound(_) => "notFound",
            FsError::AlreadyExists(_) => "alreadyExists",
            FsError::PermissionDenied(_) => "permissionDenied",
            FsError::InvalidName(_) => "invalidName",
            FsError::NotADirectory(_) => "notADirectory",
            FsError::Trash(_) => "trash",
            FsError::Io(_) => "io",
            FsError::Cancelled(_) => "cancelled",
        }
    }
}

impl From<io::Error> for FsError {
    fn from(err: io::Error) -> Self {
        match err.kind() {
            io::ErrorKind::NotFound => FsError::NotFound(err.to_string()),
            io::ErrorKind::AlreadyExists => FsError::AlreadyExists(err.to_string()),
            io::ErrorKind::PermissionDenied => FsError::PermissionDenied(err.to_string()),
            _ => FsError::Io(err.to_string()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cancelled_serializes_to_the_kind_the_frontend_checks() {
        let json = serde_json::to_string(&FsError::Cancelled("stopped".into())).unwrap();
        assert_eq!(json, r#"{"kind":"cancelled","message":"stopped"}"#);
    }
}

#[cfg(test)]
mod kind_contract {
    use super::*;

    /// The frontend branches on these exact strings to decide what to tell the
    /// user. Renaming a variant without updating errors.ts would silently fall
    /// back to the generic message, so the wire names are pinned here.
    #[test]
    fn serialised_kind_names_are_stable() {
        let cases = [
            (FsError::NotFound("p".into()), "notFound"),
            (FsError::AlreadyExists("p".into()), "alreadyExists"),
            (FsError::PermissionDenied("p".into()), "permissionDenied"),
            (FsError::InvalidName("p".into()), "invalidName"),
            (FsError::NotADirectory("p".into()), "notADirectory"),
            (FsError::Trash("p".into()), "trash"),
            (FsError::Io("p".into()), "io"),
            (FsError::Cancelled("p".into()), "cancelled"),
        ];
        for (err, expected) in cases {
            let json = serde_json::to_string(&err).unwrap();
            assert_eq!(
                json,
                format!("{{\"kind\":\"{expected}\",\"message\":\"p\"}}")
            );
            // Per-item failures report the kind through this accessor rather than
            // through serde, so the two must not drift apart.
            assert_eq!(err.kind_name(), expected);
        }
    }
}
