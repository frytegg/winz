# Recording readiness: screens a judge can read in a compressed video

Read when: the profile's `format` block has a video, a stage or a projector zoom; you build record mode or mark key text; or you write the recording spec at hand-over.

## Purpose
Judges may see only the recording, and they see a smaller, re-encoded copy of it [FD20-F01, FD20-F03]. /frontend does not record: it makes every screen pass the recording gates (`recording.g01` to `recording.g16`, part of `--phase build` only when the profile has a video format, CONTRACTS 4) and writes the recording spec for the later phase. The order stays build complete, harden, fix, record, ship, and the owner signs off the deployed preview at recording size (H3) before anything is recorded [FD13-F19].
Related files: record-mode markers in `06-build.md`, the Ledger mirror panel in `07-states-web3.md`, motion budgets in `08-motion.md`, the profile block in `00-contract.md`.

## Rules

### RC-01 - Treat the recording as the judged surface where judges review asynchronously
- **Rule:** Read `format` from the profile. Where judges review a recording (Devpost, TOKEN2049 track judging, ETHGlobal partner prizes), make every feature and its proof legible in a 3-minute screen recording that the judge cannot interact with, and make the live URL tell the same story as the video.
- **Why:** Devpost judges "may choose to judge based solely on the text description, images, and video"; TOKEN2049 Origins prohibits live demos and wants the recording embedded in the slides, while also collecting a repo and a live URL [FD20-F01]. The event format decides the target surface [FD13-F13].
- **Check:** owner review (H3, at recording size)
- **Not when:** live judging (ETHGlobal in person, the OP3N final): the recording is a backup surface [FD20-F01].

### RC-02 - Ship a record mode
- **Rule:** `?record=1` serves a named fixture or snapshot, fixes the displayed clock, seeds randomness, freezes decorative loops, marquees, blinking badges, grain and cursor-following effects, renders hover-only content at rest, and keeps every provenance label. The page freezes itself before capture, and record-mode fixtures load no font from the network. Where the app already has a frozen mode (BNB's `?frozen=1`), make `?record=1` select it.
- **Why:** Playwright's clock and HAR replay work only in a Playwright-driven browser, so the real recording needs the app's own fixture mode; FD20's checker froze animations itself and still captured a blinking badge at different opacities across runs [FD20-F20] [FD20 Record-mode contract]. BNB's design panel added `?frozen=1` so a network blip never ruins a take [FD13-F14].
- **Check:** recording.g08, recording.g12; `coverage.features` also runs in record mode (`06-build.md`).
- **Not when:** never.

### RC-03 - Label provenance on every data region
- **Rule:** Every data region shows, as visible text, live, testnet (with the chain and network name) or simulated, plus an as-of time or block height; the same values sit in `data-source` and `data-as-of` (CONTRACTS 6.6). A simulated value is never styled as on-chain proof.
- **Why:** A demonstration presented as proof must be genuine or disclosed (FTC v. Colgate-Palmolive, 1965); Devpost asks for "a clear demo of your project functioning" [FD20-F21].
- **Check:** recording.g13, coverage.metrics
- **Not when:** never.

### RC-04 - Mark key text and size it for the 540p copy
- **Rule:** Put `data-rec-role="key"` on the claim, the proof values, the state labels and the provenance labels, and `data-rec-role="decor"` on text nobody needs to read. Key text keeps at least 6.5 px of x-height in the 540p copy: Inter at 24 px or more in the 1920x1080 capture. For another face, size from its x-height (Inter's is 0.547 em).
- **Why:** Over 2,640 OCR crops, 24 px held 48 of 48 exact reads in a 540p copy and 20 px fell to 36; reliable reads needed about 6.5 px of x-height in the delivered frame [FD20-F04]. Console and TV norms ask for 26 px at 1080p [FD20-F05].
- **Check:** recording.g03
- **Not when:** never.

### RC-05 - Keep all other readable text at 16 px, and aim for 18
- **Rule:** Any text a judge must read keeps at least 5.8 px of x-height in the 720p copy (Inter 16 px; below fails) and aims for 6.5 px (Inter 18 px). Measure the rendered glyph, not the CSS size.
- **Why:** In a 720p copy, 18 px held 47 to 48 exact reads of 48, 16 px 36 to 41, 14 px 19 to 27 [FD20-F04]. Xbox guidance sets 18 px of body height at 1080p on PC, measured on the glyph [FD20-F05].
- **Check:** recording.g01 (fail), recording.g02 (warn)
- **Not when:** text marked `data-rec-role="decor"`.

### RC-06 - Add one size step for thin weights and red on dark
- **Rule:** Text at weight 300 or lighter, and red text on a dark ground, starts at 18 px.
- **Why:** At 720p, weight-300 text and red on near-black read reliably only from 18 px, against 14 px for ink on white and 16 px for grey text or blue on near-black, so blue does not need the step [FD20-F08].
- **Check:** recording.g04
- **Not when:** blue on dark.

### RC-07 - Measure contrast on rendered pixels against the worst background
- **Rule:** Meet WCAG 1.4.3 (4.5:1, or 3:1 for large text) against the lowest-contrast pixel behind the text, measured on the screenshot.
- **Why:** Xbox guidance measures text over a non-solid background against its lowest-contrast area, and low contrast cost a size step in the delivered copy [FD20-F08].
- **Check:** recording.g05
- **Not when:** never.

### RC-08 - Lay out the first screen for 1536x864 and record at 125%
- **Rule:** Build the first viewport for 1536x864 CSS px with the key elements inside it, and allow no horizontal overflow at 1536 or 1280 CSS px. Add a profile viewport that emulates the zoom the way FD20's checker did: 1536x864 with a device scale factor of 1.25. Recommend recording at 125% browser zoom on a 1920x1080 screen.
- **Why:** At 125% and 150% zoom a 1920x1080 screen offers 1536x864 and 1280x720 CSS px, and recording at 125% makes every CSS size 1.25 times larger in the video [FD20-F19]. The XRPL stage ran at 110-125% zoom [FD13-F13].
- **Check:** recording.g14
- **Not when:** never.

### RC-09 - Keep recorded screens free of dark gradients and grain
- **Rule:** Recorded screens use flat surfaces or steep gradients. No large gradient whose stops all sit below relative luminance 0.1, no coloured glow on near-black, no grain or noise layer. CAMBI on the simulated 720p copy stays at 5 or below.
- **Why:** Dark hero gradients scored CAMBI 10 to 20 in a 720p H.264 copy against 0 for a light one, and the browser's own dither was erased [FD20-F09]. The encoder erased animated grain; static grain cost 48% more bytes and did not stop banding [FD20-F10].
- **Check:** recording.g07, recording.g08
- **Not when:** never.

### RC-10 - Carry structure with 2 px lines, fills or space
- **Rule:** Structure a judge must see (table rules, card edges, dividers) uses 2 px lines, fills or spacing, never a 1 px border below 1.5:1.
- **Why:** 1 px hairlines lost much of their contrast at 720p (1.48:1 fell to 1.20:1) while 2 px lines held [FD20-F11].
- **Check:** recording.g09
- **Not when:** a decorative separator nobody needs.

### RC-11 - Keep dark surfaces distinguishable
- **Rule:** In a dark theme, adjacent surfaces differ by at least 1.1:1 or carry a border. The recording spec states the colour range, and the master's `color_range=tv` is checked with ffprobe before it goes into a deck.
- **Why:** A full-range master mistagged as limited range decoded #0a0a0a, #0f0f0f and #111111 as one black, and YouTube converts full range to limited [FD20-F12].
- **Check:** recording.g10
- **Not when:** a light theme.

### RC-12 - Render everything a judge needs at rest
- **Rule:** Every explanation, value and status a judge must see is visible at rest. No text appears only on hover, and no key element relies on a `title` tooltip. Script a hover in the recording only for an explicitly listed moment.
- **Why:** Hover-only content is absent from a recording unless someone scripts the hover, and `title` tooltips are drawn outside the page's pixels [FD20-F15]. Judges do not hover [FD11-F27].
- **Check:** recording.g11
- **Not when:** never.

### RC-13 - Time motion for a 25 to 30 fps video
- **Rule:** A state change that carries proof settles within 400 ms, then holds still for at least 0.33 s per word of its label and never less than 1.2 s. Nothing blinks faster than 333 ms per cycle. Decorative loops freeze in record mode. Scroll only between states, never while a value must be read.
- **Why:** UI animations run 100 to 500 ms; subtitles allow about 0.3 s per word; WCAG 2.3.2 forbids more than three flashes in any second. The 400 ms settle and the 0.33 s per word are FD20's design choices from these sources [FD20-F16].
- **Check:** recording.g12
- **Not when:** never.

### RC-14 - Size for the room at stage and projector events
- **Rule:** For a projected demo, prefer light surfaces, or give a dark UI text of 7:1 or more; text must keep 4.5:1 at a 15:1 projector floor. Set the claim and the proof values at 32 to 48 CSS px for the back rows; body text is for the front row. When the room's dimensions are known, size from the DISCAS formula.
- **Why:** Projectors lift black: grey-500 on near-black falls from 4.10:1 to 3.20:1 at the 15:1 minimum for basic decision making [FD20-F17]. By AVIXA DISCAS, 32 px at 125% zoom reads to about 4 image heights and 16 px to about 2 [FD20-F18].
- **Check:** recording.g06; owner review of the room.
- **Not when:** flat panels and laptops: PISCR covers projection only and DISCAS excludes single-user displays [FD20-F17, FD20-F18].

### RC-15 - Mirror the Ledger device step in the page
- **Rule:** In a Ledger flow, the page shows the device's current step from `requiredUserInteraction` (`07-states-web3.md`, WS-22). In development use Speculos's screenshot; for a final, film the real device or show the emulator side by side, labelled as the emulator.
- **Why:** The device screen is off camera, and Speculos serves the device display with screenshots [FD20-F22].
- **Check:** recording.g15
- **Not when:** the project uses no Ledger.

### RC-16 - Let the picture tell the story without sound
- **Rule:** Each state on the demo path carries a short on-screen label of what just happened (the action, and its block or time), so the video reads muted. Captions go into the picture, never into a separate track.
- **Why:** Muted players rely on on-screen text, WCAG 1.2.2 requires captions, and PowerPoint's media compression drops caption tracks [FD20-F23, FD20-F02]. BNB's plan records 1920x1080 with subtitles burned in because judges may watch muted [FD13-F14].
- **Check:** critic
- **Not when:** never.

### RC-17 - Use the blind read as a message check only
- **Rule:** Show a fresh probe the 540p first frame and ask only what the product is, what it does and what proves it. A failed read means the frame does not carry the message. A pass proves nothing about legibility or about any number; the size gates decide those.
- **Why:** A model read 9 to 16 px text in degraded copies where OCR failed, and swapped plausible digits and words (two frames, one reader, grade C) [FD20-F07].
- **Check:** critic (`frontend-probe`, `12-critique.md`)
- **Not when:** never.

### RC-18 - Write the recording spec; do not record
- **Rule:** At hand-over, write `receipts/recording-spec.md` in the state directory. It names: a native 1920x1080 capture at 30 fps with no rescale, in OBS with an MKV or Hybrid MP4 master (Screen Studio is macOS only and the owner records on Windows); an enlarged, high-contrast system pointer, or a recorder with cursor effects; an MP4 export in H.264 High, 4:2:0, BT.709 tags, limited range, AAC 48 kHz and fast start, never HEVC; captions burned in; a human voice where the platform requires one; the 1080p preset if the deck must shrink; the colour-range check; the commands below. Playwright's `recordVideo` is never the master.
- **Why:** Microsoft recommends MP4 with H.264 and AAC for PowerPoint, sells HEVC playback for Windows as a Store add-on, and its media compression drops caption tracks [FD20-F02]. Playwright's recorder defaults to 800x800 at a fixed 1 Mbps VP8 and draws no pointer [FD20-F13, FD20-F14]. OBS's Hybrid MP4 survives a crash, and YouTube wants the moov atom first [FD20-F24]. ETHGlobal and Devpost want a human voice [FD20-F23].
- **Check:** owner review
- **Not when:** never.

### RC-19 - Deliver decks as .pptx or a single-file .key
- **Rule:** Embed the H.264 MP4 in a .pptx or a single-file Keynote .key. Never save as 97-2003 .ppt. Get the organisers' confirmation that .pptx counts. Before submitting, download the deck from its Drive link on another machine and play the video in Slide Show.
- **Why:** Saving as 97-2003 .ppt converts an embedded video into a still picture, and IANA lists the Keynote extension as .key, not .keynote [FD20-F25]. TOKEN2049 asks for ".ppt or .keynote" through Google Drive [FD13-F13].
- **Check:** recording.g16
- **Not when:** the event has no deck.

### RC-20 - Simulate the judge's copy during the build
- **Rule:** Run the recording gates on the built page during the build, not after recording. They treat the 720p copy as the normal case and the 540p view (a small player, a slide pane) as the worst case.
- **Why:** Streaming platforms serve a smaller re-encoded copy [FD20-F03]. FD20 puts the judge-copy simulation in the build gate [FD20-F24].
- **Check:** `node ~/.claude/skills/frontend/scripts/frontend-check.mjs --json --gates recording --serve <ui>/dist --profile <abs profile>`
- **Not when:** the profile has no video format.

## Recording gates [FD20 Gates]

| gate | checks | threshold | FD20 severity | rule |
|---|---|---|---|---|
| recording.g01 | text a judge must read | x-height in the 720p copy 5.8 px or more (Inter 16 px) | fail | RC-05 |
| recording.g02 | comfortable reading text | x-height in the 720p copy 6.5 px or more (Inter 18 px) | warn | RC-05 |
| recording.g03 | key text (`data-rec-role="key"`) | x-height in the 540p copy 6.5 px or more (Inter 24 px) | fail | RC-04 |
| recording.g04 | weight 300 or lighter, red on dark | one step up (18 px or more) | warn | RC-06 |
| recording.g05 | contrast on pixels, worst background | 4.5:1, or 3:1 for large text | fail | RC-07 |
| recording.g06 | projector contrast | 4.5:1 at a 15:1 system floor | warn | RC-14 |
| recording.g07 | banding | CAMBI 5 or below on the 720p copy; dark gradients flagged | fail / warn | RC-09 |
| recording.g08 | grain and noise overlays | none in record mode | warn | RC-09 |
| recording.g09 | hairlines | structural 1 px borders below 1.5:1 become 2 px or fills | warn | RC-10 |
| recording.g10 | dark surfaces | steps of 1.1:1 or more; master `color_range=tv` | warn, manual | RC-11 |
| recording.g11 | hover-only content | no text revealed only on hover; no `title` tooltips on key elements | fail / warn | RC-12 |
| recording.g12 | motion | no blink under 333 ms per cycle; loops frozen; proof states held | fail / warn / manual | RC-13 |
| recording.g13 | provenance | every data region labelled with an as-of time or block | warn | RC-03 |
| recording.g14 | zoom | no overflow at 1536 and 1280 CSS px; key elements in the first viewport | fail / warn | RC-08 |
| recording.g15 | Ledger device steps | `requiredUserInteraction` mirrored in the page | manual | RC-15 |
| recording.g16 | deck format | .pptx or single-file .key, MP4 embedded, played from the Drive copy | manual | RC-19 |

The copies a judge sees [FD20 Recording profile]: the master (1920x1080, 30 fps); the stream copy (1280x720, H.264 4:2:0, about CRF 23: YouTube, Loom Starter, PowerPoint HD); the slide-pane copy (about 960x540, derived, not sourced); the projector (1920x1080 at 125% or 150% zoom, 1536x864 or 1280x720 CSS px).

## Event profiles
Rules move: re-fetch each event's rules before relying on a line here [FD20-F01, FD13-F32].

| event | judged surface | facts that bind the screens | gates and rules to stress |
|---|---|---|---|
| TOKEN2049 Origins (6-7 Oct, SGT) | a recording embedded in the slides; repo and live URL also submitted; top 5 present live on stage | live demos prohibited; Cardano track video of 3 minutes or less; slides via Google Drive as ".ppt or .keynote", read as .pptx or .key; Cardano track scores UX at 20% and asks if "someone new to blockchain" understands quickly; small mode [FD13-F13, FD13-F26, FD13-F32, FD20-F01] | g03 and g06 (stage screen), g16, RC-17 as the "new to blockchain" check [FD20 Per event] |
| Ledger OP3N (build 6-13 Oct, final 16 Oct, Paris) | a live 5-minute pitch and 5 minutes of Q&A, live demo preferred; a short video in the submission | projector at the presenting machine's zoom; self-hosted fonts; one before/after screen pair and one live step [FD13-F13, FD13-F27] | g14, g06, g15; key text at 32-48 CSS px [FD20 Per event] |
| BNB (submit 11 Oct, 12:00 UTC) | a deployed link ("A live URL is best") and a demo video under 4 minutes, preferred by the organiser and treated as required by the owner | capture 1920x1080, no face cam, subtitles burned in, possibly watched muted; one HTTP response with no CDN or external font; `?frozen=1` for takes; freeze 3 Oct, no deploys 4-8 Oct [FD13-F13, FD13-F14, FD13-F28] | g01 to g03 on the numbers, g13 on every figure, g12 (freeze tickers), on-screen state labels [FD20 Per event] |
| ETHGlobal | in person: a live 4-minute demo and 3 minutes of Q&A, video optional; partners judge from materials | an uploaded video runs 2 to 4 minutes, at 720p or more, with a human voice [FD20-F01, FD20-F23, FD11-F21] | all gates when a video is submitted |
| Devpost (template seen) | text, images and video may be all a judge reviews | video under 3 minutes, public on YouTube, with audio narration [FD20-F01] | all gates |

## Procedure
1. Read `format` from the profile. If it has a video, set `record_mode: true` and add the 1536x864 viewport at device scale 1.25 (RC-08).
2. Build record mode and its fixtures (RC-02); label provenance on every data region (RC-03).
3. Mark key and decor text (RC-04).
4. Run the recording gates (RC-20). Fix in this order: overflow (g14), key text (g03), other text (g01, g02, g04), contrast (g05, g06), hover (g11), gradients and grain (g07, g08), lines and surfaces (g09, g10), motion (g12), provenance (g13).
5. Run the blind read through `frontend-probe` (RC-17).
6. At hand-over, write the recording spec (RC-18) with these commands, each run by FD20 [FD20 ffmpeg recipes]:
   - judge's 720p copy of a capture (use `960:540` for the slide-pane copy): `ffmpeg -loop 1 -framerate 30 -t 2 -i capture-1080.png -vf "scale=1280:720:flags=bicubic:out_color_matrix=bt709:out_range=tv,format=yuv420p,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv" -c:v libx264 -crf 23 judge-720.mp4`
   - deck master from an MKV or Hybrid MP4: `ffmpeg -i master.mkv -vf "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv" -c:v libx264 -preset slow -crf 18 -c:a aac -b:a 192k -ar 48000 -movflags +faststart deck-video.mp4`
   - tag check: `ffprobe -v error -select_streams v -show_entries stream=codec_name,profile,pix_fmt,color_range,color_space,color_primaries,color_transfer -of compact deck-video.mp4`
7. For a deck event, add the deck rule (RC-19). Recording waits for the owner's H3 sign-off after /harden.

## Gaps
- FD20 grades its gates fail, warn or manual; `recording-check.mjs` fails on a FAIL row and leaves a WARN row ok with `severity: "warn"` in the evidence (CONTRACTS 4 v1.1). Read each gate's evidence, not only `ok`.
- CONTRACTS 6.6 names the provenance attribute `data-source`; FD20's prototype checker read `data-provenance` [FD20-F21]. This skill uses `data-source`.
- The size thresholds rest on OCR of one face (Inter) by a French recogniser, on Windows Chromium with x264 only; another recorder, upscaler or 4K capture needs recalibration with FD20's E1 scripts [FD20 Weak spots].
- FD20's prototype gave different report tables across runs on an animated page; the gates are deterministic only if record mode freezes the page before capture [FD20-F20].
- Whether TOKEN2049 accepts .pptx is unconfirmed [FD20-F25]; whether OP3N judges accept emulator footage is unknown [FD20-F22].
- The PISCR minima come from trade press and the projector model ignores gamma, uneven light and screen gain [FD20-F17].
- CONTRACTS 6.1's default viewports lack the 1536x864 recording viewport, and CONTRACTS 6.3 names no recording-spec file; this file adds both through the profile and `receipts/`.
