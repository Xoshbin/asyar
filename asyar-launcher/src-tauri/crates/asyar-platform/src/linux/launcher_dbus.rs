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
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
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

/// Owns the connection so its well-known name and object remain registered
/// until application shutdown.
pub struct LauncherDbusService {
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
        _connection: connection,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn production_identity_uses_production_bus_and_path() {
        let identity = LauncherDbusIdentity::resolve("org.asyar.app").unwrap();

        assert_eq!(identity.bus_name, "org.asyar.app.Launcher");
        assert_eq!(identity.object_path, "/org/asyar/app/Launcher");
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
