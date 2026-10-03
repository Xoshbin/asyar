use std::sync::Arc;

use crate::launcher::{LauncherAction, LauncherCoordinator};
pub use asyar_platform::linux::launcher_dbus::{
    LauncherAction as PlatformLauncherAction, LauncherActionHandler, LauncherDbusError,
    LauncherDbusService,
};

struct CoordinatorHandler {
    coordinator: Arc<LauncherCoordinator>,
}

impl LauncherActionHandler for CoordinatorHandler {
    fn handle_action(&self, action: PlatformLauncherAction) -> Result<(), String> {
        let app_action = match action {
            PlatformLauncherAction::Toggle => LauncherAction::Toggle,
            PlatformLauncherAction::Show => LauncherAction::Show,
        };
        self.coordinator
            .request(app_action)
            .map_err(|e| e.to_string())
    }
}

pub(crate) fn start(
    identifier: &str,
    coordinator: &Arc<LauncherCoordinator>,
) -> Result<LauncherDbusService, LauncherDbusError> {
    let handler: Arc<dyn LauncherActionHandler> = Arc::new(CoordinatorHandler {
        coordinator: Arc::clone(coordinator),
    });
    asyar_platform::linux::launcher_dbus::start(identifier, &handler)
}
