//! Raycast export parsing for the "Import from Raycast" built-in feature.
//!
//! Supported inputs:
//! - Raycast X `.rayconfig` (gzip → JSON envelope → hex payload, optionally
//!   AES-256-GCM encrypted with an scrypt-derived key)
//! - Classic Raycast 1.x `.rayconfig` (gzip JSON, or 16-byte IV +
//!   AES-256-CBC with a sha256(password) key wrapping the gzip stream)
//! - Plain JSON files from Raycast's "Export Snippets" / "Export Quicklinks"
//!
//! Everything returned is normalized into an [`ImportBundle`] of items ready
//! to insert through Asyar's existing snippet/portal/shortcut paths.

use crate::error::AppError;
use crate::search_engine::models::Application;
use serde::{Deserialize, Serialize};

/// A snippet candidate, already translated to Asyar placeholder tokens.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSnippet {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub keyword: Option<String>,
    pub expansion: String,
    pub pinned: bool,
    /// Epoch milliseconds parsed from the export's ISO timestamp, when present.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<f64>,
}

/// A portal candidate (Raycast quicklink), URL translated to `{query}` tokens.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPortal {
    /// Raycast-side quicklink id, used to attach imported hotkeys.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub raycast_id: Option<String>,
    pub name: String,
    pub url: String,
    pub icon: String,
}

/// What an imported hotkey points at.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ShortcutTarget {
    /// An application hotkey. `object_id`/`item_name`/`item_icon` are filled
    /// by [`resolve_app_targets`] when the app exists in Asyar's index.
    #[serde(rename_all = "camelCase")]
    App {
        path: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        object_id: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        item_name: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        item_icon: Option<String>,
    },
    /// A hotkey on a Raycast quicklink; resolves to the imported portal.
    #[serde(rename_all = "camelCase")]
    Portal { raycast_quicklink_id: String },
}

/// A hotkey candidate with the shortcut already in Asyar's canonical
/// `Control+Alt+Shift+Super+K` string form.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportShortcut {
    pub target: ShortcutTarget,
    pub shortcut: String,
}

/// An alias candidate. Asyar's alias system (see
/// `built-in-features/aliases`) binds a short typed string to an app or
/// command object_id, same as Raycast's command aliases — so unlike
/// hotkeys, this always has a real Asyar destination as long as the alias
/// text itself is valid and the target resolves.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportAlias {
    pub target: ShortcutTarget,
    pub alias: String,
}

/// Counts of items present in the export that cannot be represented in Asyar.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkippedCounts {
    /// Hotkeys bound to Raycast commands/extensions (no Asyar equivalent),
    /// plus hotkeys whose key/modifiers could not be mapped, plus app
    /// hotkeys whose application is not present in Asyar's index.
    pub hotkeys: u32,
    /// Aliases bound to a Raycast command/extension with no Asyar
    /// equivalent, aliases with characters Asyar's alias validator rejects
    /// (must be 1-10 lowercase letters/digits), plus app aliases whose
    /// application is not present in Asyar's index.
    pub aliases: u32,
}

/// Which file format the parser detected.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SourceFormat {
    RayconfigX,
    RayconfigClassic,
    SnippetsJson,
    QuicklinksJson,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportBundle {
    pub source: SourceFormat,
    pub snippets: Vec<ImportSnippet>,
    pub portals: Vec<ImportPortal>,
    pub shortcuts: Vec<ImportShortcut>,
    pub aliases: Vec<ImportAlias>,
    pub skipped: SkippedCounts,
}

/// Outcome of a parse attempt. Password states are data, not errors, so the
/// frontend can drive its prompt flow without string-matching error messages.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum ParseOutcome {
    #[serde(rename_all = "camelCase")]
    Ok { bundle: ImportBundle },
    PasswordRequired,
    WrongPassword,
}

/// Parse any supported Raycast export file.
pub fn parse_export(bytes: &[u8], password: Option<&str>) -> Result<ParseOutcome, AppError> {
    if is_gzip(bytes) {
        let json = gunzip(bytes)?;
        let value: serde_json::Value = serde_json::from_slice(&json)
            .map_err(|e| AppError::Validation(format!("Unrecognized rayconfig contents: {e}")))?;
        if value.get("data").is_some() && value.get("schemaVersion").is_some() {
            return parse_rayconfig_x(&value, password);
        }
        if is_classic_config(&value) {
            return Ok(ParseOutcome::Ok { bundle: parse_classic(&value)? });
        }
        return Err(AppError::Validation(
            "Unrecognized rayconfig contents".to_string(),
        ));
    }

    // Plain JSON exports from "Export Snippets" / "Export Quicklinks".
    if let Ok(value) = serde_json::from_slice::<serde_json::Value>(bytes) {
        if let Some(items) = value.as_array() {
            return Ok(ParseOutcome::Ok { bundle: parse_plain_json(items)? });
        }
        return Err(AppError::Validation(
            "Unrecognized Raycast export file".to_string(),
        ));
    }

    // Not gzip, not JSON: classic encrypted rayconfig (IV + AES-256-CBC).
    parse_classic_encrypted(bytes, password)
}

/// Attach Asyar index identity (`object_id`, display name, icon) to app
/// hotkeys and app aliases by matching the exported app path against the
/// installed-app list. Entries with no matching installed app are dropped
/// and counted in `skipped.hotkeys`/`skipped.aliases` respectively. Portal
/// targets pass through untouched — they carry their own identity already.
pub fn resolve_app_targets(bundle: &mut ImportBundle, apps: &[Application]) {
    let mut kept_shortcuts = Vec::with_capacity(bundle.shortcuts.len());
    for mut shortcut in bundle.shortcuts.drain(..) {
        if resolve_app_target(&mut shortcut.target, apps) {
            kept_shortcuts.push(shortcut);
        } else {
            bundle.skipped.hotkeys += 1;
        }
    }
    bundle.shortcuts = kept_shortcuts;

    let mut kept_aliases = Vec::with_capacity(bundle.aliases.len());
    for mut alias in bundle.aliases.drain(..) {
        if resolve_app_target(&mut alias.target, apps) {
            kept_aliases.push(alias);
        } else {
            bundle.skipped.aliases += 1;
        }
    }
    bundle.aliases = kept_aliases;
}

/// Returns `false` when the target is an `App` whose path has no match in
/// `apps` (the caller drops the entry); `true` otherwise, having filled in
/// index identity for `App` targets.
fn resolve_app_target(target: &mut ShortcutTarget, apps: &[Application]) -> bool {
    let ShortcutTarget::App { path, object_id, item_name, item_icon } = target else {
        return true;
    };
    match apps.iter().find(|a| &a.path == path) {
        Some(app) => {
            *object_id = Some(app.id.clone());
            *item_name = Some(app.name.clone());
            *item_icon = app.icon.clone();
            true
        }
        None => false,
    }
}

// ---------------------------------------------------------------------------
// Format detection & container decoding
// ---------------------------------------------------------------------------

fn is_gzip(bytes: &[u8]) -> bool {
    bytes.len() >= 2 && bytes[0] == 0x1f && bytes[1] == 0x8b
}

fn gunzip(bytes: &[u8]) -> Result<Vec<u8>, AppError> {
    use std::io::Read;
    let mut out = Vec::new();
    flate2::read::GzDecoder::new(bytes)
        .read_to_end(&mut out)
        .map_err(|e| AppError::Validation(format!("Failed to decompress rayconfig: {e}")))?;
    Ok(out)
}

fn is_classic_config(value: &serde_json::Value) -> bool {
    value
        .as_object()
        .is_some_and(|o| o.keys().any(|k| k.starts_with("builtin_package_")))
}

// ---------------------------------------------------------------------------
// Raycast X (.rayconfig, schemaVersion 1–2)
// ---------------------------------------------------------------------------

fn parse_rayconfig_x(
    envelope: &serde_json::Value,
    password: Option<&str>,
) -> Result<ParseOutcome, AppError> {
    let schema_version = envelope
        .get("schemaVersion")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    if !(1..=2).contains(&schema_version) {
        return Err(AppError::Validation(format!(
            "Unsupported rayconfig schema version: {schema_version}"
        )));
    }

    let data_hex = envelope
        .get("data")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Validation("rayconfig has no data payload".to_string()))?;
    let data = hex::decode(data_hex)
        .map_err(|e| AppError::Validation(format!("Invalid rayconfig payload encoding: {e}")))?;

    let payload = match envelope.get("encryption") {
        Some(enc) if !enc.is_null() => {
            let Some(password) = password else {
                return Ok(ParseOutcome::PasswordRequired);
            };
            match decrypt_x_payload(&data, enc, password)? {
                Some(plaintext) => plaintext,
                None => return Ok(ParseOutcome::WrongPassword),
            }
        }
        _ => data,
    };

    let inner = if schema_version >= 2 { gunzip(&payload)? } else { payload };
    let categories: serde_json::Value = serde_json::from_slice(&inner)
        .map_err(|e| AppError::Validation(format!("Invalid rayconfig categories: {e}")))?;

    Ok(ParseOutcome::Ok { bundle: bundle_from_x_categories(&categories)? })
}

/// AES-256-GCM with an scrypt-derived key (Node `crypto.scrypt` defaults:
/// N=16384, r=8, p=1). Returns `None` when the auth tag check fails, which
/// for GCM is the "wrong password" signal.
fn decrypt_x_payload(
    data: &[u8],
    encryption: &serde_json::Value,
    password: &str,
) -> Result<Option<Vec<u8>>, AppError> {
    use aes_gcm::aead::consts::{U12, U16};
    use aes_gcm::aead::Aead;
    use aes_gcm::{AesGcm, KeyInit, Nonce};

    let field = |name: &str| -> Result<Vec<u8>, AppError> {
        let hex_str = encryption.get(name).and_then(|v| v.as_str()).ok_or_else(|| {
            AppError::Validation(format!("rayconfig encryption block missing {name}"))
        })?;
        hex::decode(hex_str)
            .map_err(|e| AppError::Validation(format!("Invalid {name} encoding: {e}")))
    };
    let iv = field("iv")?;
    let salt = field("salt")?;
    let auth_tag = field("authTag")?;

    let params = scrypt::Params::new(14, 8, 1, 32)
        .map_err(|e| AppError::Encryption(format!("Invalid scrypt parameters: {e}")))?;
    let mut key = [0u8; 32];
    scrypt::scrypt(password.as_bytes(), &salt, &params, &mut key)
        .map_err(|e| AppError::Encryption(format!("Key derivation failed: {e}")))?;

    let mut ciphertext = data.to_vec();
    ciphertext.extend_from_slice(&auth_tag);

    // Raycast X uses a 16-byte GCM IV (Node's createCipheriv accepts any
    // length); tolerate the standard 12-byte nonce too.
    let plaintext = match iv.len() {
        16 => {
            let cipher = AesGcm::<aes::Aes256, U16>::new_from_slice(&key)
                .map_err(|e| AppError::Encryption(format!("Cipher init failed: {e}")))?;
            cipher
                .decrypt(Nonce::<U16>::from_slice(&iv), ciphertext.as_slice())
                .ok()
        }
        12 => {
            let cipher = AesGcm::<aes::Aes256, U12>::new_from_slice(&key)
                .map_err(|e| AppError::Encryption(format!("Cipher init failed: {e}")))?;
            cipher
                .decrypt(Nonce::<U12>::from_slice(&iv), ciphertext.as_slice())
                .ok()
        }
        n => {
            return Err(AppError::Validation(format!(
                "Unsupported rayconfig IV length: {n}"
            )))
        }
    };
    Ok(plaintext)
}

fn bundle_from_x_categories(categories: &serde_json::Value) -> Result<ImportBundle, AppError> {
    let mut bundle = ImportBundle {
        source: SourceFormat::RayconfigX,
        snippets: Vec::new(),
        portals: Vec::new(),
        shortcuts: Vec::new(),
        aliases: Vec::new(),
        skipped: SkippedCounts::default(),
    };

    if let Some(snippets) = categories
        .pointer("/snippets/snippets")
        .and_then(|v| v.as_array())
    {
        for s in snippets {
            let Some(title) = s.get("title").and_then(|v| v.as_str()) else { continue };
            let Some(text) = s.get("text").and_then(|v| v.as_str()) else { continue };
            bundle.snippets.push(ImportSnippet {
                name: title.to_string(),
                keyword: s
                    .get("keyword")
                    .and_then(|v| v.as_str())
                    .map(str::to_string),
                expansion: translate_placeholders(text, false),
                pinned: is_truthy(s.get("pinned")),
                created_at: s
                    .get("createdAt")
                    .and_then(|v| v.as_str())
                    .and_then(iso_to_epoch_ms),
            });
        }
    }

    if let Some(quicklinks) = categories
        .pointer("/quicklinks/quicklinks")
        .and_then(|v| v.as_array())
    {
        for q in quicklinks {
            let Some(name) = q.get("name").and_then(|v| v.as_str()) else { continue };
            let Some(link) = q.get("link").and_then(|v| v.as_str()) else { continue };
            bundle.portals.push(ImportPortal {
                raycast_id: q.get("id").and_then(|v| v.as_str()).map(str::to_string),
                name: name.to_string(),
                url: translate_placeholders(link, true),
                icon: PORTAL_ICON.to_string(),
            });
        }
    }

    if let Some(commands) = categories
        .pointer("/settings/commands")
        .and_then(|v| v.as_array())
    {
        for command in commands {
            let id = command.get("id").and_then(|v| v.as_str()).unwrap_or("");

            if let Some(hotkey) = command
                .get("macosHotkey")
                .or_else(|| command.get("windowsHotkey"))
            {
                match (shortcut_target_from_command_id(id), translate_hotkey(hotkey)) {
                    (Some(target), Some(shortcut)) => {
                        bundle.shortcuts.push(ImportShortcut { target, shortcut })
                    }
                    _ => bundle.skipped.hotkeys += 1,
                }
            }

            if let Some(alias_raw) = command.get("alias").and_then(|v| v.as_str()) {
                match (
                    shortcut_target_from_command_id(id),
                    normalize_and_validate_alias(alias_raw),
                ) {
                    (Some(target), Some(alias)) => bundle.aliases.push(ImportAlias { target, alias }),
                    _ => bundle.skipped.aliases += 1,
                }
            }
        }
    }

    Ok(bundle)
}

const X_APP_COMMAND_PREFIX: &str = "c:r:applications::*::application::=::";
const X_QUICKLINK_COMMAND_PREFIX: &str = "c:r:quicklinks::*::quicklink::=::";

/// Hotkeys and aliases in Raycast X commands share the same addressing
/// scheme; only app and quicklink commands have an Asyar equivalent target.
fn shortcut_target_from_command_id(id: &str) -> Option<ShortcutTarget> {
    if let Some(path) = id.strip_prefix(X_APP_COMMAND_PREFIX) {
        return Some(ShortcutTarget::App {
            path: path.to_string(),
            object_id: None,
            item_name: None,
            item_icon: None,
        });
    }
    id.strip_prefix(X_QUICKLINK_COMMAND_PREFIX)
        .map(|ql_id| ShortcutTarget::Portal { raycast_quicklink_id: ql_id.to_string() })
}

/// Mirrors Asyar's alias validator (`aliasValidation.ts::ALIAS_REGEX`):
/// 1-10 lowercase letters/digits after trimming and lowercasing.
fn normalize_and_validate_alias(raw: &str) -> Option<String> {
    let lowered = raw.trim().to_ascii_lowercase();
    if lowered.is_empty() || lowered.len() > 10 {
        return None;
    }
    lowered
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
        .then_some(lowered)
}

/// Raycast X serializes `pinned` as an integer (0/1) in some categories and
/// a boolean in classic exports.
fn is_truthy(value: Option<&serde_json::Value>) -> bool {
    match value {
        Some(serde_json::Value::Bool(b)) => *b,
        Some(serde_json::Value::Number(n)) => n.as_f64().unwrap_or(0.0) != 0.0,
        _ => false,
    }
}

fn iso_to_epoch_ms(iso: &str) -> Option<f64> {
    use chrono::DateTime;
    DateTime::parse_from_rfc3339(iso)
        .ok()
        .map(|dt| dt.timestamp_millis() as f64)
}

// ---------------------------------------------------------------------------
// Classic Raycast 1.x (.rayconfig)
// ---------------------------------------------------------------------------

/// Classic encrypted layout: first 16 bytes are the IV, the rest is
/// AES-256-CBC ciphertext keyed with sha256(password). The plaintext is the
/// same gzip stream a passwordless classic export produces.
fn parse_classic_encrypted(
    bytes: &[u8],
    password: Option<&str>,
) -> Result<ParseOutcome, AppError> {
    use aes::cipher::{block_padding::Pkcs7, BlockDecryptMut, KeyIvInit};
    use sha2::{Digest, Sha256};

    // Classic ciphertext is IV (16 bytes) + whole AES blocks; anything else
    // is not a Raycast export at all.
    if bytes.len() <= 16 || !(bytes.len() - 16).is_multiple_of(16) {
        return Err(AppError::Validation(
            "Unrecognized Raycast export file".to_string(),
        ));
    }
    let Some(password) = password else {
        return Ok(ParseOutcome::PasswordRequired);
    };

    let key = Sha256::digest(password.as_bytes());
    let (iv, ciphertext) = bytes.split_at(16);
    let decryptor = cbc::Decryptor::<aes::Aes256>::new_from_slices(&key, iv)
        .map_err(|e| AppError::Encryption(format!("Cipher init failed: {e}")))?;

    let Ok(plaintext) = decryptor.decrypt_padded_vec_mut::<Pkcs7>(ciphertext) else {
        return Ok(ParseOutcome::WrongPassword);
    };
    if !is_gzip(&plaintext) {
        // CBC padding can decode "successfully" with the wrong key; the gzip
        // magic check is the real password verdict for the classic format.
        return Ok(ParseOutcome::WrongPassword);
    }

    let value: serde_json::Value = serde_json::from_slice(&gunzip(&plaintext)?)
        .map_err(|e| AppError::Validation(format!("Invalid rayconfig contents: {e}")))?;
    if !is_classic_config(&value) {
        return Err(AppError::Validation(
            "Unrecognized rayconfig contents".to_string(),
        ));
    }
    Ok(ParseOutcome::Ok { bundle: parse_classic(&value)? })
}

fn parse_classic(value: &serde_json::Value) -> Result<ImportBundle, AppError> {
    let mut bundle = ImportBundle {
        source: SourceFormat::RayconfigClassic,
        snippets: Vec::new(),
        portals: Vec::new(),
        shortcuts: Vec::new(),
        aliases: Vec::new(),
        skipped: SkippedCounts::default(),
    };

    if let Some(snippets) = value
        .pointer("/builtin_package_snippets/snippets")
        .and_then(|v| v.as_array())
    {
        for s in snippets {
            let Some(name) = s.get("name").and_then(|v| v.as_str()) else { continue };
            let Some(text) = s.get("text").and_then(|v| v.as_str()) else { continue };
            bundle.snippets.push(ImportSnippet {
                name: name.to_string(),
                keyword: s.get("alias").and_then(|v| v.as_str()).map(str::to_string),
                expansion: translate_placeholders(text, false),
                pinned: is_truthy(s.get("pinned")),
                created_at: s
                    .get("createdAt")
                    .and_then(|v| v.as_str())
                    .and_then(iso_to_epoch_ms),
            });
        }
    }

    if let Some(quicklinks) = value
        .pointer("/builtin_package_quicklinks/quicklinks")
        .and_then(|v| v.as_array())
    {
        for q in quicklinks {
            let Some(name) = q.get("name").and_then(|v| v.as_str()) else { continue };
            let Some(url) = q.get("url").and_then(|v| v.as_str()) else { continue };
            bundle.portals.push(ImportPortal {
                raycast_id: q.get("uuid").and_then(|v| v.as_str()).map(str::to_string),
                name: name.to_string(),
                url: translate_placeholders(url, true),
                icon: PORTAL_ICON.to_string(),
            });
        }
    }

    Ok(bundle)
}

// ---------------------------------------------------------------------------
// Plain JSON exports ("Export Snippets" / "Export Quicklinks")
// ---------------------------------------------------------------------------

fn parse_plain_json(items: &[serde_json::Value]) -> Result<ImportBundle, AppError> {
    let looks_like_snippets = items
        .iter()
        .all(|i| i.get("text").is_some() && i.get("name").is_some());
    let looks_like_quicklinks = items
        .iter()
        .all(|i| i.get("link").is_some() && i.get("name").is_some());

    if !items.is_empty() && looks_like_snippets {
        let snippets = items
            .iter()
            .filter_map(|s| {
                let name = s.get("name")?.as_str()?;
                let text = s.get("text")?.as_str()?;
                Some(ImportSnippet {
                    name: name.to_string(),
                    keyword: s
                        .get("keyword")
                        .and_then(|v| v.as_str())
                        .map(str::to_string),
                    expansion: translate_placeholders(text, false),
                    pinned: false,
                    created_at: None,
                })
            })
            .collect();
        return Ok(ImportBundle {
            source: SourceFormat::SnippetsJson,
            snippets,
            portals: Vec::new(),
            shortcuts: Vec::new(),
            aliases: Vec::new(),
            skipped: SkippedCounts::default(),
        });
    }

    if !items.is_empty() && looks_like_quicklinks {
        let portals = items
            .iter()
            .filter_map(|q| {
                let name = q.get("name")?.as_str()?;
                let link = q.get("link")?.as_str()?;
                Some(ImportPortal {
                    raycast_id: None,
                    name: name.to_string(),
                    url: translate_placeholders(link, true),
                    icon: PORTAL_ICON.to_string(),
                })
            })
            .collect();
        return Ok(ImportBundle {
            source: SourceFormat::QuicklinksJson,
            snippets: Vec::new(),
            portals,
            shortcuts: Vec::new(),
            aliases: Vec::new(),
            skipped: SkippedCounts::default(),
        });
    }

    Err(AppError::Validation(
        "JSON file is not a Raycast snippets or quicklinks export".to_string(),
    ))
}

// ---------------------------------------------------------------------------
// Placeholder translation
// ---------------------------------------------------------------------------

/// Default icon for imported portals (Raycast icon names have no Asyar
/// equivalent — portals use emoji).
const PORTAL_ICON: &str = "🔗";

/// Rewrite Raycast `{token args...}` placeholders into Asyar's canonical
/// tokens (see `src/lib/placeholders/placeholderResolver.ts`). Unknown
/// tokens are left untouched — Asyar renders them literally, which degrades
/// gracefully. `{cursor}` is dropped: Asyar has no cursor-position concept.
fn translate_placeholders(text: &str, _is_url: bool) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find('{') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        let Some(end) = after.find('}') else {
            out.push_str(&rest[start..]);
            rest = "";
            break;
        };
        let token_body = &after[..end];
        let token_name = token_body
            .split_whitespace()
            .next()
            .unwrap_or("")
            .to_ascii_lowercase();
        match token_name.as_str() {
            "argument" | "query" => out.push_str("{query}"),
            "clipboard" => out.push_str("{Clipboard Text}"),
            "selection" => out.push_str("{Selected Text}"),
            "date" => out.push_str("{Date}"),
            "time" => out.push_str("{Time}"),
            "datetime" => out.push_str("{Date & Time}"),
            "day" => out.push_str("{Weekday}"),
            "uuid" => out.push_str("{UUID}"),
            "cursor" => {}
            _ => {
                out.push('{');
                out.push_str(token_body);
                out.push('}');
            }
        }
        rest = &after[end + 1..];
    }
    out.push_str(rest);
    out
}

// ---------------------------------------------------------------------------
// Hotkey translation
// ---------------------------------------------------------------------------

/// Convert a Raycast X hotkey JSON blob into Asyar's canonical
/// `Control+Alt+Shift+Super+K` string. Returns `None` for multi-step
/// hotkeys, unknown modifiers, or keys Asyar cannot represent.
fn translate_hotkey(hotkey: &serde_json::Value) -> Option<String> {
    let kind = hotkey.get("kind")?;
    if kind.get("type")?.as_str()? != "SingleStep" {
        return None;
    }
    let shortcut = kind.get("shortcut")?;

    let mut has = [false; 4]; // Control, Alt, Shift, Super
    for modifier in shortcut.get("modifiers")?.as_array()? {
        match modifier.get("modifier")?.as_str()? {
            "Ctrl" | "Control" => has[0] = true,
            "Alt" | "Option" => has[1] = true,
            "Shift" => has[2] = true,
            "Meta" | "Cmd" | "Command" => has[3] = true,
            "Hyper" => has = [true; 4],
            _ => return None,
        }
    }

    let key = shortcut.get("key")?;
    if key.get("type")?.as_str()? != "LayoutIndependent" {
        return None;
    }
    let key_name = macos_keycode_to_key(key.get("code")?.as_u64()?)?;

    let mut parts: Vec<&str> = Vec::with_capacity(5);
    const MODIFIER_ORDER: [&str; 4] = ["Control", "Alt", "Shift", "Super"];
    for (i, name) in MODIFIER_ORDER.iter().enumerate() {
        if has[i] {
            parts.push(name);
        }
    }
    if parts.is_empty() {
        return None; // Asyar item shortcuts require at least one modifier
    }
    parts.push(key_name);
    Some(parts.join("+"))
}

/// macOS virtual key codes (kVK_ANSI_*) → Asyar key names as accepted by
/// `shortcutFormatter.ts` / the Rust hotkey registrar.
fn macos_keycode_to_key(code: u64) -> Option<&'static str> {
    Some(match code {
        0 => "A",
        1 => "S",
        2 => "D",
        3 => "F",
        4 => "H",
        5 => "G",
        6 => "Z",
        7 => "X",
        8 => "C",
        9 => "V",
        11 => "B",
        12 => "Q",
        13 => "W",
        14 => "E",
        15 => "R",
        16 => "Y",
        17 => "T",
        18 => "1",
        19 => "2",
        20 => "3",
        21 => "4",
        22 => "6",
        23 => "5",
        24 => "=",
        25 => "9",
        26 => "7",
        27 => "-",
        28 => "8",
        29 => "0",
        30 => "]",
        31 => "O",
        32 => "U",
        33 => "[",
        34 => "I",
        35 => "P",
        36 => "Enter",
        37 => "L",
        38 => "J",
        39 => "'",
        40 => "K",
        41 => ";",
        42 => "\\",
        43 => ",",
        44 => "/",
        45 => "N",
        46 => "M",
        47 => ".",
        48 => "Tab",
        49 => "Space",
        50 => "`",
        51 => "Backspace",
        96 => "F5",
        97 => "F6",
        98 => "F7",
        99 => "F3",
        100 => "F8",
        101 => "F9",
        103 => "F11",
        109 => "F10",
        111 => "F12",
        114 => "Insert",
        115 => "Home",
        116 => "PageUp",
        117 => "Delete",
        118 => "F4",
        119 => "End",
        120 => "F2",
        121 => "PageDown",
        122 => "F1",
        123 => "ArrowLeft",
        124 => "ArrowRight",
        125 => "ArrowDown",
        126 => "ArrowUp",
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const PASSWORD: &str = "orange-blue-42";

    const X_PLAIN: &[u8] = include_bytes!("fixtures/x_plain.rayconfig");
    const X_ENCRYPTED: &[u8] = include_bytes!("fixtures/x_encrypted.rayconfig");
    const CLASSIC_PLAIN: &[u8] = include_bytes!("fixtures/classic_plain.rayconfig");
    const CLASSIC_ENCRYPTED: &[u8] = include_bytes!("fixtures/classic_encrypted.rayconfig");
    const SNIPPETS_JSON: &[u8] = include_bytes!("fixtures/snippets_export.json");
    const QUICKLINKS_JSON: &[u8] = include_bytes!("fixtures/quicklinks_export.json");

    fn bundle(outcome: ParseOutcome) -> ImportBundle {
        match outcome {
            ParseOutcome::Ok { bundle } => bundle,
            other => panic!("expected Ok outcome, got {other:?}"),
        }
    }

    // ---- Raycast X format ----

    #[test]
    fn x_plain_parses_snippets_with_placeholder_translation() {
        let b = bundle(parse_export(X_PLAIN, None).unwrap());
        assert_eq!(b.source, SourceFormat::RayconfigX);
        assert_eq!(b.snippets.len(), 2);

        let sig = &b.snippets[0];
        assert_eq!(sig.name, "Email sig");
        assert_eq!(sig.keyword.as_deref(), Some("!sig"));
        // {clipboard} → {Clipboard Text}, {date} → {Date}, {cursor} removed
        assert_eq!(sig.expansion, "Best,\nJohn {Clipboard Text} on {Date} ");
        assert!(!sig.pinned);
        // 2026-01-02T03:04:05Z
        assert_eq!(sig.created_at, Some(1767323045000.0));

        let plain = &b.snippets[1];
        assert_eq!(plain.name, "Plain");
        assert_eq!(plain.keyword, None);
        assert_eq!(plain.expansion, "hello world");
        assert!(plain.pinned);
    }

    #[test]
    fn x_plain_parses_quicklinks_as_portals() {
        let b = bundle(parse_export(X_PLAIN, None).unwrap());
        assert_eq!(b.portals.len(), 2);

        let google = &b.portals[0];
        assert_eq!(google.raycast_id.as_deref(), Some("02A"));
        assert_eq!(google.name, "Search Google");
        assert_eq!(google.url, "https://google.com/search?q={query}");
        assert_eq!(google.icon, "🔗");

        // {Query} and {argument name="word" ...} both become {query}
        let translate = &b.portals[1];
        assert_eq!(translate.url, "https://t.example/?text={query}&x={query}");
    }

    #[test]
    fn x_plain_parses_app_and_quicklink_hotkeys_and_skips_the_rest() {
        let b = bundle(parse_export(X_PLAIN, None).unwrap());
        assert_eq!(b.shortcuts.len(), 2);

        let app = &b.shortcuts[0];
        assert_eq!(
            app.target,
            ShortcutTarget::App {
                path: "/Applications/iTerm.app".into(),
                object_id: None,
                item_name: None,
                item_icon: None,
            }
        );
        // Shift+Ctrl+Alt+Meta + kVK_ANSI_I(34), canonical modifier order
        assert_eq!(app.shortcut, "Control+Alt+Shift+Super+I");

        let ql = &b.shortcuts[1];
        assert_eq!(
            ql.target,
            ShortcutTarget::Portal { raycast_quicklink_id: "02A".into() }
        );
        assert_eq!(ql.shortcut, "Shift+Super+T");

        // system-command hotkey (no Asyar target) skipped
        assert_eq!(b.skipped.hotkeys, 1);
    }

    #[test]
    fn x_plain_parses_aliases_and_skips_unresolvable_or_invalid() {
        let b = bundle(parse_export(X_PLAIN, None).unwrap());
        assert_eq!(b.aliases.len(), 2);

        let app_alias = &b.aliases[0];
        assert_eq!(
            app_alias.target,
            ShortcutTarget::App {
                path: "/Applications/iTerm.app".into(),
                object_id: None,
                item_name: None,
                item_icon: None,
            }
        );
        assert_eq!(app_alias.alias, "it");

        let portal_alias = &b.aliases[1];
        assert_eq!(
            portal_alias.target,
            ShortcutTarget::Portal { raycast_quicklink_id: "02A".into() }
        );
        assert_eq!(portal_alias.alias, "gg");

        // Foo.app's alias "?" fails Asyar's validator; xxxx's "tr" is bound
        // to a Raycast extension command with no Asyar target.
        assert_eq!(b.skipped.aliases, 2);
    }

    #[test]
    fn x_encrypted_without_password_reports_password_required() {
        let outcome = parse_export(X_ENCRYPTED, None).unwrap();
        assert_eq!(outcome, ParseOutcome::PasswordRequired);
    }

    #[test]
    fn x_encrypted_with_wrong_password_reports_wrong_password() {
        let outcome = parse_export(X_ENCRYPTED, Some("nope-nope")).unwrap();
        assert_eq!(outcome, ParseOutcome::WrongPassword);
    }

    #[test]
    fn x_encrypted_with_correct_password_matches_plain_bundle() {
        let plain = bundle(parse_export(X_PLAIN, None).unwrap());
        let decrypted = bundle(parse_export(X_ENCRYPTED, Some(PASSWORD)).unwrap());
        assert_eq!(plain, decrypted);
    }

    // ---- Classic 1.x format ----

    #[test]
    fn classic_plain_parses_snippets_and_quicklinks() {
        let b = bundle(parse_export(CLASSIC_PLAIN, None).unwrap());
        assert_eq!(b.source, SourceFormat::RayconfigClassic);

        assert_eq!(b.snippets.len(), 1);
        assert_eq!(b.snippets[0].name, "Addr");
        assert_eq!(b.snippets[0].keyword.as_deref(), Some(";addr"));
        assert_eq!(b.snippets[0].expansion, "221B Baker St");

        assert_eq!(b.portals.len(), 1);
        assert_eq!(b.portals[0].name, "DuckDuckGo");
        assert_eq!(b.portals[0].url, "https://duckduckgo.com/?q={query}");
        assert!(b.shortcuts.is_empty());
    }

    #[test]
    fn classic_encrypted_password_flow() {
        assert_eq!(
            parse_export(CLASSIC_ENCRYPTED, None).unwrap(),
            ParseOutcome::PasswordRequired
        );
        assert_eq!(
            parse_export(CLASSIC_ENCRYPTED, Some("wrong")).unwrap(),
            ParseOutcome::WrongPassword
        );
        let b = bundle(parse_export(CLASSIC_ENCRYPTED, Some(PASSWORD)).unwrap());
        assert_eq!(b.snippets.len(), 1);
        assert_eq!(b.portals.len(), 1);
    }

    // ---- Plain JSON exports ----

    #[test]
    fn snippets_json_export_parses() {
        let b = bundle(parse_export(SNIPPETS_JSON, None).unwrap());
        assert_eq!(b.source, SourceFormat::SnippetsJson);
        assert_eq!(b.snippets.len(), 2);
        assert_eq!(b.snippets[0].name, "Personal Email");
        assert_eq!(b.snippets[0].keyword.as_deref(), Some("@@"));
        assert_eq!(b.snippets[1].keyword, None);
        assert!(b.portals.is_empty());
    }

    #[test]
    fn quicklinks_json_export_parses() {
        let b = bundle(parse_export(QUICKLINKS_JSON, None).unwrap());
        assert_eq!(b.source, SourceFormat::QuicklinksJson);
        assert_eq!(b.portals.len(), 2);
        assert_eq!(b.portals[0].url, "https://duckduckgo.com/?q={query}");
        assert_eq!(b.portals[1].url, "~/Downloads");
        assert!(b.snippets.is_empty());
    }

    // ---- Errors ----

    #[test]
    fn garbage_input_is_an_error() {
        assert!(parse_export(b"definitely not a rayconfig", None).is_err());
        assert!(parse_export(&[], None).is_err());
    }

    // ---- App shortcut resolution ----

    fn make_app(id: &str, name: &str, path: &str) -> Application {
        Application {
            id: id.to_string(),
            name: name.to_string(),
            path: path.to_string(),
            usage_count: 0,
            icon: Some("icon-data".to_string()),
            last_used_at: None,
            bundle_id: None,
        }
    }

    #[test]
    fn resolve_app_targets_fills_index_identity_and_drops_missing_apps() {
        let mut b = bundle(parse_export(X_PLAIN, None).unwrap());
        let apps = vec![make_app("app_123", "iTerm", "/Applications/iTerm.app")];
        let skipped_hotkeys_before = b.skipped.hotkeys;

        resolve_app_targets(&mut b, &apps);

        // iTerm matched: identity attached
        assert_eq!(b.shortcuts.len(), 2);
        match &b.shortcuts[0].target {
            ShortcutTarget::App { object_id, item_name, item_icon, .. } => {
                assert_eq!(object_id.as_deref(), Some("app_123"));
                assert_eq!(item_name.as_deref(), Some("iTerm"));
                assert_eq!(item_icon.as_deref(), Some("icon-data"));
            }
            other => panic!("expected app target, got {other:?}"),
        }

        // Now resolve against an empty index: app hotkey dropped and counted
        let mut b2 = bundle(parse_export(X_PLAIN, None).unwrap());
        resolve_app_targets(&mut b2, &[]);
        assert_eq!(b2.shortcuts.len(), 1); // only the portal hotkey remains
        assert_eq!(b2.skipped.hotkeys, skipped_hotkeys_before + 1);
    }

    #[test]
    fn resolve_app_targets_fills_alias_identity_and_drops_missing_apps() {
        let mut b = bundle(parse_export(X_PLAIN, None).unwrap());
        let apps = vec![make_app("app_123", "iTerm", "/Applications/iTerm.app")];
        let skipped_aliases_before = b.skipped.aliases;

        resolve_app_targets(&mut b, &apps);

        // iTerm's alias resolved: identity attached
        assert_eq!(b.aliases.len(), 2);
        match &b.aliases[0].target {
            ShortcutTarget::App { object_id, item_name, item_icon, .. } => {
                assert_eq!(object_id.as_deref(), Some("app_123"));
                assert_eq!(item_name.as_deref(), Some("iTerm"));
                assert_eq!(item_icon.as_deref(), Some("icon-data"));
            }
            other => panic!("expected app target, got {other:?}"),
        }
        // Portal alias passes through untouched
        assert_eq!(
            b.aliases[1].target,
            ShortcutTarget::Portal { raycast_quicklink_id: "02A".into() }
        );

        // Against an empty index: iTerm's alias dropped and counted, portal
        // alias (no app resolution needed) survives.
        let mut b2 = bundle(parse_export(X_PLAIN, None).unwrap());
        resolve_app_targets(&mut b2, &[]);
        assert_eq!(b2.aliases.len(), 1);
        assert_eq!(b2.skipped.aliases, skipped_aliases_before + 1);
    }
}
