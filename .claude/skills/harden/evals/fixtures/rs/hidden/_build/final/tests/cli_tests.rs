use std::process::{Command, Output};

fn matchbook(args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_matchbook"))
        .args(args)
        .current_dir(env!("CARGO_MANIFEST_DIR"))
        .output()
        .expect("failed to start matchbook")
}

#[test]
fn run_prints_a_summary_for_the_example_session() {
    let out = matchbook(&[
        "run",
        "examples/orders.txt",
        "--config",
        "examples/matchbook.conf",
    ]);
    assert!(
        out.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    let stdout = String::from_utf8(out.stdout).unwrap();
    assert!(stdout.starts_with("strategy: fifo\n"), "{stdout}");
    assert!(stdout.contains("fills: 5\n"), "{stdout}");
    assert!(stdout.contains("rejected: order 7 (post_only_would_cross)"), "{stdout}");
}

#[test]
fn strategies_lists_the_builtins() {
    let out = matchbook(&["strategies"]);
    assert!(out.status.success());
    let stdout = String::from_utf8(out.stdout).unwrap();
    assert!(stdout.lines().any(|l| l == "fifo"));
    assert!(stdout.lines().any(|l| l == "pro_rata"));
}

#[test]
fn unknown_command_is_a_usage_error() {
    let out = matchbook(&["frobnicate"]);
    assert_eq!(out.status.code(), Some(2));
}

#[test]
fn version_flag_prints_the_crate_version() {
    let out = matchbook(&["--version"]);
    let stdout = String::from_utf8(out.stdout).unwrap();
    assert_eq!(stdout.trim(), format!("matchbook {}", env!("CARGO_PKG_VERSION")));
}
