use crate::browser::types::BrowserKey;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Instant;

/// Outcome of a rate-limit check. `Deny` carries a `Retry-After` hint in whole
/// seconds so the caller can advertise a backoff to a well-behaved client.
#[derive(Debug, PartialEq, Eq)]
pub enum RateDecision {
    Allow,
    Deny { retry_after_secs: u64 },
}

struct Bucket {
    tokens: f64,
    last: Instant,
}

/// Per-peer token-bucket limiter guarding the browser bridge routes. Each
/// `BrowserKey` (family + variant) gets its own bucket, so one looping or
/// malicious companion cannot starve the others. A peer may burst up to
/// `capacity` connection attempts, after which it is throttled to
/// `refill_per_sec` attempts per second.
pub struct ConnectionRateLimiter {
    capacity: f64,
    refill_per_sec: f64,
    buckets: Mutex<HashMap<BrowserKey, Bucket>>,
}

impl ConnectionRateLimiter {
    pub fn new(capacity: f64, refill_per_sec: f64) -> Self {
        Self {
            capacity,
            refill_per_sec,
            buckets: Mutex::new(HashMap::new()),
        }
    }

    /// Convenience entry point used in production: checks against the current
    /// instant. Tests use [`check_at`](Self::check_at) with a controlled clock.
    pub fn check(&self, key: &BrowserKey) -> RateDecision {
        self.check_at(key, Instant::now())
    }

    pub fn check_at(&self, key: &BrowserKey, now: Instant) -> RateDecision {
        let mut buckets = self.buckets.lock().unwrap();
        let bucket = buckets.entry(key.clone()).or_insert(Bucket {
            tokens: self.capacity,
            last: now,
        });

        // Refill by elapsed time, clamped to capacity. `saturating_duration_since`
        // guards against a `now` earlier than the last seen instant.
        let elapsed = now.saturating_duration_since(bucket.last).as_secs_f64();
        bucket.tokens = (bucket.tokens + elapsed * self.refill_per_sec).min(self.capacity);
        bucket.last = now;

        if bucket.tokens >= 1.0 {
            bucket.tokens -= 1.0;
            RateDecision::Allow
        } else {
            // Whole seconds until the bucket holds one full token again.
            let deficit = 1.0 - bucket.tokens;
            let retry_after_secs = (deficit / self.refill_per_sec).ceil() as u64;
            RateDecision::Deny {
                retry_after_secs: retry_after_secs.max(1),
            }
        }
    }
}

impl Default for ConnectionRateLimiter {
    /// Bridge default: burst of 5, then 1 attempt/sec sustained.
    fn default() -> Self {
        Self::new(5.0, 1.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::browser::types::BrowserFamily;
    use std::time::Duration;

    fn key(variant: &str) -> BrowserKey {
        BrowserKey {
            family: BrowserFamily::Chromium,
            variant: variant.to_string(),
        }
    }

    #[test]
    fn allows_up_to_capacity_then_denies() {
        let limiter = ConnectionRateLimiter::new(5.0, 1.0);
        let t0 = Instant::now();
        // First 5 attempts at the same instant all pass.
        for i in 0..5 {
            assert_eq!(
                limiter.check_at(&key("chrome"), t0),
                RateDecision::Allow,
                "attempt {i} should be allowed"
            );
        }
        // The 6th in the same window is throttled.
        assert!(matches!(
            limiter.check_at(&key("chrome"), t0),
            RateDecision::Deny { .. }
        ));
    }

    #[test]
    fn refills_over_time() {
        let limiter = ConnectionRateLimiter::new(5.0, 1.0);
        let t0 = Instant::now();
        for _ in 0..5 {
            assert_eq!(limiter.check_at(&key("chrome"), t0), RateDecision::Allow);
        }
        assert!(matches!(
            limiter.check_at(&key("chrome"), t0),
            RateDecision::Deny { .. }
        ));
        // After 2 seconds, ~2 tokens have refilled -> two more allowed.
        let t2 = t0 + Duration::from_secs(2);
        assert_eq!(limiter.check_at(&key("chrome"), t2), RateDecision::Allow);
        assert_eq!(limiter.check_at(&key("chrome"), t2), RateDecision::Allow);
        assert!(matches!(
            limiter.check_at(&key("chrome"), t2),
            RateDecision::Deny { .. }
        ));
    }

    #[test]
    fn deny_reports_nonzero_retry_after() {
        let limiter = ConnectionRateLimiter::new(2.0, 1.0);
        let t0 = Instant::now();
        let _ = limiter.check_at(&key("chrome"), t0);
        let _ = limiter.check_at(&key("chrome"), t0);
        match limiter.check_at(&key("chrome"), t0) {
            RateDecision::Deny { retry_after_secs } => assert!(retry_after_secs >= 1),
            RateDecision::Allow => panic!("expected a denial"),
        }
    }

    #[test]
    fn buckets_are_independent_per_key() {
        let limiter = ConnectionRateLimiter::new(2.0, 1.0);
        let t0 = Instant::now();
        // Exhaust chrome's bucket.
        let _ = limiter.check_at(&key("chrome"), t0);
        let _ = limiter.check_at(&key("chrome"), t0);
        assert!(matches!(
            limiter.check_at(&key("chrome"), t0),
            RateDecision::Deny { .. }
        ));
        // A different variant still has a full bucket.
        assert_eq!(limiter.check_at(&key("edge"), t0), RateDecision::Allow);
    }

    #[test]
    fn never_exceeds_capacity_after_long_idle() {
        let limiter = ConnectionRateLimiter::new(3.0, 1.0);
        let t0 = Instant::now();
        // Idle for a long time should NOT let the bucket overflow past capacity.
        let later = t0 + Duration::from_secs(3600);
        for _ in 0..3 {
            assert_eq!(limiter.check_at(&key("chrome"), later), RateDecision::Allow);
        }
        assert!(matches!(
            limiter.check_at(&key("chrome"), later),
            RateDecision::Deny { .. }
        ));
    }
}
