use std::fmt;
use std::sync::{Arc, Weak};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LauncherAction {
    Toggle,
    Show,
}

pub trait LauncherActionHandler: Send + Sync + 'static {
    fn handle_action(&self, action: LauncherAction) -> Result<(), String>;
}

#[derive(Debug, PartialEq, Eq)]
struct LauncherDbusIdentity {
    bus_name: &'static str,
    object_path: &'static str,
}

impl LauncherDbusIdentity {
    fn resolve(identifier: &str) -> Result<Self, LauncherDbusError> {
        match identifier {
            "org.asyar" => Ok(Self {
                bus_name: "org.asyar.Launcher",
                object_path: "/org/asyar/Launcher",
            }),
            // COMPAT(remove in 0.2.0): legacy bundle identifier before macOS .app folder fix
            "org.asyar.app" => Ok(Self {
                bus_name: "org.asyar.app.Launcher",
                object_path: "/org/asyar/app/Launcher",
            }),
            "org.asyar.dev" => Ok(Self {
                bus_name: "org.asyar.dev.Launcher",
                object_path: "/org/asyar/dev/Launcher",
            }),
            identifier => Err(LauncherDbusError::UnsupportedIdentifier(
                identifier.to_string(),
            )),
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum LauncherDbusError {
    UnsupportedIdentifier(String),
    Registration(String),
}

impl fmt::Display for LauncherDbusError {
    fn fmt(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
        match self {
            Self::UnsupportedIdentifier(identifier) => write!(
                formatter,
                "unsupported application identifier for launcher D-Bus service: {identifier}"
            ),
            Self::Registration(error) => {
                write!(
                    formatter,
                    "failed to register launcher D-Bus service: {error}"
                )
            }
        }
    }
}

pub struct LauncherDbusEndpoint {
    handler: Weak<dyn LauncherActionHandler>,
}

impl LauncherDbusEndpoint {
    pub fn new(handler: &Arc<dyn LauncherActionHandler>) -> Self {
        Self {
            handler: Arc::downgrade(handler),
        }
    }
}

#[zbus::interface(name = "org.asyar.Launcher1")]
impl LauncherDbusEndpoint {
    fn toggle(&self) -> zbus::fdo::Result<()> {
        self.handler
            .upgrade()
            .ok_or_else(|| zbus::fdo::Error::Failed("launcher handler is unavailable".to_string()))?
            .handle_action(LauncherAction::Toggle)
            .map_err(zbus::fdo::Error::Failed)
    }
}

/// Owns the handler and the connection so the well-known name, its object,
/// and the handler remain alive until application shutdown. The handler must
/// be owned here: the endpoint only holds a Weak reference, so dropping the
/// caller's Arc would otherwise kill every summon call after startup.
pub struct LauncherDbusService {
    _handler: Arc<dyn LauncherActionHandler>,
    _connection: zbus::blocking::Connection,
}

pub fn start(
    identifier: &str,
    handler: &Arc<dyn LauncherActionHandler>,
) -> Result<LauncherDbusService, LauncherDbusError> {
    let identity = LauncherDbusIdentity::resolve(identifier)?;
    let connection = zbus::blocking::connection::Builder::session()
        .and_then(|builder| {
            builder.serve_at(identity.object_path, LauncherDbusEndpoint::new(handler))
        })
        .and_then(zbus::blocking::connection::Builder::build)
        .map_err(|error| LauncherDbusError::Registration(error.to_string()))?;
    let reply = connection
        .request_name_with_flags(
            identity.bus_name,
            zbus::fdo::RequestNameFlags::DoNotQueue.into(),
        )
        .map_err(|error| LauncherDbusError::Registration(error.to_string()))?;
    if reply != zbus::fdo::RequestNameReply::PrimaryOwner {
        return Err(LauncherDbusError::Registration(format!(
            "unexpected name request reply: {reply:?}"
        )));
    }

    Ok(LauncherDbusService {
        _handler: Arc::clone(handler),
        _connection: connection,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn production_identity_uses_production_bus_and_path() {
        let identity = LauncherDbusIdentity::resolve("org.asyar").unwrap();

        assert_eq!(identity.bus_name, "org.asyar.Launcher");
        assert_eq!(identity.object_path, "/org/asyar/Launcher");

        let legacy_identity = LauncherDbusIdentity::resolve("org.asyar.app").unwrap();
        assert_eq!(legacy_identity.bus_name, "org.asyar.app.Launcher");
        assert_eq!(legacy_identity.object_path, "/org/asyar/app/Launcher");
    }

    #[test]
    fn development_identity_uses_development_bus_and_path() {
        let identity = LauncherDbusIdentity::resolve("org.asyar.dev").unwrap();

        assert_eq!(identity.bus_name, "org.asyar.dev.Launcher");
        assert_eq!(identity.object_path, "/org/asyar/dev/Launcher");
    }

    #[test]
    fn unknown_identifier_is_rejected() {
        let error = LauncherDbusIdentity::resolve("org.example.asyar").unwrap_err();

        assert_eq!(
            error.to_string(),
            "unsupported application identifier for launcher D-Bus service: org.example.asyar"
        );
    }
}

#[cfg(all(test, target_os = "linux"))]
mod dbus_session_tests {
    use super::*;
    use std::sync::Mutex;

    struct RecordingHandler {
        actions: Arc<Mutex<Vec<LauncherAction>>>,
    }

    impl LauncherActionHandler for RecordingHandler {
        fn handle_action(&self, action: LauncherAction) -> Result<(), String> {
            self.actions.lock().unwrap().push(action);
            Ok(())
        }
    }

    // Regression test: the caller drops its Arc after start(); the service
    // must keep the handler alive so the endpoint's Weak can upgrade.
    // Requires a session bus (CI runs this suite under dbus-run-session).
    #[test]
    fn service_keeps_handler_alive_after_caller_drops_arc() {
        let actions = Arc::new(Mutex::new(Vec::new()));
        let handler: Arc<dyn LauncherActionHandler> = Arc::new(RecordingHandler {
            actions: Arc::clone(&actions),
        });
        let service = start("org.asyar.dev", &handler).expect("launcher dbus start");

        drop(handler); // the refactor bug: this used to kill the endpoint's Weak

        let connection = zbus::blocking::Connection::session().expect("session bus");
        connection
            .call_method(
                Some("org.asyar.dev.Launcher"),
                "/org/asyar/dev/Launcher",
                Some("org.asyar.Launcher1"),
                "Toggle",
                &(),
            )
            .expect("Toggle must succeed while the service is alive");

        assert_eq!(
            actions.lock().unwrap().as_slice(),
            &[LauncherAction::Toggle]
        );
        drop(service);
    }
}
