use std::collections::VecDeque;
use std::fmt;
use std::sync::{Arc, Mutex, MutexGuard};

const MAX_PENDING_ACTIONS: usize = 64;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum LauncherAction {
    Toggle,
    Show,
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum CoordinatorError {
    AlreadyAttached,
    NotAttached,
    QueueFull,
    Schedule(String),
}

impl fmt::Display for CoordinatorError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::AlreadyAttached => write!(formatter, "launcher coordinator already attached"),
            Self::NotAttached => write!(formatter, "launcher coordinator is not attached"),
            Self::QueueFull => write!(formatter, "launcher coordinator queue is full"),
            Self::Schedule(error) => {
                write!(formatter, "failed to schedule launcher action: {error}")
            }
        }
    }
}

trait LauncherBackend: Send + Sync + 'static {
    fn schedule(&self, task: Box<dyn FnOnce() + Send>) -> Result<(), String>;
    fn execute(&self, action: LauncherAction);
}

struct TauriLauncherBackend {
    app: tauri::AppHandle,
}

impl LauncherBackend for TauriLauncherBackend {
    fn schedule(&self, task: Box<dyn FnOnce() + Send>) -> Result<(), String> {
        self.app
            .run_on_main_thread(task)
            .map_err(|error| error.to_string())
    }

    fn execute(&self, action: LauncherAction) {
        match action {
            LauncherAction::Toggle => crate::commands::toggle_launcher(&self.app),
            LauncherAction::Show => crate::commands::shortcuts::show_spotlight_launcher(&self.app),
        }
    }
}

#[derive(Default)]
struct CoordinatorState {
    backend: Option<Arc<dyn LauncherBackend>>,
    ready: bool,
    drain_scheduled: bool,
    pending: VecDeque<LauncherAction>,
}

pub(crate) struct LauncherCoordinator {
    state: Mutex<CoordinatorState>,
}

impl Default for LauncherCoordinator {
    fn default() -> Self {
        Self::new()
    }
}

impl LauncherCoordinator {
    pub(crate) fn new() -> Self {
        Self {
            state: Mutex::new(CoordinatorState::default()),
        }
    }

    pub(crate) fn attach_app(
        self: &Arc<Self>,
        app: tauri::AppHandle,
    ) -> Result<(), CoordinatorError> {
        self.attach_backend(Arc::new(TauriLauncherBackend { app }))
    }

    pub(crate) fn request(
        self: &Arc<Self>,
        action: LauncherAction,
    ) -> Result<(), CoordinatorError> {
        {
            let mut state = self.lock_state();
            if state.pending.len() >= MAX_PENDING_ACTIONS {
                log::warn!("[launcher] dropping {action:?}: coordinator queue is full");
                return Err(CoordinatorError::QueueFull);
            }
            state.pending.push_back(action);
        }

        self.schedule_drain_if_needed()
    }

    pub(crate) fn mark_ready(self: &Arc<Self>) -> Result<(), CoordinatorError> {
        {
            let mut state = self.lock_state();
            state.ready = true;
        }
        self.schedule_drain_if_needed()
    }

    fn attach_backend(
        self: &Arc<Self>,
        backend: Arc<dyn LauncherBackend>,
    ) -> Result<(), CoordinatorError> {
        {
            let mut state = self.lock_state();
            if state.backend.is_some() {
                return Err(CoordinatorError::AlreadyAttached);
            }
            state.backend = Some(backend);
        }
        self.schedule_drain_if_needed()
    }

    fn schedule_drain_if_needed(self: &Arc<Self>) -> Result<(), CoordinatorError> {
        let backend = {
            let mut state = self.lock_state();
            if !state.ready || state.pending.is_empty() || state.drain_scheduled {
                return Ok(());
            }
            let backend = state.backend.clone().ok_or(CoordinatorError::NotAttached)?;
            state.drain_scheduled = true;
            backend
        };

        let coordinator = self.clone();
        if let Err(error) = backend.schedule(Box::new(move || coordinator.drain())) {
            self.clear_scheduled_flag();
            log::warn!("[launcher] failed to schedule coordinator drain: {error}");
            return Err(CoordinatorError::Schedule(error));
        }

        Ok(())
    }

    fn clear_scheduled_flag(&self) {
        let mut state = self.lock_state();
        state.drain_scheduled = false;
    }

    fn drain(self: &Arc<Self>) {
        let backend = {
            let state = self.lock_state();
            state
                .backend
                .clone()
                .expect("scheduled launcher drain must have an attached backend")
        };

        loop {
            let action = {
                let mut state = self.lock_state();
                match state.pending.pop_front() {
                    Some(action) => action,
                    None => {
                        state.drain_scheduled = false;
                        return;
                    }
                }
            };

            backend.execute(action);
        }
    }

    fn lock_state(&self) -> MutexGuard<'_, CoordinatorState> {
        self.state
            .lock()
            .expect("launcher coordinator state mutex poisoned")
    }

    #[cfg(test)]
    pub(crate) fn pending_actions(&self) -> Vec<LauncherAction> {
        self.lock_state().pending.iter().copied().collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    #[derive(Default)]
    struct FakeBackend {
        executed: Mutex<Vec<LauncherAction>>,
        scheduled: Mutex<Vec<Box<dyn FnOnce() + Send>>>,
        during_execute: Mutex<Option<Box<dyn FnOnce() + Send>>>,
        schedule_failures: Mutex<usize>,
    }

    impl FakeBackend {
        fn run_next(&self) {
            let task = self.scheduled.lock().unwrap().remove(0);
            task();
        }

        fn scheduled_count(&self) -> usize {
            self.scheduled.lock().unwrap().len()
        }

        fn executed(&self) -> Vec<LauncherAction> {
            self.executed.lock().unwrap().clone()
        }

        fn fail_next_schedule(&self) {
            *self.schedule_failures.lock().unwrap() += 1;
        }
    }

    impl LauncherBackend for FakeBackend {
        fn schedule(&self, task: Box<dyn FnOnce() + Send>) -> Result<(), String> {
            let mut failures = self.schedule_failures.lock().unwrap();
            if *failures > 0 {
                *failures -= 1;
                return Err("test scheduling failure".to_string());
            }
            drop(failures);
            self.scheduled.lock().unwrap().push(task);
            Ok(())
        }

        fn execute(&self, action: LauncherAction) {
            self.executed.lock().unwrap().push(action);
            if let Some(callback) = self.during_execute.lock().unwrap().take() {
                callback();
            }
        }
    }

    fn attached() -> (Arc<LauncherCoordinator>, Arc<FakeBackend>) {
        let coordinator = Arc::new(LauncherCoordinator::new());
        let backend = Arc::new(FakeBackend::default());
        coordinator.attach_backend(backend.clone()).unwrap();
        (coordinator, backend)
    }

    #[test]
    fn toggle_before_readiness_is_queued_and_mark_ready_drains_it() {
        let (coordinator, backend) = attached();
        coordinator.request(LauncherAction::Toggle).unwrap();
        assert_eq!(backend.scheduled_count(), 0);

        coordinator.mark_ready().unwrap();
        assert_eq!(backend.scheduled_count(), 1);
        backend.run_next();
        assert_eq!(backend.executed(), vec![LauncherAction::Toggle]);
    }

    #[test]
    fn ready_toggle_is_scheduled() {
        let (coordinator, backend) = attached();
        coordinator.mark_ready().unwrap();
        coordinator.request(LauncherAction::Toggle).unwrap();
        assert_eq!(backend.scheduled_count(), 1);
        backend.run_next();
        assert_eq!(backend.executed(), vec![LauncherAction::Toggle]);
    }

    #[test]
    fn actions_preserve_fifo_order() {
        let (coordinator, backend) = attached();
        coordinator.request(LauncherAction::Show).unwrap();
        coordinator.request(LauncherAction::Toggle).unwrap();
        coordinator.request(LauncherAction::Show).unwrap();
        coordinator.mark_ready().unwrap();
        backend.run_next();
        assert_eq!(
            backend.executed(),
            vec![
                LauncherAction::Show,
                LauncherAction::Toggle,
                LauncherAction::Show
            ]
        );
    }

    #[test]
    fn repeated_show_requests_preserve_order() {
        let (coordinator, backend) = attached();
        coordinator.request(LauncherAction::Show).unwrap();
        coordinator.request(LauncherAction::Show).unwrap();
        coordinator.mark_ready().unwrap();
        backend.run_next();
        assert_eq!(
            backend.executed(),
            vec![LauncherAction::Show, LauncherAction::Show]
        );
    }

    #[test]
    fn show_then_toggle_preserves_order() {
        let (coordinator, backend) = attached();
        coordinator.request(LauncherAction::Show).unwrap();
        coordinator.request(LauncherAction::Toggle).unwrap();
        coordinator.mark_ready().unwrap();
        backend.run_next();
        assert_eq!(
            backend.executed(),
            vec![LauncherAction::Show, LauncherAction::Toggle]
        );
    }

    #[test]
    fn action_added_during_drain_is_not_lost() {
        let (coordinator, backend) = attached();
        let during_drain = coordinator.clone();
        *backend.during_execute.lock().unwrap() = Some(Box::new(move || {
            during_drain.request(LauncherAction::Show).unwrap();
        }));

        coordinator.mark_ready().unwrap();
        coordinator.request(LauncherAction::Toggle).unwrap();
        backend.run_next();
        assert_eq!(
            backend.executed(),
            vec![LauncherAction::Toggle, LauncherAction::Show]
        );
    }

    #[test]
    fn one_drain_is_scheduled_for_multiple_ready_requests() {
        let (coordinator, backend) = attached();
        coordinator.mark_ready().unwrap();
        coordinator.request(LauncherAction::Toggle).unwrap();
        coordinator.request(LauncherAction::Show).unwrap();
        assert_eq!(backend.scheduled_count(), 1);
        backend.run_next();
        assert_eq!(
            backend.executed(),
            vec![LauncherAction::Toggle, LauncherAction::Show]
        );
    }

    #[test]
    fn ready_pending_work_is_scheduled_when_backend_attaches() {
        let coordinator = Arc::new(LauncherCoordinator::new());
        coordinator.mark_ready().unwrap();
        assert_eq!(
            coordinator.request(LauncherAction::Toggle),
            Err(CoordinatorError::NotAttached)
        );

        let backend = Arc::new(FakeBackend::default());
        coordinator.attach_backend(backend.clone()).unwrap();
        assert_eq!(backend.scheduled_count(), 1);
        backend.run_next();
        assert_eq!(backend.executed(), vec![LauncherAction::Toggle]);
    }

    #[test]
    fn scheduling_failure_keeps_actions_queued_for_a_later_request() {
        let (coordinator, backend) = attached();
        coordinator.mark_ready().unwrap();
        backend.fail_next_schedule();

        assert_eq!(
            coordinator.request(LauncherAction::Show),
            Err(CoordinatorError::Schedule(
                "test scheduling failure".to_string()
            ))
        );
        assert_eq!(backend.scheduled_count(), 0);

        coordinator.request(LauncherAction::Toggle).unwrap();
        assert_eq!(backend.scheduled_count(), 1);
        backend.run_next();
        assert_eq!(
            backend.executed(),
            vec![LauncherAction::Show, LauncherAction::Toggle]
        );
    }

    #[test]
    fn queue_overflow_preserves_existing_actions_and_remains_coherent() {
        let (coordinator, backend) = attached();
        for _ in 0..MAX_PENDING_ACTIONS {
            coordinator.request(LauncherAction::Show).unwrap();
        }

        assert_eq!(
            coordinator.request(LauncherAction::Toggle),
            Err(CoordinatorError::QueueFull)
        );
        coordinator.mark_ready().unwrap();
        backend.run_next();
        assert_eq!(
            backend.executed(),
            vec![LauncherAction::Show; MAX_PENDING_ACTIONS]
        );
    }
}
