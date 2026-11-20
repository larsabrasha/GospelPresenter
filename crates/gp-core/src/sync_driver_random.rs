// The sync driver against a shell that answers at random (sync_driver.rs): pokes, asks to sync, the socket opening,
// closing and failing, start and close, and every request answered in any order with a page, more pages, a server
// error, a refusal or no answer at all. After every step what must always hold; at the end, once every answer is in,
// every run asked for has ended and the device is idle.
use super::*;
use std::collections::BTreeSet;

/// xorshift64*: the same runs for the same seed, without a crate for it.
struct Rand(u64);

impl Rand {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        self.0.wrapping_mul(0x2545_f491_4f6c_dd1d)
    }
    fn below(&mut self, n: u64) -> u64 { self.next() % n }
    fn chance(&mut self, percent: u64) -> bool { self.below(100) < percent }
}

/// What the shell was told to do and has not answered yet.
#[derive(Debug, Clone, PartialEq)]
enum Out { Post { pull: bool }, BeforePush, Rebase, Socket, Timer(&'static str) }

struct Shell {
    st: State,
    out: Vec<Out>,
    /// The socket the shell holds, once its opening was answered.
    open: bool,
    /// The runs promised to an ask and not ended yet, and the last run ended.
    waiting: BTreeSet<i64>,
    last: i64,
    pages: usize,
}

impl Shell {
    fn new(hooks: bool) -> Shell {
        Shell { st: fresh(PROTOCOL_VERSION, hooks), out: vec![], open: false, waiting: BTreeSet::new(), last: 0, pages: 0 }
    }

    /// The event given, what it says done as a shell does it, and what must always hold checked.
    fn send(&mut self, ev: Event, r: &mut Rand) {
        let (st, dos) = step(&self.st, &ev);
        self.st = st;
        let mut todo: std::collections::VecDeque<Do> = dos.into();
        while let Some(d) = todo.pop_front() {
            match d {
                Do::Queued(n) => {
                    assert!(n > self.last, "run {n} promised after it ended");
                    self.waiting.insert(n);
                }
                // The queue empty, or a request to send, as the view resolves it.
                Do::Push(_) if r.chance(30) => {
                    let (st, more) = step(&self.st, &Event::NothingToPush);
                    self.st = st;
                    for (i, d) in more.into_iter().enumerate() { todo.insert(i, d) }
                }
                Do::Push(_) => self.out.push(Out::Post { pull: false }),
                Do::Pull(_) => self.out.push(Out::Post { pull: true }),
                Do::BeforePush => self.out.push(Out::BeforePush),
                Do::KeepPage => self.pages += 1,
                Do::Rebase => {
                    assert!(self.pages > 0, "a rebase with no page kept");
                    self.out.push(Out::Rebase);
                }
                Do::Ended { run, .. } => {
                    assert!(self.last < run, "run {run} ended after {}", self.last);
                    self.last = run;
                    self.waiting.remove(&run);
                    self.pages = 0;
                }
                Do::Idle | Do::Media => {}
                Do::OpenSocket => {
                    assert!(!self.open && !self.out.contains(&Out::Socket), "a second socket opened");
                    self.out.push(Out::Socket);
                }
                Do::CloseSocket => {
                    self.open = false;
                    self.out.retain(|o| *o != Out::Socket);
                }
                Do::Timer(name, _) => {
                    self.out.retain(|o| *o != Out::Timer(name));
                    self.out.push(Out::Timer(name));
                }
                Do::CancelTimers => self.out.retain(|o| !matches!(o, Out::Timer(_))),
            }
        }
        self.holds();
    }

    fn holds(&self) {
        let s = &self.st;
        assert_eq!(s.busy, s.phase != Phase::Idle, "busy and the phase disagree: {s:?}");
        let requests = self.out.iter().filter(|o| matches!(o, Out::Post { .. } | Out::BeforePush | Out::Rebase)).count();
        assert!(requests <= 1, "{requests} requests out at once: {:?}", self.out);
        assert_eq!(requests == 1, s.busy, "a run with nothing out, or something out with no run: {:?} {s:?}", self.out);
        if s.stopped.is_some() { assert_eq!(s.socket, Socket::Closed, "a socket open while stopped") }
        assert_eq!(self.open, s.socket == Socket::Open, "the shell's socket and the driver's disagree");
        // Idle, every run promised to an ask has ended: none waits for a run nobody will start.
        if !s.busy { assert!(self.waiting.is_empty(), "idle with runs asked for and not ended: {:?}", self.waiting) }
        if !s.started { assert!(!self.out.iter().any(|o| matches!(o, Out::Timer(_) | Out::Socket)), "a timer or a socket after closing") }
    }

    /// One thing out answered: which one, and how, at random.
    fn answer(&mut self, i: usize, r: &mut Rand) {
        let o = self.out.remove(i);
        let ev = match o {
            Out::Post { pull } => match r.below(100) {
                0..=2 => Event::Answer { status: 426, body: json!({ "error": "update-required" }) },
                3..=5 => Event::Answer { status: 401, body: json!({ "error": "unauthenticated" }) },
                6..=11 => Event::Answer { status: 500, body: Value::Null },
                12..=19 => Event::Failed("offline".into()),
                _ if pull => Event::Answer { status: 200, body: json!({ "cookie": "c", "more": r.chance(30), "patch": [], "results": [] }) },
                _ => Event::Answer { status: 200, body: json!({ "lastMutationId": 1, "results": [] }) },
            },
            Out::BeforePush if r.chance(10) => Event::Failed("upload failed".into()),
            Out::BeforePush => Event::PushLimit(r.below(3) as usize),
            Out::Rebase if r.chance(5) => Event::Failed("FOREIGN KEY constraint failed".into()),
            Out::Rebase => Event::Rebased,
            Out::Socket if r.chance(70) => {
                self.open = true;
                Event::SocketOpened
            }
            Out::Socket => Event::SocketClosed,
            Out::Timer(name) => Event::Timer(name.into()),
        };
        self.send(ev, r);
    }

    /// Something from outside: the person, the server or the network.
    fn outside(&mut self, r: &mut Rand) {
        let ev = match r.below(10) {
            0..=2 => Event::Sync { parts: BOTH, media: false },
            3 => Event::Sync { parts: Parts { push: r.chance(50), pull: r.chance(50) }, media: false },
            4 | 5 => Event::Poke,
            6 => Event::Start,
            7 => Event::Close,
            _ if self.open => {
                self.open = false;
                Event::SocketClosed
            }
            _ => Event::Poke,
        };
        self.send(ev, r);
    }
}

#[test]
fn random_events_keep_the_drivers_rules_and_every_run_asked_for_ends() {
    for seed in 1..=300u64 {
        let mut r = Rand(seed.wrapping_mul(0x9e37_79b9_7f4a_7c15) | 1);
        let mut shell = Shell::new(seed % 2 == 0);
        for _ in 0..2_000 {
            if !shell.out.is_empty() && r.chance(60) {
                let i = r.below(shell.out.len() as u64) as usize;
                shell.answer(i, &mut r);
            } else {
                shell.outside(&mut r);
            }
        }
        // Every answer in, the poll and the reconnects left to wait: each run asked for has ended.
        while let Some(i) = shell.out.iter().position(|o| !matches!(o, Out::Timer(_))) { shell.answer(i, &mut r) }
        assert!(!shell.st.busy, "seed {seed}: busy with nothing out");
        assert!(shell.waiting.is_empty(), "seed {seed}: runs asked for and never ended: {:?}", shell.waiting);
    }
}
