use std::process::ExitCode;

fn main() -> ExitCode {
    match asyar_summon::run(std::env::args_os().skip(1)) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("asyar-summon: {error}");
            ExitCode::FAILURE
        }
    }
}
