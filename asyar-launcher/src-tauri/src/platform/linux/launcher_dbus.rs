use std::fmt;
use std::sync::{Arc, Weak};

use crate::launcher::{LauncherAction, LauncherCoordinator};

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
pub(crate) enum LauncherDbusError {
    UnsupportedIdentifier(String),
    Registration(String),
}

impl fmt::Display for LauncherDbusError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::UnsupportedIdentifier(identifier) => write!(
                formatter,
                "unsupported Tauri application identifier for launcher D-Bus service: {identifier}"
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

struct LauncherDbusEndpoint {
    coordinator: Weak<LauncherCoordinator>,
}

impl LauncherDbusEndpoint {
    fn new(coordinator: &Arc<LauncherCoordinator>) -> Self {
        Self {
            coordinator: Arc::downgrade(coordinator),
        }
    }
}

#[zbus::interface(name = "org.asyar.Launcher1")]
impl LauncherDbusEndpoint {
    fn toggle(&self) -> zbus::fdo::Result<()> {
        self.coordinator
            .upgrade()
            .ok_or_else(|| {
                zbus::fdo::Error::Failed("launcher coordinator is unavailable".to_string())
            })?
            .request(LauncherAction::Toggle)
            .map_err(|error| zbus::fdo::Error::Failed(error.to_string()))
    }
}

/// Owns the connection so its well-known name and object remain registered
/// until Tauri drops managed state during application shutdown.
pub(crate) struct LauncherDbusService {
    _connection: zbus::blocking::Connection,
}

pub(crate) fn start(
    identifier: &str,
    coordinator: &Arc<LauncherCoordinator>,
) -> Result<LauncherDbusService, LauncherDbusError> {
    let identity = LauncherDbusIdentity::resolve(identifier)?;
    let connection = zbus::blocking::connection::Builder::session()
        .and_then(|builder| {
            builder.serve_at(identity.object_path, LauncherDbusEndpoint::new(coordinator))
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
            "unsupported Tauri application identifier for launcher D-Bus service: org.example.asyar"
        );
    }

    #[test]
    fn toggle_queues_a_toggle_with_the_launcher_coordinator() {
        let coordinator = Arc::new(LauncherCoordinator::new());
        let endpoint = LauncherDbusEndpoint::new(&coordinator);

        endpoint.toggle().unwrap();

        assert_eq!(coordinator.pending_actions(), vec![LauncherAction::Toggle]);
    }

    #[test]
    fn toggle_fails_when_the_coordinator_is_unavailable() {
        let coordinator = Arc::new(LauncherCoordinator::new());
        let endpoint = LauncherDbusEndpoint::new(&coordinator);
        drop(coordinator);

        let error = endpoint.toggle().unwrap_err();

        assert_eq!(
            error.to_string(),
            "org.freedesktop.DBus.Error.Failed: launcher coordinator is unavailable"
        );
    }

    #[test]
    #[ignore = "requires an isolated D-Bus session"]
    #[serial_test::serial(launcher_dbus)]
    fn isolated_session_exposes_toggle_and_keeps_flavors_separate() {
        let production = Arc::new(LauncherCoordinator::new());
        let development = Arc::new(LauncherCoordinator::new());
        let _production_service = start("org.asyar.app", &production).unwrap();
        let _development_service = start("org.asyar.dev", &development).unwrap();
        let client = zbus::blocking::Connection::session().unwrap();

        for (bus_name, object_path) in [
            ("org.asyar.app.Launcher", "/org/asyar/app/Launcher"),
            ("org.asyar.dev.Launcher", "/org/asyar/dev/Launcher"),
        ] {
            let introspection = zbus::blocking::Proxy::new(
                &client,
                bus_name,
                object_path,
                "org.freedesktop.DBus.Introspectable",
            )
            .unwrap();
            let xml: String = introspection.call("Introspect", &()).unwrap();
            assert!(xml.contains("org.asyar.Launcher1"));
            assert!(xml.contains("<method name=\"Toggle\">"));
        }

        let production_proxy = zbus::blocking::Proxy::new(
            &client,
            "org.asyar.app.Launcher",
            "/org/asyar/app/Launcher",
            "org.asyar.Launcher1",
        )
        .unwrap();
        production_proxy.call::<_, _, ()>("Toggle", &()).unwrap();
        assert_eq!(production.pending_actions(), vec![LauncherAction::Toggle]);
        assert!(development.pending_actions().is_empty());

        let wrong_flavor_path = zbus::blocking::Proxy::new(
            &client,
            "org.asyar.dev.Launcher",
            "/org/asyar/app/Launcher",
            "org.asyar.Launcher1",
        )
        .unwrap();
        assert!(wrong_flavor_path.call::<_, _, ()>("Toggle", &()).is_err());
        assert!(development.pending_actions().is_empty());

        let development_proxy = zbus::blocking::Proxy::new(
            &client,
            "org.asyar.dev.Launcher",
            "/org/asyar/dev/Launcher",
            "org.asyar.Launcher1",
        )
        .unwrap();
        development_proxy.call::<_, _, ()>("Toggle", &()).unwrap();
        assert_eq!(development.pending_actions(), vec![LauncherAction::Toggle]);
    }

    #[test]
    #[ignore = "requires an isolated D-Bus session"]
    #[serial_test::serial(launcher_dbus)]
    fn normal_owner_conflict_does_not_replace_existing_owner() {
        assert_existing_owner_is_not_replaced(zbus::fdo::RequestNameFlags::DoNotQueue);
    }

    #[test]
    #[ignore = "requires an isolated D-Bus session"]
    #[serial_test::serial(launcher_dbus)]
    fn replaceable_owner_conflict_does_not_replace_existing_owner() {
        assert_existing_owner_is_not_replaced(zbus::fdo::RequestNameFlags::AllowReplacement);
    }

    fn assert_existing_owner_is_not_replaced(owner_flags: zbus::fdo::RequestNameFlags) {
        const BUS_NAME: &str = "org.asyar.app.Launcher";

        let owner = zbus::blocking::Connection::session().unwrap();
        let reply = owner
            .request_name_with_flags(BUS_NAME, owner_flags.into())
            .unwrap();
        assert_eq!(reply, zbus::fdo::RequestNameReply::PrimaryOwner);
        let original_owner = owner.unique_name().unwrap().to_string();

        let coordinator = Arc::new(LauncherCoordinator::new());
        assert!(start("org.asyar.app", &coordinator).is_err());

        let client = zbus::blocking::Connection::session().unwrap();
        let dbus = zbus::blocking::fdo::DBusProxy::new(&client).unwrap();
        let current_owner = dbus
            .get_name_owner(zbus::names::BusName::try_from(BUS_NAME).unwrap())
            .unwrap();
        assert_eq!(current_owner.to_string(), original_owner);

        assert!(owner.release_name(BUS_NAME).unwrap());
    }
}
