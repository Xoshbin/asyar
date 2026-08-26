use std::ffi::OsStr;
use std::fmt;
#[cfg(target_os = "linux")]
use std::sync::mpsc;
#[cfg(target_os = "linux")]
use std::thread;
#[cfg(target_os = "linux")]
use std::time::Duration;

#[cfg(target_os = "linux")]
const CALL_TIMEOUT: Duration = Duration::from_millis(500);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Flavor {
    Production,
    Development,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Identity {
    bus_name: &'static str,
    object_path: &'static str,
}

#[derive(Debug, PartialEq, Eq)]
pub enum SummonError {
    InvalidArguments,
    UnsupportedPlatform,
    // Stage 4 may cold-start only for this variant. Bus, call, and timeout
    // failures do not establish that another Asyar process is safe to spawn.
    ServiceUnavailable,
    BusUnavailable(String),
    CallFailed(String),
    TimedOut,
}

impl fmt::Display for SummonError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidArguments => write!(formatter, "usage: asyar-summon [--dev]"),
            Self::UnsupportedPlatform => {
                write!(formatter, "asyar-summon is only supported on Linux")
            }
            Self::ServiceUnavailable => write!(formatter, "Asyar launcher service is unavailable"),
            Self::BusUnavailable(error) => {
                write!(formatter, "session bus is unavailable: {error}")
            }
            Self::CallFailed(error) => write!(formatter, "launcher request failed: {error}"),
            Self::TimedOut => write!(formatter, "launcher request timed out"),
        }
    }
}

fn parse_args<I, S>(args: I) -> Result<Flavor, SummonError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    let arguments = args.into_iter().collect::<Vec<_>>();
    match arguments.as_slice() {
        [] => Ok(Flavor::Production),
        [argument] if argument.as_ref() == OsStr::new("--dev") => Ok(Flavor::Development),
        _ => Err(SummonError::InvalidArguments),
    }
}

fn identity(flavor: Flavor) -> Identity {
    match flavor {
        Flavor::Production => Identity {
            bus_name: "org.asyar.app.Launcher",
            object_path: "/org/asyar/app/Launcher",
        },
        Flavor::Development => Identity {
            bus_name: "org.asyar.dev.Launcher",
            object_path: "/org/asyar/dev/Launcher",
        },
    }
}

pub fn run<I, S>(args: I) -> Result<(), SummonError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    summon(parse_args(args)?)
}

fn summon(flavor: Flavor) -> Result<(), SummonError> {
    #[cfg(target_os = "linux")]
    {
        summon_linux(flavor)
    }

    #[cfg(not(target_os = "linux"))]
    {
        let selected_identity = identity(flavor);
        let _ = (selected_identity.bus_name, selected_identity.object_path);
        Err(SummonError::UnsupportedPlatform)
    }
}

#[cfg(target_os = "linux")]
fn summon_linux(flavor: Flavor) -> Result<(), SummonError> {
    let (sender, receiver) = mpsc::sync_channel(1);
    thread::Builder::new()
        .name("asyar-summon-dbus".to_string())
        .spawn(move || {
            let _ = sender.send(call_launcher(flavor));
        })
        .map_err(|error| SummonError::CallFailed(error.to_string()))?;

    match receiver.recv_timeout(CALL_TIMEOUT) {
        Ok(result) => result,
        Err(mpsc::RecvTimeoutError::Timeout) => Err(SummonError::TimedOut),
        Err(mpsc::RecvTimeoutError::Disconnected) => Err(SummonError::CallFailed(
            "launcher request worker stopped unexpectedly".to_string(),
        )),
    }
}

#[cfg(target_os = "linux")]
fn call_launcher(flavor: Flavor) -> Result<(), SummonError> {
    let identity = identity(flavor);
    let connection = zbus::blocking::Connection::session()
        .map_err(|error| SummonError::BusUnavailable(error.to_string()))?;
    let proxy = zbus::blocking::Proxy::new(
        &connection,
        identity.bus_name,
        identity.object_path,
        "org.asyar.Launcher1",
    )
    .map_err(|error| SummonError::CallFailed(error.to_string()))?;

    proxy
        .call::<_, _, ()>("Toggle", &())
        .map_err(classify_call_error)
}

#[cfg(target_os = "linux")]
fn classify_call_error(error: zbus::Error) -> SummonError {
    let service_unavailable = match &error {
        zbus::Error::MethodError(name, _, _) => matches!(
            name.as_str(),
            "org.freedesktop.DBus.Error.ServiceUnknown"
                | "org.freedesktop.DBus.Error.NameHasNoOwner"
        ),
        zbus::Error::FDO(error) => matches!(
            error.as_ref(),
            zbus::fdo::Error::ServiceUnknown(_) | zbus::fdo::Error::NameHasNoOwner(_)
        ),
        _ => false,
    };

    if service_unavailable {
        SummonError::ServiceUnavailable
    } else {
        SummonError::CallFailed(error.to_string())
    }
}

#[cfg(test)]
mod tests {
    use std::ffi::OsString;
    #[cfg(target_os = "linux")]
    use std::sync::atomic::{AtomicUsize, Ordering};
    #[cfg(target_os = "linux")]
    use std::sync::Arc;
    #[cfg(target_os = "linux")]
    use std::thread;

    use super::*;

    #[cfg(target_os = "linux")]
    struct FakeLauncher {
        toggles: Arc<AtomicUsize>,
        delay: Duration,
    }

    #[cfg(target_os = "linux")]
    #[zbus::interface(name = "org.asyar.Launcher1")]
    impl FakeLauncher {
        fn toggle(&self) {
            thread::sleep(self.delay);
            self.toggles.fetch_add(1, Ordering::SeqCst);
        }
    }

    #[cfg(target_os = "linux")]
    struct FailingLauncher;

    #[cfg(target_os = "linux")]
    #[zbus::interface(name = "org.asyar.Launcher1")]
    impl FailingLauncher {
        fn toggle(&self) -> zbus::fdo::Result<()> {
            Err(zbus::fdo::Error::Failed(
                "resident rejected launcher request".to_string(),
            ))
        }
    }

    #[test]
    fn no_arguments_selects_production() {
        assert_eq!(parse_args(Vec::<String>::new()), Ok(Flavor::Production));
    }

    #[test]
    fn dev_argument_selects_development() {
        assert_eq!(parse_args(["--dev"]), Ok(Flavor::Development));
    }

    #[test]
    fn unknown_unicode_argument_is_rejected() {
        assert_eq!(
            parse_args([OsString::from("--développement")]),
            Err(SummonError::InvalidArguments)
        );
    }

    #[cfg(unix)]
    #[test]
    fn non_utf8_argument_is_rejected() {
        use std::os::unix::ffi::OsStringExt;

        assert_eq!(
            parse_args([OsString::from_vec(vec![0xff])]),
            Err(SummonError::InvalidArguments)
        );
    }

    #[test]
    fn unknown_argument_is_rejected() {
        assert_eq!(
            parse_args(["--unknown"]),
            Err(SummonError::InvalidArguments)
        );
    }

    #[test]
    fn multiple_arguments_are_rejected() {
        assert_eq!(
            parse_args(["--dev", "--unknown"]),
            Err(SummonError::InvalidArguments)
        );
    }

    #[test]
    fn duplicate_dev_arguments_are_rejected() {
        assert_eq!(
            parse_args(["--dev", "--dev"]),
            Err(SummonError::InvalidArguments)
        );
    }

    #[test]
    fn multiple_unsupported_arguments_are_rejected() {
        assert_eq!(
            parse_args(["--unknown", "value"]),
            Err(SummonError::InvalidArguments)
        );
    }

    #[test]
    fn unsupported_platform_error_is_concise() {
        assert_eq!(
            SummonError::UnsupportedPlatform.to_string(),
            "asyar-summon is only supported on Linux"
        );
    }

    #[test]
    fn identities_match_the_launcher_service() {
        assert_eq!(
            identity(Flavor::Production),
            Identity {
                bus_name: "org.asyar.app.Launcher",
                object_path: "/org/asyar/app/Launcher",
            }
        );
        assert_eq!(
            identity(Flavor::Development),
            Identity {
                bus_name: "org.asyar.dev.Launcher",
                object_path: "/org/asyar/dev/Launcher",
            }
        );
    }

    #[test]
    #[ignore = "requires an isolated D-Bus session"]
    #[cfg(target_os = "linux")]
    fn isolated_session_routes_flavors_classifies_unavailable_and_times_out() {
        assert_eq!(
            run(Vec::<String>::new()),
            Err(SummonError::ServiceUnavailable)
        );

        let (production_service, production_toggles) =
            start_fake_service(Flavor::Production, Duration::ZERO);
        let (development_service, development_toggles) =
            start_fake_service(Flavor::Development, Duration::ZERO);

        run(Vec::<String>::new()).unwrap();
        assert_eq!(production_toggles.load(Ordering::SeqCst), 1);
        assert_eq!(development_toggles.load(Ordering::SeqCst), 0);

        run(["--dev"]).unwrap();
        assert_eq!(production_toggles.load(Ordering::SeqCst), 1);
        assert_eq!(development_toggles.load(Ordering::SeqCst), 1);

        let development_identity = identity(Flavor::Development);
        assert!(development_service
            .release_name(development_identity.bus_name)
            .unwrap());
        let _failing_service = start_failing_service(Flavor::Development);
        assert!(matches!(run(["--dev"]), Err(SummonError::CallFailed(_))));

        let production_identity = identity(Flavor::Production);
        assert!(production_service
            .release_name(production_identity.bus_name)
            .unwrap());
        let (_slow_service, _) =
            start_fake_service(Flavor::Production, CALL_TIMEOUT.saturating_mul(4));

        assert_eq!(summon(Flavor::Production), Err(SummonError::TimedOut));
    }

    #[cfg(target_os = "linux")]
    fn start_fake_service(
        flavor: Flavor,
        delay: Duration,
    ) -> (zbus::blocking::Connection, Arc<AtomicUsize>) {
        let identity = identity(flavor);
        let toggles = Arc::new(AtomicUsize::new(0));
        let connection = zbus::blocking::connection::Builder::session()
            .unwrap()
            .serve_at(
                identity.object_path,
                FakeLauncher {
                    toggles: toggles.clone(),
                    delay,
                },
            )
            .unwrap()
            .build()
            .unwrap();
        let reply = connection
            .request_name_with_flags(
                identity.bus_name,
                zbus::fdo::RequestNameFlags::DoNotQueue.into(),
            )
            .unwrap();
        assert_eq!(reply, zbus::fdo::RequestNameReply::PrimaryOwner);

        (connection, toggles)
    }

    #[cfg(target_os = "linux")]
    fn start_failing_service(flavor: Flavor) -> zbus::blocking::Connection {
        let identity = identity(flavor);
        let connection = zbus::blocking::connection::Builder::session()
            .unwrap()
            .serve_at(identity.object_path, FailingLauncher)
            .unwrap()
            .build()
            .unwrap();
        let reply = connection
            .request_name_with_flags(
                identity.bus_name,
                zbus::fdo::RequestNameFlags::DoNotQueue.into(),
            )
            .unwrap();
        assert_eq!(reply, zbus::fdo::RequestNameReply::PrimaryOwner);

        connection
    }
}
