use crate::error::AppError;
use crate::storage::agents::{
    get_agent, insert_agent, list_agents, update_agent, AgentRow, SilentInputSource,
    SilentOutputAction,
};
use rusqlite::Connection;

pub const DEFAULT_AGENT_SYSTEM_PROMPT: &str = "You are Asyar Assistant, a friendly and helpful AI built into the Asyar launcher. Help the user with quick questions, explanations, drafting, summarizing, and general thinking-through. Be concise, accurate, and direct. If you don't know something, say so. Use Markdown for code and lists when it improves clarity.";

pub const GRAMMAR_FIX_SYSTEM_PROMPT: &str = "You rewrite English text with corrected grammar, spelling, and phrasing.\nPreserve the original tone, voice, language, register, and formatting.\n\nOutput rules:\n- Output the corrected text only. Match the input's length — a short\n  input gets a short output, a long input gets a long output.\n- No preamble. No explanation. No alternatives. No quotation marks\n  around the output. No \"Here is...\" or \"Sure, ...\".\n- If the input is already correct, output it unchanged.\n\nExamples:\n\nInput: the cat sit on mat\nOutput: The cat sits on the mat.\n\nInput: i recieved you're message yesterday and ill respond asap\nOutput: I received your message yesterday and I'll respond ASAP.\n\nInput: We was going too the store wen it started raining\nOutput: We were going to the store when it started raining.\n\nInput: This is a perfectly fine sentence already.\nOutput: This is a perfectly fine sentence already.\n\nNow correct the user's next message the same way.";

const INLINE_EMOJI_SYSTEM_PROMPT: &str = "You are an inline emoji resolver. The user just typed a {trigger}shortcode{trigger} pattern that did not match any known shortcode. Call the emoji_find tool with the inner word as the description. Reply with exactly one emoji character if confident, or empty string if not. No prose, no quotes.";

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
        cache_responses: false,
        shortcode_trigger: ":".to_string(),
        created_at: Some(now),
        updated_at: Some(now),
    }
}

/// Resolve the user's chosen default agent by id.
///
/// Returns `None` when no id is stored or the stored id no longer points at a
/// live agent. It deliberately does NOT fall back to "the first agent in the
/// DB" — that fallback made a provider the user never picked appear as the ★
/// default (e.g. a leftover Anthropic agent from onboarding). A default is
/// shown only when it was explicitly chosen.
pub fn resolve_default_agent(
    conn: &Connection,
    default_agent_id: Option<&str>,
) -> Result<Option<AgentRow>, AppError> {
    match default_agent_id.filter(|id| !id.trim().is_empty()) {
        Some(id) => get_agent(conn, id),
        None => Ok(None),
    }
}

/// The earliest-inserted agent, or `None` when there are no agents.
///
/// Used only where "any existing agent" is a sensible template (e.g. seeding
/// the emoji fallback agent's provider/model at startup) — never for resolving
/// the user-facing default.
pub fn first_agent(conn: &Connection) -> Result<Option<AgentRow>, AppError> {
    Ok(list_agents(conn)?.into_iter().next())
}

pub fn upsert_default_agent(
    conn: &Connection,
    default_agent_id: Option<&str>,
    provider_id: &str,
    model_id: &str,
) -> Result<AgentRow, AppError> {
    validate_provider_model(provider_id, model_id)?;

    let by_id = default_agent_id
        .filter(|id| !id.trim().is_empty())
        .map(|id| get_agent(conn, id))
        .transpose()?
        .flatten();

    // Falls back to the well-known name when `default_agent_id` is absent or
    // dangling (e.g. settings hadn't loaded yet, or the id was lost) — the
    // same idempotency pattern `seed_grammar_fix_agent` and
    // `seed_emoji_fallback_agent` use, so a missing id reuses the existing
    // built-in assistant instead of minting a duplicate.
    let existing = match by_id {
        Some(agent) => Some(agent),
        None => list_agents(conn)?
            .into_iter()
            .find(|agent| agent.name == "Asyar Assistant"),
    };

    if let Some(mut existing) = existing {
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
        cache_responses: false,
        shortcode_trigger: ":".to_string(),
        created_at: Some(now),
        updated_at: Some(now),
    };
    insert_agent(conn, &agent)?;
    Ok(agent)
}

/// Seed the inline emoji fallback agent if it does not already exist.
///
/// The agent uses `input_source: ShortcodeMiss` — it is woken by the Rust
/// shortcode-miss listener rather than direct user dispatch. It is stored in
/// the DB like any other agent so the user can edit its model, system prompt,
/// and tools. Returns the existing agent unchanged if one with this name
/// already exists.
pub fn seed_emoji_fallback_agent(
    conn: &Connection,
    provider_id: &str,
    model_id: &str,
) -> Result<AgentRow, AppError> {
    validate_provider_model(provider_id, model_id)?;
    if let Some(existing) = list_agents(conn)?
        .into_iter()
        .find(|agent| agent.name == "Inline Emoji Fallback")
    {
        return Ok(existing);
    }
    let now = now_ms();
    let agent = AgentRow {
        id: uuid::Uuid::new_v4().to_string(),
        name: "Inline Emoji Fallback".to_string(),
        description: Some(
            "Resolves unknown :shortcode: patterns to a single emoji. \
             Triggered automatically on shortcode-miss events."
                .to_string(),
        ),
        system_prompt: INLINE_EMOJI_SYSTEM_PROMPT.to_string(),
        provider_id: provider_id.to_string(),
        model_id: model_id.to_string(),
        tool_selection: vec!["org.asyar.emoji:emoji_find".to_string()],
        silent: true,
        input_source: SilentInputSource::ShortcodeMiss,
        output_action: SilentOutputAction::Paste,
        cache_responses: true,
        shortcode_trigger: ":".to_string(),
        created_at: Some(now),
        updated_at: Some(now),
    };
    insert_agent(conn, &agent)?;
    Ok(agent)
}

/// Looks up the first stored agent whose `input_source` is `ShortcodeMiss`.
/// Returns `None` if no such agent has been seeded yet.
pub fn find_shortcode_miss_agent(conn: &Connection) -> Result<Option<AgentRow>, AppError> {
    Ok(list_agents(conn)?
        .into_iter()
        .find(|agent| agent.input_source == SilentInputSource::ShortcodeMiss))
}

/// Reduces a `ShortcodeMiss` agent's raw reply to a single emoji, or an empty
/// string if the model ignored its instructions and answered conversationally
/// instead of calling `emoji_find`. Only a reply that trims to exactly one
/// non-ASCII grapheme is trusted — anything else (prose, punctuation, plain
/// ASCII) is treated the same as "no match" rather than pasted verbatim.
pub fn sanitize_emoji_fallback_output(text: &str) -> String {
    use unicode_segmentation::UnicodeSegmentation;

    let trimmed = text.trim();
    let is_single_non_ascii_grapheme = UnicodeSegmentation::graphemes(trimmed, true).count() == 1
        && trimmed.chars().next().is_some_and(|c| !c.is_ascii());

    if is_single_non_ascii_grapheme {
        trimmed.to_string()
    } else {
        String::new()
    }
}

/// Resolve a stored silent-agent target to its `AgentRow`.
pub fn resolve_silent_agent_target(
    conn: &Connection,
    agent_id: &str,
) -> Result<AgentRow, AppError> {
    get_agent(conn, agent_id)?
        .ok_or_else(|| AppError::NotFound(format!("agent '{agent_id}' not found")))
}

pub fn derive_thread_title(user_text: &str) -> String {
    let collapsed = user_text.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.is_empty() {
        return "New thread".to_string();
    }
    let chars = collapsed.chars().collect::<Vec<_>>();
    const TITLE_LIMIT: usize = 40;
    // Prefer the hard limit when the only word boundary is in the title's first half.
    const MIN_WORD_BOUNDARY_INDEX: usize = TITLE_LIMIT / 2;
    if chars.len() <= TITLE_LIMIT {
        return collapsed;
    }
    let window_end = (TITLE_LIMIT + 1).min(chars.len());
    let cut = chars[..window_end]
        .iter()
        .rposition(|character| character.is_whitespace())
        .filter(|index| *index > MIN_WORD_BOUNDARY_INDEX)
        .unwrap_or(TITLE_LIMIT);
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
            cache_responses: false,
            shortcode_trigger: ":".to_string(),
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
    fn resolve_default_returns_the_registered_agent_or_none() {
        let conn = conn();
        let first = existing_agent("a", "First");
        let second = existing_agent("b", "Second");
        insert_agent(&conn, &first).unwrap();
        insert_agent(&conn, &second).unwrap();

        // A valid id resolves to that exact agent.
        assert_eq!(
            resolve_default_agent(&conn, Some("b")).unwrap(),
            Some(second)
        );
        // A dangling id resolves to None — never a silent fall back to another
        // agent, so the UI only shows a ★ default the user actually chose.
        assert_eq!(resolve_default_agent(&conn, Some("missing")).unwrap(), None);
        // No id at all means no default has been chosen yet.
        assert_eq!(resolve_default_agent(&conn, None).unwrap(), None);
    }

    #[test]
    fn first_agent_returns_earliest_by_db_order_or_none_when_empty() {
        let conn = conn();
        assert_eq!(first_agent(&conn).unwrap(), None);

        let first = existing_agent("a", "First");
        let second = existing_agent("b", "Second");
        insert_agent(&conn, &first).unwrap();
        insert_agent(&conn, &second).unwrap();

        assert_eq!(first_agent(&conn).unwrap(), Some(first));
    }

    #[test]
    fn emoji_fallback_seed_is_idempotent_in_sqlite() {
        let conn = conn();

        let first = seed_emoji_fallback_agent(&conn, "openai", "gpt-4o-mini").unwrap();
        let second = seed_emoji_fallback_agent(&conn, "anthropic", "claude-haiku").unwrap();

        assert_eq!(first.id, second.id);
        // Idempotent: provider from the first call is retained.
        assert_eq!(second.provider_id, "openai");
        assert!(second.silent);
        assert_eq!(
            second.input_source,
            crate::storage::agents::SilentInputSource::ShortcodeMiss
        );
        assert_eq!(
            second.output_action,
            crate::storage::agents::SilentOutputAction::Paste
        );
        assert_eq!(second.tool_selection, vec!["org.asyar.emoji:emoji_find"]);
        assert_eq!(list_agents(&conn).unwrap().len(), 1);
    }

    #[test]
    fn find_shortcode_miss_agent_returns_seeded_agent() {
        let conn = conn();

        assert!(find_shortcode_miss_agent(&conn).unwrap().is_none());

        let seeded = seed_emoji_fallback_agent(&conn, "anthropic", "claude-haiku").unwrap();
        let found = find_shortcode_miss_agent(&conn).unwrap();

        assert_eq!(
            found.as_ref().map(|a| a.id.as_str()),
            Some(seeded.id.as_str())
        );
    }

    #[test]
    fn sanitize_emoji_fallback_output_passes_through_a_single_emoji() {
        assert_eq!(sanitize_emoji_fallback_output("🎉"), "🎉");
    }

    #[test]
    fn sanitize_emoji_fallback_output_trims_surrounding_whitespace() {
        assert_eq!(sanitize_emoji_fallback_output("  🎉\n"), "🎉");
    }

    #[test]
    fn sanitize_emoji_fallback_output_rejects_prose() {
        assert_eq!(
            sanitize_emoji_fallback_output(
                "# Party Suggestions\n\nHere are some ideas for \"party\":"
            ),
            ""
        );
    }

    #[test]
    fn sanitize_emoji_fallback_output_rejects_empty_or_whitespace_only() {
        assert_eq!(sanitize_emoji_fallback_output(""), "");
        assert_eq!(sanitize_emoji_fallback_output("   \n  "), "");
    }

    #[test]
    fn sanitize_emoji_fallback_output_rejects_a_single_ascii_character() {
        assert_eq!(sanitize_emoji_fallback_output("x"), "");
        assert_eq!(sanitize_emoji_fallback_output(":"), "");
    }

    #[test]
    fn resolve_silent_agent_target_returns_stored_agent() {
        let conn = conn();
        let mut stored = existing_agent("silent-1", "Stored");
        stored.silent = true;
        insert_agent(&conn, &stored).unwrap();

        assert_eq!(
            resolve_silent_agent_target(&conn, "silent-1").unwrap(),
            stored
        );
    }

    #[test]
    fn resolve_silent_agent_target_errors_on_missing_id() {
        let conn = conn();
        let result = resolve_silent_agent_target(&conn, "nonexistent");
        assert!(matches!(result, Err(crate::error::AppError::NotFound(_))));
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
    fn upsert_default_does_not_duplicate_when_id_is_repeatedly_missing() {
        let conn = conn();

        let first = upsert_default_agent(&conn, None, "anthropic", "claude-sonnet").unwrap();
        let second = upsert_default_agent(&conn, None, "openai", "gpt-4o").unwrap();

        assert_eq!(first.id, second.id);
        assert_eq!(second.provider_id, "openai");
        assert_eq!(second.model_id, "gpt-4o");
        assert_eq!(list_agents(&conn).unwrap().len(), 1);
    }

    #[test]
    fn upsert_default_recovers_via_name_when_stored_id_is_dangling() {
        let conn = conn();
        let first = upsert_default_agent(&conn, None, "anthropic", "claude-sonnet").unwrap();

        let second =
            upsert_default_agent(&conn, Some("stale-id-not-in-db"), "openai", "gpt-4o").unwrap();

        assert_eq!(first.id, second.id);
        assert_eq!(second.provider_id, "openai");
        assert_eq!(list_agents(&conn).unwrap().len(), 1);
    }
}
