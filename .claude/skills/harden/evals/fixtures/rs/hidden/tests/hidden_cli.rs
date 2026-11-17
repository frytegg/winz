//! Hidden behaviour tests for the `matchbook` binary.
//!
//! They pin the CLI surface and the JSON report contract (including fields no
//! Rust code reads, such as `schema_version`, `generator` and
//! `fills[].aggressor`), strategy loading by name from a config file, the
//! documented FIFO default, and the sequential, rate-limited reference price
//! fetch. Values that a correct behaviour-changing fix may alter
//! (`summary.total_fees`, `summary.vwap` values) are only checked for presence.

use std::fs;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::PathBuf;
use std::process::{Command, Output};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

// ------------------------------------------------------------------ helpers --

fn matchbook(args: &[&str], envs: &[(&str, &str)]) -> Output {
    let mut command = Command::new(env!("CARGO_BIN_EXE_matchbook"));
    command.args(args).current_dir(env!("CARGO_MANIFEST_DIR"));
    for (key, value) in envs {
        command.env(key, value);
    }
    command.output().expect("failed to start matchbook")
}

fn stdout_of(out: &Output) -> String {
    assert!(
        out.status.success(),
        "matchbook failed with {:?}\nstdout:\n{}\nstderr:\n{}",
        out.status.code(),
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8(out.stdout.clone()).expect("stdout is UTF-8")
}

/// A scratch directory that is removed on drop.
struct Scratch(PathBuf);

impl Scratch {
    fn new(tag: &str) -> Scratch {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "matchbook-hidden-{tag}-{}-{nanos}",
            std::process::id()
        ));
        fs::create_dir_all(&dir).unwrap();
        Scratch(dir)
    }

    fn file(&self, name: &str, contents: &str) -> String {
        let path = self.0.join(name);
        fs::write(&path, contents).unwrap();
        path.to_string_lossy().into_owned()
    }

    fn path(&self, name: &str) -> String {
        self.0.join(name).to_string_lossy().into_owned()
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

// ------------------------------------------------------ minimal JSON parser --

#[derive(Debug, Clone, PartialEq)]
enum Json {
    Null,
    Bool(bool),
    Num(String),
    Str(String),
    Arr(Vec<Json>),
    Obj(Vec<(String, Json)>),
}

impl Json {
    fn get(&self, key: &str) -> &Json {
        match self {
            Json::Obj(fields) => fields
                .iter()
                .find(|(k, _)| k == key)
                .map(|(_, v)| v)
                .unwrap_or_else(|| panic!("missing key `{key}` in {self:?}")),
            other => panic!("expected an object, got {other:?}"),
        }
    }

    fn keys(&self) -> Vec<&str> {
        match self {
            Json::Obj(fields) => fields.iter().map(|(k, _)| k.as_str()).collect(),
            other => panic!("expected an object, got {other:?}"),
        }
    }

    fn str(&self) -> &str {
        match self {
            Json::Str(s) => s,
            other => panic!("expected a string, got {other:?}"),
        }
    }

    fn int(&self) -> u64 {
        match self {
            Json::Num(n) => n.parse().unwrap_or_else(|_| panic!("not an integer: {n}")),
            other => panic!("expected a number, got {other:?}"),
        }
    }

    fn arr(&self) -> &[Json] {
        match self {
            Json::Arr(items) => items,
            other => panic!("expected an array, got {other:?}"),
        }
    }
}

struct Parser<'a> {
    s: &'a [u8],
    i: usize,
}

fn parse_json(text: &str) -> Json {
    let mut parser = Parser {
        s: text.as_bytes(),
        i: 0,
    };
    let value = parser.value();
    parser.ws();
    assert_eq!(parser.i, parser.s.len(), "trailing data after JSON value");
    value
}

impl Parser<'_> {
    fn ws(&mut self) {
        while self.i < self.s.len() && matches!(self.s[self.i], b' ' | b'\n' | b'\r' | b'\t') {
            self.i += 1;
        }
    }

    fn expect(&mut self, byte: u8) {
        self.ws();
        assert_eq!(self.s.get(self.i), Some(&byte), "expected `{}` at {}", byte as char, self.i);
        self.i += 1;
    }

    fn value(&mut self) -> Json {
        self.ws();
        match self.s.get(self.i).copied() {
            Some(b'{') => {
                self.i += 1;
                let mut fields = Vec::new();
                self.ws();
                if self.s.get(self.i) == Some(&b'}') {
                    self.i += 1;
                    return Json::Obj(fields);
                }
                loop {
                    self.ws();
                    let key = self.string();
                    self.expect(b':');
                    let value = self.value();
                    fields.push((key, value));
                    self.ws();
                    match self.s.get(self.i) {
                        Some(b',') => self.i += 1,
                        Some(b'}') => {
                            self.i += 1;
                            return Json::Obj(fields);
                        }
                        other => panic!("bad object at {}: {other:?}", self.i),
                    }
                }
            }
            Some(b'[') => {
                self.i += 1;
                let mut items = Vec::new();
                self.ws();
                if self.s.get(self.i) == Some(&b']') {
                    self.i += 1;
                    return Json::Arr(items);
                }
                loop {
                    items.push(self.value());
                    self.ws();
                    match self.s.get(self.i) {
                        Some(b',') => self.i += 1,
                        Some(b']') => {
                            self.i += 1;
                            return Json::Arr(items);
                        }
                        other => panic!("bad array at {}: {other:?}", self.i),
                    }
                }
            }
            Some(b'"') => Json::Str(self.string()),
            Some(b't') => self.literal("true", Json::Bool(true)),
            Some(b'f') => self.literal("false", Json::Bool(false)),
            Some(b'n') => self.literal("null", Json::Null),
            Some(_) => {
                let start = self.i;
                while self.i < self.s.len()
                    && matches!(self.s[self.i], b'-' | b'+' | b'.' | b'e' | b'E' | b'0'..=b'9')
                {
                    self.i += 1;
                }
                assert!(self.i > start, "unexpected byte at {start}");
                Json::Num(String::from_utf8(self.s[start..self.i].to_vec()).unwrap())
            }
            None => panic!("unexpected end of JSON"),
        }
    }

    fn literal(&mut self, word: &str, value: Json) -> Json {
        assert!(self.s[self.i..].starts_with(word.as_bytes()), "bad literal at {}", self.i);
        self.i += word.len();
        value
    }

    fn string(&mut self) -> String {
        assert_eq!(self.s.get(self.i), Some(&b'"'), "expected a string at {}", self.i);
        self.i += 1;
        let mut bytes = Vec::new();
        loop {
            let byte = *self.s.get(self.i).expect("unterminated string");
            self.i += 1;
            match byte {
                b'"' => break,
                b'\\' => {
                    let escaped = self.s[self.i];
                    self.i += 1;
                    match escaped {
                        b'n' => bytes.push(b'\n'),
                        b't' => bytes.push(b'\t'),
                        b'r' => bytes.push(b'\r'),
                        b'b' => bytes.push(8),
                        b'f' => bytes.push(12),
                        b'u' => {
                            let hex = std::str::from_utf8(&self.s[self.i..self.i + 4]).unwrap();
                            let code = u32::from_str_radix(hex, 16).unwrap();
                            self.i += 4;
                            let c = char::from_u32(code).unwrap_or('\u{fffd}');
                            let mut buf = [0u8; 4];
                            bytes.extend_from_slice(c.encode_utf8(&mut buf).as_bytes());
                        }
                        other => bytes.push(other),
                    }
                }
                other => bytes.push(other),
            }
        }
        String::from_utf8(bytes).expect("JSON string is UTF-8")
    }
}

// ------------------------------------------------------------ JSON contract --

const FILL_KEYS: [&str; 12] = [
    "trade_id",
    "symbol",
    "price",
    "qty",
    "maker_order",
    "taker_order",
    "maker_account",
    "taker_account",
    "aggressor",
    "maker_fee",
    "taker_fee",
    "ts",
];

fn sorted(mut keys: Vec<&str>) -> Vec<&str> {
    keys.sort_unstable();
    keys
}

fn example_report(extra: &[&str]) -> Json {
    let scratch = Scratch::new("report");
    let json_path = scratch.path("report.json");
    let mut args = vec![
        "run",
        "examples/orders.txt",
        "--config",
        "examples/matchbook.conf",
        "--json",
        json_path.as_str(),
    ];
    args.extend_from_slice(extra);
    let out = matchbook(&args, &[]);
    stdout_of(&out);
    parse_json(&fs::read_to_string(&json_path).expect("report written"))
}

#[test]
fn json_report_top_level_contract() {
    let report = example_report(&["--quiet"]);
    assert_eq!(
        sorted(report.keys()),
        sorted(vec![
            "schema_version",
            "generator",
            "strategy",
            "fills",
            "rejections",
            "cancellations",
            "summary",
            "accounts",
        ])
    );
    assert_eq!(report.get("schema_version"), &Json::Num("1".to_string()));
    assert_eq!(
        report.get("generator").str(),
        format!("matchbook {}", env!("CARGO_PKG_VERSION"))
    );
    assert_eq!(report.get("strategy").str(), "fifo");
}

#[test]
fn json_report_fills_contract() {
    let report = example_report(&["--quiet"]);
    let fills = report.get("fills").arr();
    assert_eq!(fills.len(), 5);
    for fill in fills {
        assert_eq!(sorted(fill.keys()), sorted(FILL_KEYS.to_vec()), "{fill:?}");
        assert!(matches!(fill.get("aggressor").str(), "buy" | "sell"));
    }
    let ids: Vec<u64> = fills.iter().map(|f| f.get("trade_id").int()).collect();
    assert_eq!(ids, vec![1, 2, 3, 4, 5]);

    let first = &fills[0];
    assert_eq!(first.get("symbol").str(), "BTC-USD");
    assert_eq!(first.get("price").str(), "30005.5");
    assert_eq!(first.get("qty").str(), "0.25");
    assert_eq!(first.get("maker_order").int(), 2);
    assert_eq!(first.get("taker_order").int(), 4);
    assert_eq!(first.get("maker_account").str(), "bob");
    assert_eq!(first.get("taker_account").str(), "dave");
    assert_eq!(first.get("aggressor").str(), "buy");
    assert_eq!(first.get("maker_fee").str(), "1.500275");
    assert_eq!(first.get("taker_fee").str(), "3.7506875");
    assert_eq!(first.get("ts").int(), 1_700_000_000_300);

    let fourth = &fills[3];
    assert_eq!(fourth.get("aggressor").str(), "sell");
    assert_eq!(fourth.get("maker_account").str(), "carol");
    assert_eq!(fourth.get("price").str(), "29990");
    assert_eq!(fourth.get("qty").str(), "0.3");

    let fifth = &fills[4];
    assert_eq!(fifth.get("qty").str(), "0.12345678");
    assert_eq!(fifth.get("maker_fee").str(), "0.04571284");
    assert_eq!(fifth.get("taker_fee").str(), "0.11428209");
}

#[test]
fn json_report_events_summary_and_accounts_contract() {
    let report = example_report(&["--quiet"]);
    let events = |key: &str| -> Vec<(u64, String)> {
        report
            .get(key)
            .arr()
            .iter()
            .map(|e| (e.get("order").int(), e.get("reason").str().to_string()))
            .collect()
    };
    assert_eq!(
        events("rejections"),
        vec![
            (7, "post_only_would_cross".to_string()),
            (9, "fok_not_fillable".to_string()),
        ]
    );
    assert_eq!(
        events("cancellations"),
        vec![
            (6, "ioc_remainder".to_string()),
            (3, "requested".to_string()),
            (1, "self_trade".to_string()),
        ]
    );

    let summary = report.get("summary");
    assert_eq!(
        sorted(summary.keys()),
        sorted(vec!["fill_count", "total_fees", "volume", "vwap"])
    );
    assert_eq!(summary.get("fill_count").int(), 5);
    assert!(!summary.get("total_fees").str().is_empty());
    assert_eq!(summary.get("volume").get("BTC-USD").str(), "0.9");
    assert_eq!(summary.get("volume").get("ETH-USD").str(), "4.12345678");
    assert_eq!(sorted(summary.get("vwap").keys()), vec!["BTC-USD", "ETH-USD"]);

    let accounts: Vec<(String, u64, String, String)> = report
        .get("accounts")
        .arr()
        .iter()
        .map(|a| {
            assert_eq!(sorted(a.keys()), vec!["account", "fees", "trades", "volume"]);
            (
                a.get("account").str().to_string(),
                a.get("trades").int(),
                a.get("volume").str().to_string(),
                a.get("fees").str().to_string(),
            )
        })
        .collect();
    let expected = [
        ("alice", 1, "0.35", "2.1007"),
        ("bob", 2, "0.55", "5.998775"),
        ("carol", 1, "0.3", "1.7994"),
        ("dave", 2, "0.6", "9.0024375"),
        ("erin", 1, "4", "1.4802"),
        ("frank", 1, "4", "3.7005"),
        ("grace", 1, "0.12345678", "0.04571284"),
        ("heidi", 1, "0.12345678", "0.11428209"),
    ];
    let expected: Vec<(String, u64, String, String)> = expected
        .iter()
        .map(|(a, t, v, f)| (a.to_string(), *t, v.to_string(), f.to_string()))
        .collect();
    assert_eq!(accounts, expected);
}

#[test]
fn json_to_stdout_with_quiet_prints_only_the_report() {
    let out = matchbook(
        &[
            "run",
            "examples/orders.txt",
            "--config",
            "examples/matchbook.conf",
            "--quiet",
            "--json",
            "-",
        ],
        &[],
    );
    let report = parse_json(&stdout_of(&out));
    assert_eq!(report.get("fills").arr().len(), 5);
}

// ------------------------------------------------------------ CLI surface --

#[test]
fn text_summary_for_the_example_session() {
    let out = matchbook(
        &["run", "examples/orders.txt", "--config", "examples/matchbook.conf"],
        &[],
    );
    let stdout = stdout_of(&out);
    let lines: Vec<&str> = stdout.lines().collect();
    assert_eq!(lines[0], "strategy: fifo");
    assert_eq!(lines[1], "fills: 5");
    for expected in [
        "cancelled: order 6 (ioc_remainder)",
        "rejected: order 7 (post_only_would_cross)",
        "cancelled: order 3 (requested)",
        "rejected: order 9 (fok_not_fillable)",
        "cancelled: order 1 (self_trade)",
        "resting: BTC-USD bids=1 asks=0",
        "resting: ETH-USD bids=1 asks=0",
    ] {
        assert!(lines.contains(&expected), "missing `{expected}` in\n{stdout}");
    }
}

#[test]
fn strategies_command_lists_every_registered_strategy() {
    let stdout = stdout_of(&matchbook(&["strategies"], &[]));
    assert_eq!(stdout.lines().collect::<Vec<_>>(), vec!["fifo", "lmm", "pro_rata"]);
}

#[test]
fn explain_describes_every_order_kind() {
    let stdout = stdout_of(&matchbook(&["explain"], &[]));
    let labels: Vec<&str> = stdout
        .lines()
        .map(|line| line.split_whitespace().next().unwrap_or(""))
        .collect();
    assert_eq!(labels, vec!["limit", "market", "ioc", "fok", "post_only"]);
    assert!(stdout.lines().all(|line| line.split_whitespace().count() > 2));
}

#[test]
fn usage_errors_exit_with_status_2() {
    assert_eq!(matchbook(&["run"], &[]).status.code(), Some(2));
    assert_eq!(matchbook(&[], &[]).status.code(), Some(2));
    assert_eq!(
        matchbook(&["run", "examples/orders.txt", "--bogus"], &[]).status.code(),
        Some(2)
    );
    assert!(matchbook(&["help"], &[]).status.success());
}

#[test]
fn lmm_strategy_is_selected_by_name_from_a_config_file() {
    let scratch = Scratch::new("lmm");
    let orders = scratch.file(
        "orders.txt",
        "N,1,bob,X,sell,limit,100,1\nN,2,mm1,X,sell,limit,100,2\nN,3,carol,X,sell,limit,100,1\nN,4,taker,X,buy,limit,100,1\n",
    );
    let out = matchbook(
        &["run", &orders, "--config", "examples/lmm.conf", "--quiet", "--json", "-"],
        &[],
    );
    let report = parse_json(&stdout_of(&out));
    assert_eq!(report.get("strategy").str(), "lmm");
    let fills: Vec<(u64, String, String, String)> = report
        .get("fills")
        .arr()
        .iter()
        .map(|f| {
            (
                f.get("maker_order").int(),
                f.get("qty").str().to_string(),
                f.get("maker_fee").str().to_string(),
                f.get("taker_fee").str().to_string(),
            )
        })
        .collect();
    assert_eq!(
        fills,
        vec![
            (1, "0.6".to_string(), "-0.006".to_string(), "0.036".to_string()),
            (2, "0.4".to_string(), "-0.004".to_string(), "0.024".to_string()),
        ]
    );
}

#[test]
fn strategy_flag_overrides_the_config() {
    let scratch = Scratch::new("override");
    let orders = scratch.file(
        "orders.txt",
        "N,1,alice,X,sell,limit,100,1\nN,2,carol,X,sell,limit,100,3\nN,3,bob,X,buy,limit,100,2\n",
    );
    let out = matchbook(
        &[
            "run",
            &orders,
            "--config",
            "examples/matchbook.conf",
            "--strategy",
            "pro_rata",
            "--quiet",
            "--json",
            "-",
        ],
        &[],
    );
    let report = parse_json(&stdout_of(&out));
    assert_eq!(report.get("strategy").str(), "pro_rata");
    let qtys: Vec<&str> = report
        .get("fills")
        .arr()
        .iter()
        .map(|f| f.get("qty").str())
        .collect();
    assert_eq!(qtys, vec!["0.5", "1.5"]);
}

#[test]
fn config_without_strategy_runs_fifo() {
    let scratch = Scratch::new("default");
    let config = scratch.file("engine.conf", "maker_fee_bps = 1\ntaker_fee_bps = 3\n");
    let orders = scratch.file(
        "orders.txt",
        "N,1,alice,X,sell,limit,100,1\nN,2,carol,X,sell,limit,100,3\nN,3,bob,X,buy,limit,100,2\n",
    );
    let out = matchbook(&["run", &orders, "--config", &config, "--quiet", "--json", "-"], &[]);
    let report = parse_json(&stdout_of(&out));
    assert_eq!(report.get("strategy").str(), "fifo");
    let fills: Vec<(u64, String)> = report
        .get("fills")
        .arr()
        .iter()
        .map(|f| (f.get("maker_order").int(), f.get("qty").str().to_string()))
        .collect();
    assert_eq!(fills, vec![(1, "1".to_string()), (2, "1".to_string())]);
    assert_eq!(report.get("fills").arr()[0].get("maker_fee").str(), "0.01");
    assert_eq!(report.get("fills").arr()[0].get("taker_fee").str(), "0.03");

    let text = stdout_of(&matchbook(&["run", &orders], &[]));
    assert!(text.starts_with("strategy: fifo\n"), "{text}");
}

// ----------------------------------------------- reference price rate limit --

#[test]
fn reference_prices_are_fetched_one_at_a_time_and_spaced_out() {
    const INTERVAL_MS: u64 = 150;
    const SERVER_DELAY_MS: u64 = 60;

    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let addr = listener.local_addr().unwrap().to_string();

    let active = Arc::new(AtomicUsize::new(0));
    let max_active = Arc::new(AtomicUsize::new(0));
    let seen: Arc<Mutex<Vec<(Instant, String)>>> = Arc::new(Mutex::new(Vec::new()));

    let server = {
        let active = Arc::clone(&active);
        let max_active = Arc::clone(&max_active);
        let seen = Arc::clone(&seen);
        thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(20);
            let mut handlers = Vec::new();
            while handlers.len() < 3 && Instant::now() < deadline {
                match listener.accept() {
                    Ok((mut stream, _)) => {
                        let started = Instant::now();
                        let now_active = active.fetch_add(1, Ordering::SeqCst) + 1;
                        max_active.fetch_max(now_active, Ordering::SeqCst);
                        let active = Arc::clone(&active);
                        let seen = Arc::clone(&seen);
                        handlers.push(thread::spawn(move || {
                            stream.set_nonblocking(false).unwrap();
                            stream.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
                            let mut request = Vec::new();
                            let mut chunk = [0u8; 512];
                            while !request.windows(4).any(|w| w == b"\r\n\r\n") {
                                match stream.read(&mut chunk) {
                                    Ok(0) | Err(_) => break,
                                    Ok(n) => request.extend_from_slice(&chunk[..n]),
                                }
                            }
                            let request = String::from_utf8_lossy(&request).into_owned();
                            let symbol = request
                                .split("symbol=")
                                .nth(1)
                                .and_then(|rest| rest.split_whitespace().next())
                                .unwrap_or("")
                                .to_string();
                            seen.lock().unwrap().push((started, symbol.clone()));
                            thread::sleep(Duration::from_millis(SERVER_DELAY_MS));
                            let price = match symbol.as_str() {
                                "AAA" => "100",
                                "BBB" => "50",
                                "CCC" => "10",
                                _ => "1",
                            };
                            active.fetch_sub(1, Ordering::SeqCst);
                            let _ = write!(
                                stream,
                                "HTTP/1.0 200 OK\r\nContent-Type: text/plain\r\n\r\n{price}\n"
                            );
                        }));
                    }
                    Err(err) if err.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(5));
                    }
                    Err(err) => panic!("accept failed: {err}"),
                }
            }
            for handler in handlers {
                handler.join().unwrap();
            }
        })
    };

    let scratch = Scratch::new("refdata");
    let config = scratch.file(
        "engine.conf",
        &format!("price_band_bps = 500\nref_addr = {addr}\nref_interval_ms = {INTERVAL_MS}\n"),
    );
    let orders = scratch.file(
        "orders.txt",
        "N,1,s1,AAA,sell,limit,101,1\nN,2,b1,AAA,buy,limit,101,1\nN,3,s2,BBB,sell,limit,60,1\n\
         N,4,s3,CCC,sell,limit,10.2,1\nN,5,b2,CCC,buy,limit,10.2,0.5\n",
    );
    let out = matchbook(
        &["run", &orders, "--config", &config, "--quiet", "--json", "-"],
        &[("MATCHBOOK_REF_API_KEY", "hidden-test-key")],
    );
    let report = parse_json(&stdout_of(&out));
    server.join().unwrap();

    let seen = seen.lock().unwrap().clone();
    let mut symbols: Vec<&str> = seen.iter().map(|(_, s)| s.as_str()).collect();
    symbols.sort_unstable();
    assert_eq!(symbols, vec!["AAA", "BBB", "CCC"], "one request per symbol");
    assert_eq!(
        max_active.load(Ordering::SeqCst),
        1,
        "reference requests must never overlap"
    );
    let mut starts: Vec<Instant> = seen.iter().map(|(t, _)| *t).collect();
    starts.sort();
    for pair in starts.windows(2) {
        let gap = pair[1].duration_since(pair[0]);
        assert!(
            gap >= Duration::from_millis(INTERVAL_MS - 10),
            "requests only {gap:?} apart; expected at least {INTERVAL_MS}ms"
        );
    }

    let fills: Vec<(String, String)> = report
        .get("fills")
        .arr()
        .iter()
        .map(|f| (f.get("symbol").str().to_string(), f.get("qty").str().to_string()))
        .collect();
    assert_eq!(
        fills,
        vec![
            ("AAA".to_string(), "1".to_string()),
            ("CCC".to_string(), "0.5".to_string()),
        ]
    );
    let rejections: Vec<(u64, &str)> = report
        .get("rejections")
        .arr()
        .iter()
        .map(|e| (e.get("order").int(), e.get("reason").str()))
        .collect();
    assert_eq!(rejections, vec![(3, "outside_price_band")]);
}
