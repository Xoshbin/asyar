use super::context::ContextMachine;
use super::types::*;
use proptest::prelude::*;
use std::time::{Duration, Instant};

#[derive(Debug, Clone)]
enum Op {
    Enqueue { ext: u8, user_facing: bool },
    ReadyAck { ext: u8, correct_token: bool },
    Timeout { ext: u8 },
    Tick { advance_ms: u32 },
    Remove { ext: u8 },
}

fn op_strategy() -> impl Strategy<Value = Op> {
    prop_oneof![
        (0u8..3u8, any::<bool>()).prop_map(|(ext, uf)| Op::Enqueue { ext, user_facing: uf }),
        (0u8..3u8, any::<bool>()).prop_map(|(ext, ok)| Op::ReadyAck { ext, correct_token: ok }),
        (0u8..3u8).prop_map(|ext| Op::Timeout { ext }),
        (0u32..10_000u32).prop_map(|advance_ms| Op::Tick { advance_ms }),
        (0u8..3u8).prop_map(|ext| Op::Remove { ext }),
    ]
}

fn run_invariants(mut machine: ContextMachine, ops: Vec<Op>) -> Result<(), TestCaseError> {
    let mut now = Instant::now();
    let mut last_token: std::collections::HashMap<u8, u64> = Default::default();
    let mut highest_token: u64 = 0;

    for op in ops {
        match op {
            Op::Enqueue { ext, user_facing } => {
                let key = format!("ext.{ext}");
                let src = if user_facing {
                    TriggerSource::Search
                } else {
                    TriggerSource::Timer
                };
                let outcome = machine.enqueue(
                    &key,
                    PendingMessage {
                        kind: MessageKind::Command,
                        payload: serde_json::json!({}),
                        enqueued_at: now,
                        source: src,
                    },
                    now,
                );
                if let DispatchOutcome::NeedsMount { mount_token } = outcome {
                    last_token.insert(ext, mount_token);
                    prop_assert!(mount_token > highest_token);
                    highest_token = mount_token;
                }
            }
            Op::ReadyAck { ext, correct_token } => {
                let key = format!("ext.{ext}");
                let token = if correct_token {
                    *last_token.get(&ext).unwrap_or(&0)
                } else {
                    999_999
                };
                machine.on_ready_ack(&key, token, now);
            }
            Op::Timeout { ext } => {
                let key = format!("ext.{ext}");
                let token = *last_token.get(&ext).unwrap_or(&0);
                machine.on_mount_timeout(&key, token, now);
            }
            Op::Tick { advance_ms } => {
                now += Duration::from_millis(advance_ms as u64);
                machine.tick(now);
            }
            Op::Remove { ext } => {
                let key = format!("ext.{ext}");
                machine.on_extension_removed(&key);
            }
        }

        // Invariant: mailbox non-empty implies state is Mounting
        for ext in 0..3u8 {
            let key = format!("ext.{ext}");
            let has_mail = machine.mailbox_len(&key) > 0;
            if has_mail {
                let is_mounting =
                    matches!(machine.state(&key), Some(LifecycleState::Mounting { .. }));
                prop_assert!(is_mounting);
            }
        }
    }
    Ok(())
}

proptest! {
    #[test]
    fn worker_invariants_hold_for_any_op_sequence(
        ops in prop::collection::vec(op_strategy(), 0..60)
    ) {
        let cfg = ContextConfig {
            keep_alive: None,
            mount_timeout: Duration::from_secs(3),
            strike_window: Duration::from_secs(300),
            strike_threshold: 3,
            degraded_cooldown: Duration::from_secs(3600),
            tick_interval: Duration::from_secs(1),
        };
        run_invariants(ContextMachine::new(cfg, ContextRole::Worker), ops)?;
    }

    #[test]
    fn view_invariants_hold_for_any_op_sequence(
        ops in prop::collection::vec(op_strategy(), 0..60)
    ) {
        let cfg = ContextConfig {
            keep_alive: Some(Duration::from_secs(120)),
            mount_timeout: Duration::from_secs(3),
            strike_window: Duration::from_secs(300),
            strike_threshold: 3,
            degraded_cooldown: Duration::from_secs(3600),
            tick_interval: Duration::from_secs(1),
        };
        run_invariants(ContextMachine::new(cfg, ContextRole::View), ops)?;
    }
}
