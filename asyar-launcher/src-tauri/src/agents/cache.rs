use std::collections::HashMap;
use std::sync::Mutex;

pub struct AgentResponseCache {
    // Maps agent_id -> Maps user_text -> response_text
    cache: Mutex<HashMap<String, HashMap<String, String>>>,
}

impl Default for AgentResponseCache {
    fn default() -> Self {
        Self {
            cache: Mutex::new(HashMap::new()),
        }
    }
}

impl AgentResponseCache {
    pub fn get(&self, agent_id: &str, input: &str) -> Option<String> {
        let cache = self.cache.lock().unwrap();
        cache.get(agent_id).and_then(|m| m.get(input).cloned())
    }

    pub fn set(&self, agent_id: &str, input: &str, output: &str) {
        let mut cache = self.cache.lock().unwrap();
        let inner = cache.entry(agent_id.to_string()).or_default();
        inner.insert(input.to_string(), output.to_string());

        // Cap cache at 256 entries per agent to prevent unbounded memory growth
        if inner.len() > 256 {
            if let Some(key) = inner.keys().next().cloned() {
                inner.remove(&key);
            }
        }
    }

    pub fn list(&self, agent_id: &str) -> Vec<(String, String)> {
        let cache = self.cache.lock().unwrap();
        if let Some(m) = cache.get(agent_id) {
            m.iter().map(|(k, v)| (k.clone(), v.clone())).collect()
        } else {
            Vec::new()
        }
    }

    pub fn forget(&self, agent_id: &str, input: &str) {
        let mut cache = self.cache.lock().unwrap();
        if let Some(m) = cache.get_mut(agent_id) {
            m.remove(input);
        }
    }

    pub fn clear(&self, agent_id: &str) {
        let mut cache = self.cache.lock().unwrap();
        if let Some(m) = cache.get_mut(agent_id) {
            m.clear();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cache_eviction() {
        let cache = AgentResponseCache::default();
        let agent = "test-agent";

        // Insert 260 items (exceeding capacity of 256)
        for i in 0..260 {
            cache.set(agent, &format!("input_{}", i), &format!("output_{}", i));
        }

        // Cache size must be capped at 256
        let items = cache.list(agent);
        assert_eq!(items.len(), 256);
    }
}
