//! Centralized type-safe Gate & Policy Engine for Asyar.
//!
//! Provides a fail-closed authorization engine with zero external dependencies.
//! Evaluates all privileged abilities (cloud sync egress, telemetry, AI entitlements)
//! against user authentication, subscription entitlements, and local user settings.

use crate::auth::state::AuthUser;
use serde::{Deserialize, Serialize};

/// Privileged abilities in Asyar that require policy evaluation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "kebab-case")]
pub enum Ability {
    /// Pushing or pulling data to/from cloud sync
    CloudSyncEgress,
    /// Accessing hosted advanced cloud AI models
    AiCloudModels,
    /// Synchronizing AI conversation histories
    AiConversationSync,
    /// Sending anonymous crash diagnostics
    TelemetryCrashReport,
    /// Sending anonymous usage metrics
    TelemetryUsageShare,
}

/// Structured policy evaluation errors.
#[derive(Debug, thiserror::Error, PartialEq, Eq, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum PolicyError {
    #[error("Authentication required")]
    Unauthenticated,

    #[error("Missing required entitlement: {0}")]
    MissingEntitlement(String),

    #[error("Feature is disabled in settings")]
    UserDisabled,

    #[error("Action denied: {0}")]
    Denied(String),
}

/// Evaluation context carrying active authentication and setting snapshots.
#[derive(Debug, Clone)]
pub struct PolicyContext<'a> {
    pub is_logged_in: bool,
    pub token: Option<&'a str>,
    pub user: Option<&'a AuthUser>,
    pub entitlements: &'a [String],
    pub sync_enabled: bool,
    pub crash_report_mode: &'a str,
    pub usage_share_mode: &'a str,
}

impl<'a> Default for PolicyContext<'a> {
    fn default() -> Self {
        Self {
            is_logged_in: false,
            token: None,
            user: None,
            entitlements: &[],
            sync_enabled: true,
            crash_report_mode: "off",
            usage_share_mode: "off",
        }
    }
}

/// The centralized policy gate evaluator.
pub struct Gate;

impl Gate {
    /// Evaluate whether an ability is allowed under the given context.
    /// Fails closed (returns Err) by default for unauthenticated/unauthorized states.
    pub fn evaluate(ctx: &PolicyContext<'_>, ability: Ability) -> Result<(), PolicyError> {
        match ability {
            Ability::CloudSyncEgress => {
                if !ctx.is_logged_in || ctx.token.is_none() || ctx.token.unwrap_or("").is_empty() {
                    return Err(PolicyError::Unauthenticated);
                }
                if !ctx.entitlements.iter().any(|e| e == "sync:settings") {
                    return Err(PolicyError::MissingEntitlement("sync:settings".to_string()));
                }
                if !ctx.sync_enabled {
                    return Err(PolicyError::UserDisabled);
                }
                Ok(())
            }

            Ability::AiCloudModels => {
                if !ctx.is_logged_in || ctx.token.is_none() || ctx.token.unwrap_or("").is_empty() {
                    return Err(PolicyError::Unauthenticated);
                }
                if !ctx
                    .entitlements
                    .iter()
                    .any(|e| e == "ai:advanced-models" || e == "ai:chat")
                {
                    return Err(PolicyError::MissingEntitlement(
                        "ai:advanced-models".to_string(),
                    ));
                }
                Ok(())
            }

            Ability::AiConversationSync => {
                if !ctx.is_logged_in || ctx.token.is_none() || ctx.token.unwrap_or("").is_empty() {
                    return Err(PolicyError::Unauthenticated);
                }
                if !ctx
                    .entitlements
                    .iter()
                    .any(|e| e == "sync:ai-conversations")
                {
                    return Err(PolicyError::MissingEntitlement(
                        "sync:ai-conversations".to_string(),
                    ));
                }
                if !ctx.sync_enabled {
                    return Err(PolicyError::UserDisabled);
                }
                Ok(())
            }

            Ability::TelemetryCrashReport => {
                if ctx.crash_report_mode == "off" {
                    return Err(PolicyError::UserDisabled);
                }
                Ok(())
            }

            Ability::TelemetryUsageShare => {
                if ctx.usage_share_mode == "off" {
                    return Err(PolicyError::UserDisabled);
                }
                Ok(())
            }
        }
    }

    /// Returns true if the policy allows the ability, false otherwise.
    pub fn allows(ctx: &PolicyContext<'_>, ability: Ability) -> bool {
        Self::evaluate(ctx, ability).is_ok()
    }

    /// Returns true if the policy denies the ability, false otherwise.
    pub fn denies(ctx: &PolicyContext<'_>, ability: Ability) -> bool {
        Self::evaluate(ctx, ability).is_err()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn guest_fails_closed_for_cloud_sync() {
        let ctx = PolicyContext::default();
        let result = Gate::evaluate(&ctx, Ability::CloudSyncEgress);
        assert_eq!(result, Err(PolicyError::Unauthenticated));
        assert!(Gate::denies(&ctx, Ability::CloudSyncEgress));
        assert!(!Gate::allows(&ctx, Ability::CloudSyncEgress));
    }

    #[test]
    fn cloud_sync_requires_entitlement() {
        let ctx = PolicyContext {
            is_logged_in: true,
            token: Some("valid_token"),
            entitlements: &[],
            ..Default::default()
        };

        let result = Gate::evaluate(&ctx, Ability::CloudSyncEgress);
        assert_eq!(
            result,
            Err(PolicyError::MissingEntitlement("sync:settings".into()))
        );
    }

    #[test]
    fn cloud_sync_blocked_when_user_disabled() {
        let entitlements = vec!["sync:settings".to_string()];
        let ctx = PolicyContext {
            is_logged_in: true,
            token: Some("valid_token"),
            entitlements: &entitlements,
            sync_enabled: false,
            ..Default::default()
        };

        let result = Gate::evaluate(&ctx, Ability::CloudSyncEgress);
        assert_eq!(result, Err(PolicyError::UserDisabled));
    }

    #[test]
    fn cloud_sync_allows_when_authenticated_entitled_and_enabled() {
        let entitlements = vec!["sync:settings".to_string()];
        let ctx = PolicyContext {
            is_logged_in: true,
            token: Some("valid_token"),
            entitlements: &entitlements,
            sync_enabled: true,
            ..Default::default()
        };

        assert!(Gate::allows(&ctx, Ability::CloudSyncEgress));
    }

    #[test]
    fn telemetry_crash_report_respects_setting() {
        let mut ctx = PolicyContext {
            crash_report_mode: "off",
            ..Default::default()
        };
        assert_eq!(
            Gate::evaluate(&ctx, Ability::TelemetryCrashReport),
            Err(PolicyError::UserDisabled)
        );

        ctx.crash_report_mode = "auto";
        assert!(Gate::allows(&ctx, Ability::TelemetryCrashReport));

        ctx.crash_report_mode = "ask";
        assert!(Gate::allows(&ctx, Ability::TelemetryCrashReport));
    }

    #[test]
    fn telemetry_usage_share_respects_setting() {
        let mut ctx = PolicyContext {
            usage_share_mode: "off",
            ..Default::default()
        };
        assert_eq!(
            Gate::evaluate(&ctx, Ability::TelemetryUsageShare),
            Err(PolicyError::UserDisabled)
        );

        ctx.usage_share_mode = "anonymous";
        assert!(Gate::allows(&ctx, Ability::TelemetryUsageShare));
    }
}
