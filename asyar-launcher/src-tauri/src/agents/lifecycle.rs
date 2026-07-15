use crate::error::AppError;
use crate::storage::agents::{
    get_agent, insert_agent, list_agents, update_agent, AgentRow, SilentInputSource,
    SilentOutputAction,
};
use rusqlite::Connection;

pub const DEFAULT_AGENT_SYSTEM_PROMPT: &str = "You are Asyar Assistant, a friendly and helpful AI built into the Asyar launcher. Help the user with quick questions, explanations, drafting, summarizing, and general thinking-through. Be concise, accurate, and direct. If you don't know something, say so. Use Markdown for code and lists when it improves clarity.";

pub const GRAMMAR_FIX_SYSTEM_PROMPT: &str = "You rewrite English text with corrected grammar, spelling, and phrasing.\nPreserve the original tone, voice, language, register, and formatting.\n\nOutput rules:\n- Output the corrected text only. Match the input's length — a short\n  input gets a short output, a long input gets a long output.\n- No preamble. No explanation. No alternatives. No quotation marks\n  around the output. No \"Here is...\" or \"Sure, ...\".\n- If the input is already correct, output it unchanged.\n\nExamples:\n\nInput: the cat sit on mat\nOutput: The cat sits on the mat.\n\nInput: i recieved you're message yesterday and ill respond asap\nOutput: I received your message yesterday and I'll respond ASAP.\n\nInput: We was going too the store wen it started raining\nOutput: We were going to the store when it started raining.\n\nInput: This is a perfectly fine sentence already.\nOutput: This is a perfectly fine sentence already.\n\nNow correct the user's next message the same way.";

const INLINE_EMOJI_SYSTEM_PROMPT: &str = "You are an inline emoji resolver. The user just typed a :shortcode: pattern that did not match any known shortcode. Call the emoji_find tool with the inner word as the description. Reply with exactly one emoji character if confident, or empty string if not. No prose, no quotes.";
const INLINE_EMOJI_FALLBACK_PROVIDER_ID: &str = "anthropic";
const INLINE_EMOJI_FALLBACK_MODEL_ID: &str = "claude-haiku-4-5-20251001";

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum BuiltinAgentProfile {
    InlineEmoji,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum SilentAgentTarget {
    Stored {
        agent_id: String,
    },
    Builtin {
        profile: BuiltinAgentProfile,
        default_agent_id: Option<String>,
    },
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

fn validate_provider_model(provider_id: &str, model_id: &str) -> Result<(), AppError> {
    if provider_id.trim().is_empty() {
        return Err(AppError::Validation(
            "provider_id must not be empty".to_string(),
        ));
    }
    if model_id.trim().is_empty() {
        return Err(AppError::Validation(
            "model_id must not be empty".to_string(),
        ));
    }
    Ok(())
}

fn default_agent(provider_id: &str, model_id: &str) -> AgentRow {
    let now = now_ms();
    AgentRow {
        id: uuid::Uuid::new_v4().to_string(),
        name: "Asyar Assistant".to_string(),
        description: Some("Your built-in AI assistant. Editable from the Agents view.".to_string()),
        system_prompt: DEFAULT_AGENT_SYSTEM_PROMPT.to_string(),
        provider_id: provider_id.to_string(),
        model_id: model_id.to_string(),
        tool_selection: vec![],
        silent: false,
        input_source: SilentInputSource::Argument,
        output_action: SilentOutputAction::ReplaceSelection,
        created_at: Some(now),
        updated_at: Some(now),
    }
}

pub fn resolve_default_agent(
    conn: &Connection,
    default_agent_id: Option<&str>,
) -> Result<Option<AgentRow>, AppError> {
    if let Some(id) = default_agent_id.filter(|id| !id.trim().is_empty()) {
        if let Some(agent) = get_agent(conn, id)? {
            return Ok(Some(agent));
        }
    }
    Ok(list_agents(conn)?.into_iter().next())
}

pub fn upsert_default_agent(
    conn: &Connection,
    default_agent_id: Option<&str>,
    provider_id: &str,
    model_id: &str,
) -> Result<AgentRow, AppError> {
    validate_provider_model(provider_id, model_id)?;
    if let Some(mut existing) = default_agent_id
        .filter(|id| !id.trim().is_empty())
        .map(|id| get_agent(conn, id))
        .transpose()?
        .flatten()
    {
        existing.provider_id = provider_id.to_string();
        existing.model_id = model_id.to_string();
        existing.updated_at = Some(now_ms());
        update_agent(conn, &existing)?;
        return Ok(existing);
    }

    let agent = default_agent(provider_id, model_id);
    insert_agent(conn, &agent)?;
    Ok(agent)
}

pub fn seed_grammar_fix_agent(
    conn: &Connection,
    provider_id: &str,
    model_id: &str,
) -> Result<AgentRow, AppError> {
    validate_provider_model(provider_id, model_id)?;
    if let Some(existing) = list_agents(conn)?
        .into_iter()
        .find(|agent| agent.name == "Grammar Fix")
    {
        return Ok(existing);
    }
    let now = now_ms();
    let agent = AgentRow {
        id: uuid::Uuid::new_v4().to_string(),
        name: "Grammar Fix".to_string(),
        description: Some(
            "Silent agent: replace selected text with the grammar-corrected version.".to_string(),
        ),
        system_prompt: GRAMMAR_FIX_SYSTEM_PROMPT.to_string(),
        provider_id: provider_id.to_string(),
        model_id: model_id.to_string(),
        tool_selection: vec![],
        silent: true,
        input_source: SilentInputSource::Selection,
        output_action: SilentOutputAction::ReplaceSelection,
        created_at: Some(now),
        updated_at: Some(now),
    };
    insert_agent(conn, &agent)?;
    Ok(agent)
}

pub fn build_builtin_agent_profile(
    profile: BuiltinAgentProfile,
    provider_id: &str,
    model_id: &str,
) -> AgentRow {
    match profile {
        BuiltinAgentProfile::InlineEmoji => AgentRow {
            id: "builtin-profile:inline-emoji".to_string(),
            name: "Inline emoji fallback".to_string(),
            description: Some(
                "Resolves unknown :shortcode: patterns to a single emoji.".to_string(),
            ),
            system_prompt: INLINE_EMOJI_SYSTEM_PROMPT.to_string(),
            provider_id: provider_id.to_string(),
            model_id: model_id.to_string(),
            tool_selection: vec!["org.asyar.emoji:emoji_find".to_string()],
            silent: true,
            input_source: SilentInputSource::Argument,
            output_action: SilentOutputAction::Paste,
            created_at: None,
            updated_at: None,
        },
    }
}

pub fn resolve_builtin_agent_profile(
    conn: &Connection,
    profile: BuiltinAgentProfile,
    default_agent_id: Option<&str>,
) -> Result<AgentRow, AppError> {
    let default = resolve_default_agent(conn, default_agent_id)?;
    let (provider_id, model_id) = default
        .as_ref()
        .map(|agent| (agent.provider_id.as_str(), agent.model_id.as_str()))
        .unwrap_or((
            INLINE_EMOJI_FALLBACK_PROVIDER_ID,
            INLINE_EMOJI_FALLBACK_MODEL_ID,
        ));
    Ok(build_builtin_agent_profile(profile, provider_id, model_id))
}

pub fn resolve_silent_agent_target(
    conn: &Connection,
    target: &SilentAgentTarget,
) -> Result<AgentRow, AppError> {
    match target {
        SilentAgentTarget::Stored { agent_id } => get_agent(conn, agent_id)?
            .ok_or_else(|| AppError::NotFound(format!("agent '{agent_id}' not found"))),
        SilentAgentTarget::Builtin {
            profile,
            default_agent_id,
        } => resolve_builtin_agent_profile(conn, *profile, default_agent_id.as_deref()),
    }
}

pub fn derive_thread_title(user_text: &str) -> String {
    let collapsed = user_text.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.is_empty() {
        return "New thread".to_string();
    }
    let chars = collapsed.chars().collect::<Vec<_>>();
    const LIMIT: usize = 40;
    if chars.len() <= LIMIT {
        return collapsed;
    }
    let window_end = (LIMIT + 1).min(chars.len());
    let cut = chars[..window_end]
        .iter()
        .rposition(|character| character.is_whitespace())
        .filter(|index| *index > 20)
        .unwrap_or(LIMIT);
    format!("{}…", chars[..cut].iter().collect::<String>().trim_end())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::agents::{get_agent, insert_agent, list_agents, AgentRow};
    use rusqlite::Connection;

    fn conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        crate::storage::agents::init_table(&conn).unwrap();
        conn
    }

    fn existing_agent(id: &str, name: &str) -> AgentRow {
        AgentRow {
            id: id.to_string(),
            name: name.to_string(),
            description: Some("User-edited description".to_string()),
            system_prompt: "User-edited prompt".to_string(),
            provider_id: "openai".to_string(),
            model_id: "gpt-old".to_string(),
            tool_selection: vec!["builtin:search".to_string()],
            silent: false,
            input_source: crate::storage::agents::SilentInputSource::Argument,
            output_action: crate::storage::agents::SilentOutputAction::ReplaceSelection,
            created_at: Some(1),
            updated_at: Some(1),
        }
    }

    #[test]
    fn upsert_default_creates_the_canonical_profile() {
        let conn = conn();

        let agent = upsert_default_agent(&conn, None, "anthropic", "claude-sonnet").unwrap();

        assert_eq!(agent.name, "Asyar Assistant");
        assert_eq!(agent.provider_id, "anthropic");
        assert_eq!(agent.model_id, "claude-sonnet");
        assert_eq!(agent.system_prompt, DEFAULT_AGENT_SYSTEM_PROMPT);
        assert_eq!(list_agents(&conn).unwrap(), vec![agent]);
    }

    #[test]
    fn upsert_default_preserves_user_edits_and_changes_provider_only() {
        let conn = conn();
        let existing = existing_agent("default-1", "My Assistant");
        insert_agent(&conn, &existing).unwrap();

        let updated =
            upsert_default_agent(&conn, Some("default-1"), "anthropic", "claude-sonnet").unwrap();

        assert_eq!(updated.name, "My Assistant");
        assert_eq!(updated.system_prompt, "User-edited prompt");
        assert_eq!(updated.tool_selection, vec!["builtin:search"]);
        assert_eq!(updated.provider_id, "anthropic");
        assert_eq!(updated.model_id, "claude-sonnet");
    }

    #[test]
    fn grammar_fix_seed_is_idempotent_in_sqlite() {
        let conn = conn();

        let first = seed_grammar_fix_agent(&conn, "openai", "gpt-4o-mini").unwrap();
        let second = seed_grammar_fix_agent(&conn, "anthropic", "claude-haiku").unwrap();

        assert_eq!(first.id, second.id);
        assert_eq!(second.provider_id, "openai");
        assert!(second.silent);
        assert_eq!(
            second.input_source,
            crate::storage::agents::SilentInputSource::Selection
        );
        assert_eq!(list_agents(&conn).unwrap().len(), 1);
    }

    #[test]
    fn resolve_default_uses_registered_id_then_database_order_fallback() {
        let conn = conn();
        let first = existing_agent("a", "First");
        let second = existing_agent("b", "Second");
        insert_agent(&conn, &first).unwrap();
        insert_agent(&conn, &second).unwrap();

        assert_eq!(
            resolve_default_agent(&conn, Some("b")).unwrap(),
            Some(second)
        );
        assert_eq!(
            resolve_default_agent(&conn, Some("missing")).unwrap(),
            Some(first)
        );
    }

    #[test]
    fn inline_emoji_profile_is_defined_in_rust() {
        let profile = build_builtin_agent_profile(
            BuiltinAgentProfile::InlineEmoji,
            "anthropic",
            "claude-haiku",
        );

        assert_eq!(profile.id, "builtin-profile:inline-emoji");
        assert_eq!(profile.tool_selection, vec!["org.asyar.emoji:emoji_find"]);
        assert!(profile.silent);
        assert_eq!(
            profile.output_action,
            crate::storage::agents::SilentOutputAction::Paste
        );
    }

    #[test]
    fn builtin_profile_uses_rust_resolved_default_provider() {
        let conn = conn();
        let mut default = existing_agent("default-1", "Assistant");
        default.provider_id = "openrouter".to_string();
        default.model_id = "fast-model".to_string();
        insert_agent(&conn, &default).unwrap();

        let profile = resolve_builtin_agent_profile(
            &conn,
            BuiltinAgentProfile::InlineEmoji,
            Some("default-1"),
        )
        .unwrap();

        assert_eq!(profile.provider_id, "openrouter");
        assert_eq!(profile.model_id, "fast-model");
    }

    #[test]
    fn derives_a_compact_title_from_the_first_message() {
        assert_eq!(derive_thread_title("  hello\n\n world  "), "hello world");
        assert_eq!(derive_thread_title("   "), "New thread");
        let title = derive_thread_title(
            "This is a long message that should be truncated at a word boundary near forty",
        );
        assert!(title.ends_with('…'));
        assert!(title.chars().count() <= 41);
    }

    #[test]
    fn upsert_default_does_not_duplicate_when_id_exists() {
        let conn = conn();
        insert_agent(&conn, &existing_agent("default-1", "Assistant")).unwrap();

        upsert_default_agent(&conn, Some("default-1"), "openai", "gpt-new").unwrap();

        assert_eq!(list_agents(&conn).unwrap().len(), 1);
        assert_eq!(
            get_agent(&conn, "default-1").unwrap().unwrap().model_id,
            "gpt-new"
        );
    }

    #[test]
    fn resolves_typed_silent_targets_without_frontend_agent_overrides() {
        let conn = conn();
        let mut stored = existing_agent("silent-1", "Stored");
        stored.silent = true;
        insert_agent(&conn, &stored).unwrap();

        assert_eq!(
            resolve_silent_agent_target(
                &conn,
                &SilentAgentTarget::Stored {
                    agent_id: "silent-1".to_string(),
                },
            )
            .unwrap(),
            stored
        );
        assert_eq!(
            resolve_silent_agent_target(
                &conn,
                &SilentAgentTarget::Builtin {
                    profile: BuiltinAgentProfile::InlineEmoji,
                    default_agent_id: None,
                },
            )
            .unwrap()
            .id,
            "builtin-profile:inline-emoji"
        );
    }
}
