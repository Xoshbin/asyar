use std::ffi::OsStr;
use std::fmt;
#[cfg(target_os = "linux")]
use std::fs;
#[cfg(target_os = "linux")]
use std::os::unix::fs::PermissionsExt;
#[cfg(target_os = "linux")]
use std::path::{Path, PathBuf};
#[cfg(target_os = "linux")]
use std::process::{Command, Stdio};
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
    LaunchFailed(String),
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
            Self::LaunchFailed(error) => write!(formatter, "failed to start Asyar: {error}"),
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
    run_with(args, summon, cold_start)
}

fn run_with<I, S, Invoke, ColdStart>(
    args: I,
    invoke: Invoke,
    cold_start: ColdStart,
) -> Result<(), SummonError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
    Invoke: FnOnce(Flavor) -> Result<(), SummonError>,
    ColdStart: FnOnce() -> Result<(), SummonError>,
{
    let flavor = parse_args(args)?;
    match invoke(flavor) {
        Err(SummonError::ServiceUnavailable) => cold_start(),
        result => result,
    }
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

#[cfg(target_os = "linux")]
#[derive(Debug, PartialEq, Eq)]
enum LaunchTarget {
    Sibling(PathBuf),
    Path,
}

#[cfg(target_os = "linux")]
fn cold_start() -> Result<(), SummonError> {
    let current_exe = std::env::current_exe().ok();
    let target = discover_launch_target(current_exe.as_deref());
    spawn_cold_start(&target)
}

#[cfg(not(target_os = "linux"))]
fn cold_start() -> Result<(), SummonError> {
    Err(SummonError::UnsupportedPlatform)
}

#[cfg(target_os = "linux")]
fn discover_launch_target(current_exe: Option<&Path>) -> LaunchTarget {
    let sibling = current_exe
        .and_then(Path::parent)
        .map(|directory| directory.join("asyar"));

    match (sibling, current_exe) {
        (Some(candidate), Some(helper)) if is_valid_sibling(&candidate, helper) => {
            LaunchTarget::Sibling(candidate)
        }
        _ => LaunchTarget::Path,
    }
}

#[cfg(target_os = "linux")]
fn is_valid_sibling(candidate: &Path, helper: &Path) -> bool {
    let Ok(metadata) = fs::metadata(candidate) else {
        return false;
    };
    if !metadata.is_file() || metadata.permissions().mode() & 0o111 == 0 {
        return false;
    }

    !matches!(
        (fs::canonicalize(candidate), fs::canonicalize(helper)),
        (Ok(candidate), Ok(helper)) if candidate == helper
    )
}

#[cfg(target_os = "linux")]
fn cold_start_command(target: &LaunchTarget) -> Command {
    let mut command = match target {
        LaunchTarget::Sibling(path) => Command::new(path),
        LaunchTarget::Path => Command::new("asyar"),
    };
    command
        .arg("--show-on-start")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    command
}

#[cfg(target_os = "linux")]
fn spawn_cold_start(target: &LaunchTarget) -> Result<(), SummonError> {
    cold_start_command(target)
        .spawn()
        .map(|_| ())
        .map_err(|error| {
            let target = match target {
                LaunchTarget::Sibling(path) => path.display().to_string(),
                LaunchTarget::Path => "asyar from PATH".to_string(),
            };
            SummonError::LaunchFailed(format!("{target}: {error}"))
        })
}

#[cfg(test)]
mod tests {
    use std::cell::Cell;
    use std::ffi::OsString;
    #[cfg(target_os = "linux")]
    use std::fs;
    #[cfg(target_os = "linux")]
    use std::path::PathBuf;
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
    fn warm_success_does_not_attempt_cold_launch() {
        let launches = Cell::new(0);

        let result = run_with(
            Vec::<OsString>::new(),
            |_| Ok(()),
            || {
                launches.set(launches.get() + 1);
                Ok(())
            },
        );

        assert_eq!(result, Ok(()));
        assert_eq!(launches.get(), 0);
    }

    #[test]
    fn service_unavailable_attempts_cold_launch() {
        let launches = Cell::new(0);

        let result = run_with(
            Vec::<OsString>::new(),
            |_| Err(SummonError::ServiceUnavailable),
            || {
                launches.set(launches.get() + 1);
                Ok(())
            },
        );

        assert_eq!(result, Ok(()));
        assert_eq!(launches.get(), 1);
    }

    #[test]
    fn unsafe_failures_never_attempt_cold_launch() {
        for error in [
            SummonError::TimedOut,
            SummonError::CallFailed("failed".to_string()),
            SummonError::BusUnavailable("unavailable".to_string()),
            SummonError::UnsupportedPlatform,
            SummonError::LaunchFailed("failed".to_string()),
        ] {
            let launches = Cell::new(0);
            let result = run_with(
                Vec::<OsString>::new(),
                |_| Err(error),
                || {
                    launches.set(launches.get() + 1);
                    Ok(())
                },
            );

            assert!(result.is_err());
            assert_eq!(launches.get(), 0);
        }
    }

    #[test]
    fn invalid_arguments_do_not_invoke_or_launch() {
        let invokes = Cell::new(0);
        let launches = Cell::new(0);

        let result = run_with(
            [OsString::from("--unknown")],
            |_| {
                invokes.set(invokes.get() + 1);
                Ok(())
            },
            || {
                launches.set(launches.get() + 1);
                Ok(())
            },
        );

        assert_eq!(result, Err(SummonError::InvalidArguments));
        assert_eq!(invokes.get(), 0);
        assert_eq!(launches.get(), 0);
    }

    #[test]
    fn cold_launch_failure_is_returned() {
        let result = run_with(
            Vec::<OsString>::new(),
            |_| Err(SummonError::ServiceUnavailable),
            || Err(SummonError::LaunchFailed("not found".to_string())),
        );

        assert_eq!(
            result,
            Err(SummonError::LaunchFailed("not found".to_string()))
        );
    }

    #[test]
    fn two_sequential_cold_requests_may_each_request_an_idempotent_show() {
        let launches = Cell::new(0);

        for _ in 0..2 {
            run_with(
                Vec::<OsString>::new(),
                |_| Err(SummonError::ServiceUnavailable),
                || {
                    launches.set(launches.get() + 1);
                    Ok(())
                },
            )
            .unwrap();
        }

        assert_eq!(launches.get(), 2);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn valid_sibling_executable_wins() {
        let fixture = ExecutableFixture::new(true);

        assert_eq!(
            discover_launch_target(Some(&fixture.helper)),
            LaunchTarget::Sibling(fixture.sibling.clone())
        );
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn absent_sibling_selects_path_fallback() {
        let fixture = ExecutableFixture::new(false);

        assert_eq!(
            discover_launch_target(Some(&fixture.helper)),
            LaunchTarget::Path
        );
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn non_executable_sibling_selects_path_fallback() {
        use std::os::unix::fs::PermissionsExt;

        let fixture = ExecutableFixture::new(true);
        fs::set_permissions(&fixture.sibling, fs::Permissions::from_mode(0o644)).unwrap();

        assert_eq!(
            discover_launch_target(Some(&fixture.helper)),
            LaunchTarget::Path
        );
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn sibling_resolving_to_helper_selects_path_fallback() {
        use std::os::unix::fs::symlink;

        let fixture = ExecutableFixture::new(false);
        symlink(&fixture.helper, &fixture.sibling).unwrap();

        assert_eq!(
            discover_launch_target(Some(&fixture.helper)),
            LaunchTarget::Path
        );
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn cold_commands_use_exact_show_argument() {
        let fixture = ExecutableFixture::new(true);

        for (target, expected_program) in [
            (LaunchTarget::Path, OsStr::new("asyar")),
            (
                LaunchTarget::Sibling(fixture.sibling.clone()),
                fixture.sibling.as_os_str(),
            ),
        ] {
            let command = cold_start_command(&target);
            assert_eq!(command.get_program(), expected_program);
            assert_eq!(
                command.get_args().collect::<Vec<_>>(),
                vec![OsStr::new("--show-on-start")]
            );
        }
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn cold_child_standard_streams_are_detached() {
        let fixture = ExecutableFixture::new(true);
        fs::write(&fixture.sibling, b"#!/bin/sh\nsleep 5\n").unwrap();

        let mut command = cold_start_command(&LaunchTarget::Sibling(fixture.sibling.clone()));
        let mut child = command.spawn().unwrap();
        let file_descriptors = (0..=2)
            .map(|descriptor| {
                fs::read_link(format!("/proc/{}/fd/{descriptor}", child.id())).unwrap()
            })
            .collect::<Vec<_>>();
        let _ = child.kill();
        let _ = child.wait();

        assert_eq!(file_descriptors, vec![PathBuf::from("/dev/null"); 3]);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn missing_explicit_launch_target_returns_launch_failed() {
        let target =
            LaunchTarget::Sibling(PathBuf::from("/definitely/missing/asyar-stage-four-test"));

        assert!(matches!(
            spawn_cold_start(&target),
            Err(SummonError::LaunchFailed(_))
        ));
    }

    #[test]
    #[ignore = "requires an isolated D-Bus session"]
    #[cfg(target_os = "linux")]
    fn isolated_session_routes_flavors_classifies_unavailable_and_times_out() {
        let fallback_attempts = Cell::new(0);
        assert_eq!(
            run_with(Vec::<OsString>::new(), summon, || {
                fallback_attempts.set(fallback_attempts.get() + 1);
                Ok(())
            }),
            Ok(())
        );
        assert_eq!(fallback_attempts.get(), 1);

        let (production_service, production_toggles) =
            start_fake_service(Flavor::Production, Duration::ZERO);
        let (development_service, development_toggles) =
            start_fake_service(Flavor::Development, Duration::ZERO);

        run_with(Vec::<OsString>::new(), summon, || {
            fallback_attempts.set(fallback_attempts.get() + 1);
            Ok(())
        })
        .unwrap();
        assert_eq!(production_toggles.load(Ordering::SeqCst), 1);
        assert_eq!(development_toggles.load(Ordering::SeqCst), 0);
        assert_eq!(fallback_attempts.get(), 1);

        run_with(["--dev"], summon, || {
            fallback_attempts.set(fallback_attempts.get() + 1);
            Ok(())
        })
        .unwrap();
        assert_eq!(production_toggles.load(Ordering::SeqCst), 1);
        assert_eq!(development_toggles.load(Ordering::SeqCst), 1);
        assert_eq!(fallback_attempts.get(), 1);

        let development_identity = identity(Flavor::Development);
        assert!(development_service
            .release_name(development_identity.bus_name)
            .unwrap());
        let _failing_service = start_failing_service(Flavor::Development);
        assert!(matches!(
            run_with(["--dev"], summon, || {
                fallback_attempts.set(fallback_attempts.get() + 1);
                Ok(())
            }),
            Err(SummonError::CallFailed(_))
        ));
        assert_eq!(fallback_attempts.get(), 1);

        let production_identity = identity(Flavor::Production);
        assert!(production_service
            .release_name(production_identity.bus_name)
            .unwrap());
        let (_slow_service, _) =
            start_fake_service(Flavor::Production, CALL_TIMEOUT.saturating_mul(4));

        assert_eq!(
            run_with(Vec::<OsString>::new(), summon, || {
                fallback_attempts.set(fallback_attempts.get() + 1);
                Ok(())
            }),
            Err(SummonError::TimedOut)
        );
        assert_eq!(fallback_attempts.get(), 1);
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

    #[cfg(target_os = "linux")]
    struct ExecutableFixture {
        directory: PathBuf,
        helper: PathBuf,
        sibling: PathBuf,
    }

    #[cfg(target_os = "linux")]
    impl ExecutableFixture {
        fn new(create_sibling: bool) -> Self {
            use std::os::unix::fs::PermissionsExt;

            let directory = std::env::temp_dir().join(format!(
                "asyar-summon-stage4-{}-{}",
                std::process::id(),
                TEST_FIXTURE_ID.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir(&directory).unwrap();
            let helper = directory.join("asyar-summon");
            fs::write(&helper, b"helper").unwrap();
            fs::set_permissions(&helper, fs::Permissions::from_mode(0o755)).unwrap();
            let sibling = directory.join("asyar");
            if create_sibling {
                fs::write(&sibling, b"asyar").unwrap();
                fs::set_permissions(&sibling, fs::Permissions::from_mode(0o755)).unwrap();
            }

            Self {
                directory,
                helper,
                sibling,
            }
        }
    }

    #[cfg(target_os = "linux")]
    impl Drop for ExecutableFixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.directory);
        }
    }

    #[cfg(target_os = "linux")]
    static TEST_FIXTURE_ID: AtomicUsize = AtomicUsize::new(0);
}
