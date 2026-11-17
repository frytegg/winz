# Operations

The boring failures. None of them is interesting, all of them can end a demo, and every one
in this file actually happened.

---

## The pre-flight must be able to say no

Write one command that brings the whole demonstration up **and judges whether it is
presentable**. A script that only knows how to print "ok" tells you nothing.

Ours refused to pass when a demo facility's time window had expired, because an expired
window serves negative countdowns that look like a bug on stage.

What it should do, in order:

1. **Check free memory** and say so, against a threshold you have actually measured.
2. **Kill stale processes** from earlier runs, by matching the command line, and say how many.
3. **Start the backend**, wait for its health endpoint, and print the last log lines if it
   never comes up.
4. **Judge the demo state**: is the data still valid, are the time windows still open, is
   anything expired or in the wrong phase? Refuse to claim success if not, and print the
   command that fixes it.
5. **Start the frontend**, wait for it to answer.
6. **Print the links** — product, deck, run of show, hard questions — and any warning.

A skeleton is in `assets/preflight.sh`.

---

## Scope the rule to the hazard, not to the network

A safety rule written in Phase A is almost always written too wide, because at that point the cheapest way to
be safe is to forbid a whole category. Then it silently removes your best evidence and nobody reopens it.

Ours read: **"Mainnet is read-only. No transaction is built, evaluated or submitted against a mainnet
escrow."** It was written to protect other people's money, which is correct. What it also did was make it
impossible to demonstrate on mainnet *at all* — including on an escrow we would have created ourselves, with
our own funds, on a contract whose exit we had already exercised eleven times on a test network with an
identical script hash. Cost: about twenty ADA. Benefit: the demo would have acted on the same object the
pitch was about.

**The rule should have been about the hazard:** never act on a third party's funds, never cause an
irreversible effect on someone who did not consent. Acting on assets you own is not the hazard, and a rule
that forbids it is protecting nobody.

So, for every safety rule you write:

- **Name the hazard in the rule itself**, not the surface. "No third-party funds" rather than "no mainnet".
- **Check whether the rule forbids any action whose only victim is you.** If it does, narrow it.
- **Re-read all of them at T-24h**, when you know what the demo needs. A rule that was free in Phase A can be
  the most expensive line in the project by then.

This is not a licence to relax a rule because it has become inconvenient. The test is whether the hazard the
rule names is actually present, and a narrowing is written down with its reasoning like any other decision.

---

## The visibility calendar

**Applies when** your work is private while you build it and has to be public to be judged. A remote bounty, a
grant application, a submission with a repository link. **Does not apply** at a live event, where everything is
public the moment you present it.

Two forces pull against each other. Staying private protects the idea from being copied by people in the same
channels as you. Going public is the only way to test the one path you cannot otherwise test: **the judge
fetching your work from where they will fetch it.**

The second force is stronger than it looks, and it is easy to miss. Everything else can be proven privately. A
generator can build from a local copy, tests run anywhere, a reviewer can read a branch. But the fetch itself,
the one command a judge types, is the step that only exists once the thing is public.

**The rule:** go public early enough to run that fetch twice from a clean directory, and never on the day you
travel or the day you submit.

Our calendar, as an example rather than a template: private until two days before the deadline, then flip, then
run the judge's own command in the two forms they might use, boot the result, dispatch the full check matrix,
**and only then submit the form** — because the form carries the link, and a form submitted before the link is
live is a link that returns 404 to whoever opens it first.

Two facts worth knowing before you plan this:

- **Making a public repository private again does not undo a fork.** Forks made while it was public survive as
  independent public repositories. Going back is a door closing, not an undo.
- **Stars, watchers and similar signals are erased** by that round trip on some platforms.

And the honest weighting: what a competitor can copy in two days is your framing, not your evidence. If your
submission rests on a shape that can be copied in an afternoon, the visibility calendar is not your problem.

## Memory

The demo backend was killed three times in one night, always under 1 GB free. It is the
newest process, so it is first in line when the system starts reclaiming.

An hour before the pitch, on the machine that will present:

- Measure free memory. Below ~2.5 GB, act.
- Look at **what is actually using it**, grouped by process name. On our machine the whole
  demo used 233 MB across three processes; the browser used 4.6 GB across twenty-six.
- Close the chat client, the second browser, the VPN. Reboot if there is time.
- Keep **one** browser window with only the tabs the demo needs.

Do not optimise the demo. Close the browser tabs.

It came back at XRPL NYC, three times in two days: 0.5 GB free during the build with the browser at
6 GB of 15.7, and the live fallback servers found killed after the event. Put the memory check in
the minutes before the slot, not only in the morning pre-flight: the fallback must be alive when a
judge asks for it, not when you last looked.

---

## The account's usage limit

**Applies when** agents build, audit or fix while you are not watching, and above all when several
sessions share one account.

The account's usage is a resource exactly like memory, and it fails the same way: the newest, largest
consumer takes it, and everything else stops with it. At XRPL NYC an audit launched by the autonomous
build lane ran **408 agents through 17.7 million tokens in 27 minutes**, on the same account as a
nine-agent pricing study. The session limit hit at 23:54, the build lane died at 00:06, the limit reset
at 01:00 and nothing restarted. The night of the hackathon was lost. The risk had been written in the
teammate's prompt two days earlier: *"Samedi doit commencer avec du quota"*. Nothing enforced it, and
the standing decision that authorised the lane's workflows had no ceiling.

- **A fan-out ceiling per account, written into every standing decision** an autonomous lane runs
  under. Not per session: the account is what runs out.
- **Know which limit applies and when it resets** — a rolling session window and a weekly cap are
  different clocks — and schedule the heavy passes right after a reset, never just before the night.
- **Arm the wake-up before you approach the limit.** Ours was being set up when the limit landed, so
  it never existed.
- **A resume reads what already finished.** The audit was 70 % done when it stopped. Restarting it
  from zero would have spent the morning a second time.
- **Size the tool to the edit.** A one-hour workflow to insert a few lines of spec is a cost the owner
  pays in hours. In the last three hours before the deadline, no workflows at all.

---

## Orphan processes and ports

A dev server from an earlier run holds the port, and the new one dies with a bind error that
reads as "the code is broken" rather than "something else is listening".

- **Find the port owner** before killing anything: list what is listening, get the process
  id, and kill everything *except* that.
- Watch for **wrapper chains**: a package-manager wrapper spawning the real server means
  three processes per dev server, and killing the parent can orphan the child.
- Background tasks that were killed by the system leave residue holding memory. Sweep them.

We once had eleven node processes for what should have been two: three dev servers, their
wrappers, and the remains of a documentation preview the system had killed for memory.

---

## Time-limited demo state

If the demo depends on data with lifetimes — expiring windows, phases, sessions, tokens —
then the demo has an expiry and you must know it.

- **Know when it expires**, to the minute, and write it in the run of show.
- **Have a rebake command** that recreates everything, and know how long it takes.
- **Re-run the pre-flight after rebaking.** Ours had a failure where the rebake overwrote a
  successful captured artifact with a failed one, because the service reads its data at
  startup and the data had just been recreated. The committed evidence then showed the
  feature failing. A repair script exists now because of it.

### Consumable demo state

Expiry is one way demo state dies. **Consumption is the other**: any irreversible action the demo
performs — a default, a liquidation, an escrow that locks shares — can be performed once per baked
object.

At XRPL NYC the takes for the video consumed the default of the late loan on two of the three demo
vaults, and the agent integrating the audit fixes locked six million shares in escrow on the demo
accounts.
The morning of the submission, no vault was left whose late loan could still default. A rebake ran from
12:00 to 12:14 for a 13:00 deadline.

- **Count the units.** Every irreversible beat is one unit per take. Bake one per planned take, one for
  the live fallback, and one spare.
- **No agent and no test touches the demo accounts.** Give them their own.
- **Rebake by T-3h at the latest**, and write the rebake's duration in the run of show.

---

## Networks and evidence decay

If your evidence lives on a shared test network, it can be pruned or reset. Ours kept
roughly 29 days.

- Re-verify hashes before citing them anywhere public.
- Prefer evidence you can regenerate to evidence you cannot.
- Keep the capture files in the repository, not only in a gitignored fixtures directory. A
  route that reads from an untracked directory returns a 404 on a clean clone, which is what
  a judge gets.

---

## Links and third-party viewers

Check every external link by fetching it. Public explorers often have no route for the
object type you are linking to, and a single-page app returns `200` for a route it will then
render as not-found — so a status check is not enough.

Where an explorer has no route for an object, link **the transaction that last wrote it**,
and print the object identifier as text next to the request that fetches it directly. That
is better than a link: it does not depend on anyone else's uptime or routing, and it cannot
404 on stage.

---

## The machine you present from

- Activate the operating system, or every recording and screenshot carries a watermark.
- Set the browser zoom before rehearsing, and do not change it after.
- One window, no tab strip clutter, notifications off.
- Know which screen the projector mirrors, and rehearse the switch.
- Have the run of show and the hard-questions file open **somewhere that is not the presented
  screen** — a phone, a second device, paper.
