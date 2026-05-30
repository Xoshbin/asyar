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

/// Hard ceiling on the number of live buckets, as a backstop against a flood of
/// unique `variant`s (which come from client-controlled query input). Pruning
/// keeps the map far below this in practice; the cap only bites under a genuine
/// flood of simultaneously-throttled peers — astronomically unlikely on a
/// loopback bridge, but it guarantees the map can never grow without bound.
const DEFAULT_MAX_BUCKETS: usize = 1024;

/// Per-peer token-bucket limiter guarding the browser bridge routes. Each
/// `BrowserKey` (family + variant) gets its own bucket, so one looping or
/// malicious companion cannot starve the others. A peer may burst up to
/// `capacity` connection attempts, after which it is throttled to
/// `refill_per_sec` attempts per second.
pub struct ConnectionRateLimiter {
    capacity: f64,
    refill_per_sec: f64,
    max_buckets: usize,
    buckets: Mutex<HashMap<BrowserKey, Bucket>>,
}

impl ConnectionRateLimiter {
    pub fn new(capacity: f64, refill_per_sec: f64) -> Self {
        Self {
            capacity,
            refill_per_sec,
            max_buckets: DEFAULT_MAX_BUCKETS,
            buckets: Mutex::new(HashMap::new()),
        }
    }

    /// Override the bucket ceiling (mainly for tests).
    pub fn with_max_buckets(mut self, max_buckets: usize) -> Self {
        self.max_buckets = max_buckets;
        self
    }

    /// Number of live buckets — used by tests to assert memory stays bounded.
    pub fn bucket_count(&self) -> usize {
        self.buckets.lock().unwrap().len()
    }

    /// Convenience entry point used in production: checks against the current
    /// instant. Tests use [`check_at`](Self::check_at) with a controlled clock.
    pub fn check(&self, key: &BrowserKey) -> RateDecision {
        self.check_at(key, Instant::now())
    }

    pub fn check_at(&self, key: &BrowserKey, now: Instant) -> RateDecision {
        let mut buckets = self.buckets.lock().unwrap();

        // Drop stranger buckets that have refilled to full capacity: such a
        // bucket is indistinguishable from a never-seen key, so removing it is a
        // no-op for legitimate peers while bounding memory to currently-throttled
        // ones. This is what neutralizes a flood of unique client `variant`s
        // without the permanent lockout a plain hard cap would cause.
        let capacity = self.capacity;
        let refill = self.refill_per_sec;
        buckets.retain(|k, b| {
            k == key
                || (b.tokens + now.saturating_duration_since(b.last).as_secs_f64() * refill)
                    < capacity
        });

        // Backstop: if even after pruning we are at the ceiling and this is a new
        // key, shed it before allocating a bucket (and before any auth/keychain
        // work downstream) rather than grow unbounded.
        if buckets.len() >= self.max_buckets && !buckets.contains_key(key) {
            return RateDecision::Deny {
                retry_after_secs: 60,
            };
        }

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

    #[test]
    fn prunes_fully_refilled_buckets_of_other_keys() {
        let limiter = ConnectionRateLimiter::new(5.0, 1.0);
        let t0 = Instant::now();
        // A flood of unique variants (the DoS vector: `variant` is client input).
        for i in 0..100 {
            let _ = limiter.check_at(&key(&format!("v{i}")), t0);
        }
        assert_eq!(
            limiter.bucket_count(),
            100,
            "each unique key holds a bucket"
        );
        // After enough time for every stranger bucket to refill to full, a check
        // for a NEW key drops them — a fully-refilled bucket carries no state, so
        // pruning it changes nothing for a real peer but bounds memory.
        let later = t0 + Duration::from_secs(10);
        let _ = limiter.check_at(&key("fresh"), later);
        assert_eq!(
            limiter.bucket_count(),
            1,
            "fully-refilled stranger buckets must be pruned"
        );
    }

    #[test]
    fn enforces_max_buckets_ceiling_for_new_keys() {
        let limiter = ConnectionRateLimiter::new(5.0, 1.0).with_max_buckets(3);
        let t0 = Instant::now();
        for i in 0..3 {
            assert_eq!(
                limiter.check_at(&key(&format!("v{i}")), t0),
                RateDecision::Allow
            );
        }
        // 4th distinct key at the same instant: nothing has refilled, so pruning
        // keeps all 3 and the ceiling sheds the newcomer before it allocates.
        assert!(matches!(
            limiter.check_at(&key("v3"), t0),
            RateDecision::Deny { .. }
        ));
        assert_eq!(limiter.bucket_count(), 3, "ceiling caps the map size");
    }

    #[test]
    fn ceiling_never_blocks_an_already_tracked_key() {
        let limiter = ConnectionRateLimiter::new(5.0, 1.0).with_max_buckets(2);
        let t0 = Instant::now();
        let _ = limiter.check_at(&key("a"), t0);
        let _ = limiter.check_at(&key("b"), t0);
        // A brand-new key is shed by the ceiling...
        assert!(matches!(
            limiter.check_at(&key("c"), t0),
            RateDecision::Deny { .. }
        ));
        // ...but a peer we are already tracking is never locked out.
        assert_eq!(limiter.check_at(&key("a"), t0), RateDecision::Allow);
    }
}
