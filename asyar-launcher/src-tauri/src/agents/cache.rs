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
        cache
            .entry(agent_id.to_string())
            .or_insert_with(HashMap::new)
            .insert(input.to_string(), output.to_string());
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
