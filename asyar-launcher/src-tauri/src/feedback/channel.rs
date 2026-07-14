use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

const COALESCE_WINDOW_MS: u64 = 1_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FeedbackChannelLockError;

impl std::fmt::Display for FeedbackChannelLockError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("feedback channel lock poisoned")
    }
}

impl std::error::Error for FeedbackChannelLockError {}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FeedbackSeverity {
    Progress,
    Info,
    Success,
    Warning,
    Error,
    Fatal,
}

impl FeedbackSeverity {
    fn priority(self) -> u8 {
        match self {
            Self::Progress => 0,
            Self::Info | Self::Success => 1,
            Self::Warning => 2,
            Self::Error => 3,
            Self::Fatal => 4,
        }
    }

    pub fn ttl_ms(self) -> Option<u64> {
        match self {
            Self::Progress | Self::Error | Self::Fatal => None,
            Self::Info | Self::Success => Some(3_000),
            Self::Warning => Some(8_000),
        }
    }

    fn is_transient(self) -> bool {
        matches!(self, Self::Info | Self::Success)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FeedbackSource {
    Rust,
    Frontend,
    Extension,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackProgress {
    pub title: String,
    pub completed: Option<u64>,
    pub total: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackItem {
    pub id: String,
    pub source: FeedbackSource,
    pub kind: String,
    pub severity: FeedbackSeverity,
    pub retryable: bool,
    #[serde(default)]
    pub context: HashMap<String, String>,
    pub developer_detail: Option<String>,
    pub extension_id: Option<String>,
    pub retry_action_id: Option<String>,
    pub report_action_id: Option<String>,
    pub progress: Option<FeedbackProgress>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackDraft {
    pub source: FeedbackSource,
    pub kind: String,
    pub severity: FeedbackSeverity,
    pub retryable: bool,
    #[serde(default)]
    pub context: HashMap<String, String>,
    pub developer_detail: Option<String>,
    pub extension_id: Option<String>,
    pub retry_action_id: Option<String>,
    pub report_action_id: Option<String>,
    pub progress: Option<FeedbackProgress>,
}

impl FeedbackDraft {
    fn into_item(self, id: String) -> FeedbackItem {
        FeedbackItem {
            id,
            source: self.source,
            kind: self.kind,
            severity: self.severity,
            retryable: self.retryable,
            context: self.context,
            developer_detail: self.developer_detail,
            extension_id: self.extension_id,
            retry_action_id: self.retry_action_id,
            report_action_id: self.report_action_id,
            progress: self.progress,
        }
    }
}

#[derive(Debug, Default)]
pub struct FeedbackChannel {
    current: Option<FeedbackItem>,
    queued: VecDeque<FeedbackItem>,
    last_transient_at: HashMap<String, u64>,
    announcers_seen: HashSet<String>,
}

impl FeedbackChannel {
    pub fn current(&self) -> Option<&FeedbackItem> {
        self.current.as_ref()
    }

    pub fn queued_len(&self) -> usize {
        self.queued.len()
    }

    pub fn publish(&mut self, item: FeedbackItem, now_ms: u64) {
        if item.severity.is_transient() {
            let key = format!("{:?}:{}", item.source, item.kind);
            if self
                .last_transient_at
                .get(&key)
                .is_some_and(|previous| now_ms.saturating_sub(*previous) < COALESCE_WINDOW_MS)
            {
                return;
            }
            self.last_transient_at.insert(key, now_ms);
        }

        let Some(current) = self.current.as_ref() else {
            self.current = Some(item);
            return;
        };

        if item.severity.priority() > current.severity.priority() {
            if let Some(displaced) = self.current.replace(item) {
                self.queued.push_front(displaced);
            }
        } else {
            let position = self
                .queued
                .iter()
                .position(|queued| item.severity.priority() > queued.severity.priority())
                .unwrap_or(self.queued.len());
            self.queued.insert(position, item);
        }
    }

    pub fn dismiss(&mut self, id: &str) {
        if self.current.as_ref().is_some_and(|item| item.id == id) {
            self.current = self.queued.pop_front();
            return;
        }
        self.queued.retain(|item| item.id != id);
    }

    pub fn replace(&mut self, item: FeedbackItem) -> bool {
        if self
            .current
            .as_ref()
            .is_some_and(|current| current.id == item.id)
        {
            self.current = Some(item);
            return true;
        }
        if let Some(queued) = self.queued.iter_mut().find(|queued| queued.id == item.id) {
            *queued = item;
            return true;
        }
        false
    }

    /// Remove the item from its current slot (current or queue) and re-insert it
    /// using the full priority-displacement logic, without the transient coalescing
    /// guard. Use this when an item's severity changes after it was admitted.
    pub fn replace_sorted(&mut self, item: FeedbackItem) -> bool {
        let id = item.id.clone();
        let was_current = self.current.as_ref().is_some_and(|c| c.id == id);
        if was_current {
            self.current = self.queued.pop_front();
        } else if self.queued.iter().any(|q| q.id == id) {
            self.queued.retain(|q| q.id != id);
        } else {
            return false;
        }
        let Some(current) = self.current.as_ref() else {
            self.current = Some(item);
            return true;
        };
        if item.severity.priority() > current.severity.priority() {
            if let Some(displaced) = self.current.replace(item) {
                self.queued.push_front(displaced);
            }
        } else {
            let position = self
                .queued
                .iter()
                .position(|q| item.severity.priority() > q.severity.priority())
                .unwrap_or(self.queued.len());
            self.queued.insert(position, item);
        }
        true
    }

    pub fn accept_announcement(&mut self, extension_id: &str, _announcement_id: &str) -> bool {
        self.announcers_seen.insert(extension_id.to_string())
    }
}

#[derive(Debug, Default)]
pub struct FeedbackChannelState {
    channel: Mutex<FeedbackChannel>,
    next_id: AtomicU64,
}

impl FeedbackChannelState {
    pub fn publish(
        &self,
        draft: FeedbackDraft,
        now_ms: u64,
    ) -> Result<String, FeedbackChannelLockError> {
        let id = format!(
            "feedback-{}",
            self.next_id.fetch_add(1, Ordering::Relaxed) + 1
        );
        self.channel
            .lock()
            .map_err(|_| FeedbackChannelLockError)?
            .publish(draft.into_item(id.clone()), now_ms);
        Ok(id)
    }

    pub fn current(&self) -> Result<Option<FeedbackItem>, FeedbackChannelLockError> {
        Ok(self
            .channel
            .lock()
            .map_err(|_| FeedbackChannelLockError)?
            .current()
            .cloned())
    }

    pub fn dismiss(&self, id: &str) -> Result<(), FeedbackChannelLockError> {
        self.channel
            .lock()
            .map_err(|_| FeedbackChannelLockError)?
            .dismiss(id);
        Ok(())
    }

    pub fn update_progress(
        &self,
        id: &str,
        expected_extension_id: Option<&str>,
        progress: FeedbackProgress,
    ) -> Result<bool, FeedbackChannelLockError> {
        let mut channel = self.channel.lock().map_err(|_| FeedbackChannelLockError)?;
        let Some(mut item) = channel
            .current()
            .filter(|item| item.id == id)
            .cloned()
            .or_else(|| channel.queued.iter().find(|item| item.id == id).cloned())
        else {
            return Ok(false);
        };
        if expected_extension_id
            .is_some_and(|expected| item.extension_id.as_deref() != Some(expected))
        {
            return Ok(false);
        }
        item.progress = Some(progress);
        Ok(channel.replace(item))
    }

    pub fn finish_progress(
        &self,
        id: &str,
        expected_extension_id: Option<&str>,
        severity: FeedbackSeverity,
        title: String,
        developer_detail: Option<String>,
    ) -> Result<bool, FeedbackChannelLockError> {
        let mut channel = self.channel.lock().map_err(|_| FeedbackChannelLockError)?;
        let Some(mut item) = channel
            .current()
            .filter(|item| item.id == id)
            .cloned()
            .or_else(|| channel.queued.iter().find(|item| item.id == id).cloned())
        else {
            return Ok(false);
        };
        if expected_extension_id
            .is_some_and(|expected| item.extension_id.as_deref() != Some(expected))
        {
            return Ok(false);
        }
        item.severity = severity;
        item.developer_detail = developer_detail;
        item.progress = None;
        item.context.insert("message".into(), title);
        Ok(channel.replace_sorted(item))
    }

    pub fn accept_announcement(
        &self,
        extension_id: &str,
        announcement_id: &str,
    ) -> Result<bool, FeedbackChannelLockError> {
        Ok(self
            .channel
            .lock()
            .map_err(|_| FeedbackChannelLockError)?
            .accept_announcement(extension_id, announcement_id))
    }

    pub fn dismiss_owned(
        &self,
        id: &str,
        expected_extension_id: Option<&str>,
    ) -> Result<bool, FeedbackChannelLockError> {
        let mut channel = self.channel.lock().map_err(|_| FeedbackChannelLockError)?;
        let owner = channel
            .current()
            .filter(|item| item.id == id)
            .and_then(|item| item.extension_id.as_deref())
            .or_else(|| {
                channel
                    .queued
                    .iter()
                    .find(|item| item.id == id)
                    .and_then(|item| item.extension_id.as_deref())
            });
        if expected_extension_id.is_some_and(|expected| owner != Some(expected)) {
            return Ok(false);
        }
        channel.dismiss(id);
        Ok(true)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(id: &str, severity: FeedbackSeverity) -> FeedbackItem {
        FeedbackItem {
            id: id.into(),
            source: FeedbackSource::Frontend,
            kind: "manual".into(),
            severity,
            retryable: false,
            context: Default::default(),
            developer_detail: None,
            extension_id: None,
            retry_action_id: None,
            report_action_id: None,
            progress: None,
        }
    }

    #[test]
    fn sticky_errors_are_not_replaced_by_lower_priority_feedback() {
        let mut channel = FeedbackChannel::default();
        channel.publish(item("error", FeedbackSeverity::Error), 0);
        channel.publish(item("info", FeedbackSeverity::Info), 1);

        assert_eq!(
            channel.current().map(|item| item.id.as_str()),
            Some("error")
        );
        assert_eq!(channel.queued_len(), 1);
    }

    #[test]
    fn dismissing_current_feedback_promotes_the_next_item() {
        let mut channel = FeedbackChannel::default();
        channel.publish(item("error", FeedbackSeverity::Error), 0);
        channel.publish(item("warning", FeedbackSeverity::Warning), 1);

        channel.dismiss("error");

        assert_eq!(
            channel.current().map(|item| item.id.as_str()),
            Some("warning")
        );
    }

    #[test]
    fn queued_feedback_is_promoted_by_priority() {
        let mut channel = FeedbackChannel::default();
        channel.publish(item("error", FeedbackSeverity::Error), 0);
        channel.publish(item("info", FeedbackSeverity::Info), 1);
        channel.publish(item("warning", FeedbackSeverity::Warning), 2);

        channel.dismiss("error");

        assert_eq!(
            channel.current().map(|item| item.id.as_str()),
            Some("warning")
        );
    }

    #[test]
    fn repeated_transient_feedback_is_coalesced() {
        let mut channel = FeedbackChannel::default();
        channel.publish(item("first", FeedbackSeverity::Info), 0);
        channel.publish(item("second", FeedbackSeverity::Info), 500);

        assert_eq!(
            channel.current().map(|item| item.id.as_str()),
            Some("first")
        );
        assert_eq!(channel.queued_len(), 0);
    }

    #[test]
    fn extensions_can_announce_only_once_per_session() {
        let mut channel = FeedbackChannel::default();

        assert!(channel.accept_announcement("extension.test", "whats-new"));
        assert!(!channel.accept_announcement("extension.test", "whats-new"));
        assert!(!channel.accept_announcement("extension.test", "next-release"));
        assert!(channel.accept_announcement("extension.other", "whats-new"));
    }

    #[test]
    fn extensions_cannot_mutate_another_extensions_progress() {
        let state = FeedbackChannelState::default();
        let id = state
            .publish(
                FeedbackDraft {
                    source: FeedbackSource::Extension,
                    kind: "progress".into(),
                    severity: FeedbackSeverity::Progress,
                    retryable: false,
                    context: Default::default(),
                    developer_detail: None,
                    extension_id: Some("extension.owner".into()),
                    retry_action_id: None,
                    report_action_id: None,
                    progress: Some(FeedbackProgress {
                        title: "Working".into(),
                        completed: None,
                        total: None,
                    }),
                },
                0,
            )
            .unwrap();

        assert!(!state
            .update_progress(
                &id,
                Some("extension.other"),
                FeedbackProgress {
                    title: "Hijacked".into(),
                    completed: None,
                    total: None,
                },
            )
            .unwrap());
        assert_eq!(
            state
                .current()
                .unwrap()
                .and_then(|item| item.progress)
                .map(|progress| progress.title),
            Some("Working".into())
        );
    }

    #[test]
    fn severities_serialize_for_the_frontend_contract() {
        assert_eq!(
            serde_json::to_value(FeedbackSeverity::Progress).unwrap(),
            serde_json::json!("progress")
        );
        assert_eq!(
            serde_json::to_value(FeedbackSeverity::Fatal).unwrap(),
            serde_json::json!("fatal")
        );
    }

    #[test]
    fn queued_item_escalating_severity_displaces_lower_priority_current() {
        let mut channel = FeedbackChannel::default();
        // "warning" is current; "progress" is queued behind it.
        channel.publish(item("warning", FeedbackSeverity::Warning), 0);
        channel.publish(item("progress", FeedbackSeverity::Progress), 1);

        assert_eq!(channel.current().map(|i| i.id.as_str()), Some("warning"));
        assert_eq!(channel.queued_len(), 1);

        // "progress" finishes and escalates to Fatal — must displace "warning".
        let mut escalated = item("progress", FeedbackSeverity::Fatal);
        escalated.progress = None;
        let replaced = channel.replace_sorted(escalated);

        assert!(replaced);
        assert_eq!(channel.current().map(|i| i.id.as_str()), Some("progress"));
        assert_eq!(channel.queued_len(), 1);
        assert_eq!(
            channel.queued.front().map(|i| i.id.as_str()),
            Some("warning")
        );
    }

    #[test]
    fn replace_sorted_returns_false_for_unknown_id() {
        let mut channel = FeedbackChannel::default();
        channel.publish(item("a", FeedbackSeverity::Info), 0);

        assert!(!channel.replace_sorted(item("unknown", FeedbackSeverity::Fatal)));
        assert_eq!(channel.current().map(|i| i.id.as_str()), Some("a"));
    }
}
