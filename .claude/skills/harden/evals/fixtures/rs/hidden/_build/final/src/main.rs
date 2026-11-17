//! `matchbook` command-line interface.

use std::fs;
use std::path::PathBuf;
use std::process::ExitCode;
use std::time::Duration;

use matchbook::config::{self, Config};
use matchbook::{parse, refdata, report, Engine, Instruction, OrderKind, StrategyRegistry};

const USAGE: &str = "\
usage: matchbook <command> [options]

commands:
  run <orders-file>       match the orders in <orders-file>
      --config <file>     engine config (strategy, fees, price band, ...)
      --strategy <name>   override the configured allocation strategy
      --json <path>       also write the JSON report to <path> ('-' for stdout)
      --quiet             do not print the text summary
  strategies              list the registered allocation strategies
  explain                 describe the supported order kinds
  help                    show this message
  --version               print the version";

struct RunArgs {
    orders: PathBuf,
    config: Option<PathBuf>,
    strategy: Option<String>,
    json: Option<String>,
    quiet: bool,
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("run") => match parse_run_args(&args[1..]) {
            Ok(run_args) => match run(&run_args) {
                Ok(()) => ExitCode::SUCCESS,
                Err(err) => {
                    eprintln!("error: {err}");
                    ExitCode::from(1)
                }
            },
            Err(msg) => usage_error(&msg),
        },
        Some("strategies") => {
            for name in StrategyRegistry::with_builtins().names() {
                println!("{name}");
            }
            ExitCode::SUCCESS
        }
        Some("explain") => {
            for kind in OrderKind::ALL {
                println!("{:<10} {}", kind.as_str(), describe_kind(kind));
            }
            ExitCode::SUCCESS
        }
        Some("--version") | Some("-V") => {
            println!("matchbook {}", matchbook::VERSION);
            ExitCode::SUCCESS
        }
        Some("help") | Some("--help") | Some("-h") => {
            println!("{USAGE}");
            ExitCode::SUCCESS
        }
        Some(other) => usage_error(&format!("unknown command `{other}`")),
        None => usage_error("missing command"),
    }
}

fn usage_error(msg: &str) -> ExitCode {
    eprintln!("error: {msg}\n\n{USAGE}");
    ExitCode::from(2)
}

fn parse_run_args(args: &[String]) -> Result<RunArgs, String> {
    let mut orders = None;
    let mut run_args = RunArgs {
        orders: PathBuf::new(),
        config: None,
        strategy: None,
        json: None,
        quiet: false,
    };
    let mut iter = args.iter();
    while let Some(arg) = iter.next() {
        match arg.as_str() {
            "--config" => run_args.config = Some(PathBuf::from(value_for(&mut iter, arg)?)),
            "--strategy" => run_args.strategy = Some(value_for(&mut iter, arg)?),
            "--json" => run_args.json = Some(value_for(&mut iter, arg)?),
            "--quiet" | "-q" => run_args.quiet = true,
            flag if flag.starts_with("--") => return Err(format!("unknown option `{flag}`")),
            path => {
                if orders.is_some() {
                    return Err(format!("unexpected argument `{path}`"));
                }
                orders = Some(PathBuf::from(path));
            }
        }
    }
    run_args.orders = orders.ok_or("missing <orders-file>")?;
    Ok(run_args)
}

fn value_for<'a>(iter: &mut impl Iterator<Item = &'a String>, flag: &str) -> Result<String, String> {
    iter.next()
        .cloned()
        .ok_or_else(|| format!("{flag} needs a value"))
}

fn run(args: &RunArgs) -> Result<(), matchbook::Error> {
    let mut config = match &args.config {
        Some(path) => config::load_config(path)?,
        None => Config::default(),
    };
    if let Some(name) = &args.strategy {
        config.strategy = name.clone();
    }
    let text = fs::read_to_string(&args.orders)?;
    let instructions = parse::parse_orders(&text)?;

    let registry = StrategyRegistry::with_builtins();
    let mut engine = Engine::from_config(&config, &registry);
    if let Some(addr) = &config.ref_addr {
        let mut symbols: Vec<String> = instructions
            .iter()
            .filter_map(|instruction| match instruction {
                Instruction::New(order) => Some(order.symbol.clone()),
                Instruction::Cancel { .. } => None,
            })
            .collect();
        symbols.sort();
        symbols.dedup();
        let interval = Duration::from_millis(config.ref_interval_ms);
        engine.set_reference_prices(refdata::fetch_reference_prices(addr, &symbols, interval));
    }
    engine.run(instructions);

    if !args.quiet {
        print!("{}", report::render_text(&config.strategy, &engine));
    }
    if let Some(path) = &args.json {
        report::write_json_report(path, &report::render_json(&config.strategy, &engine))?;
    }
    Ok(())
}

/// One-line description for `matchbook explain`.
fn describe_kind(kind: OrderKind) -> &'static str {
    match kind {
        OrderKind::Limit => "matches what it can, rests the remainder on the book",
        OrderKind::Market => "matches at any price, cancels whatever cannot fill",
        OrderKind::Ioc => "immediate-or-cancel: matches what it can, cancels the remainder",
        OrderKind::Fok => "fill-or-kill: fills completely on arrival or is rejected",
        OrderKind::PostOnly => "rests only; rejected if it would trade on arrival",
        _ => "no description available",
    }
}
