# Recording-ready screens: legibility after compression, cursor, frozen data, projectors
> Code FD20 · slug technique-recording-readiness · researched 2026-10-01 · verified 2026-10-01 · counts: verified 7 / corrected 16 / downgraded 1 / dropped 0 / added 1

## Summary

- Judges may see only the recording. Devpost's rules let judges skip the product entirely ("may choose to judge based solely on the text description, images, and video"), and the template instance opened requires a public YouTube video under 3 minutes with audio narration. TOKEN2049 Origins prohibits live demos: the screen recording must be embedded in a .ppt or .keynote deck, not linked, although every team also submits a repo and a live URL. The Cardano track caps the video at 3 minutes. At ETHGlobal's in-person events the video is optional and teams demo live, but an uploaded video fails below 720p or outside 2 to 4 minutes (F01). (corrected: added the Devpost audio and YouTube rules, the TOKEN2049 live URL, and that ETHGlobal's video is optional)
- A literal 97-2003 .ppt deck converts an embedded video into a still picture, so TOKEN2049's ".ppt or .keynote only" has to be read as .pptx or Keynote .key and confirmed with the organisers (F25, added at verification).
- The judge's copy is smaller than the capture. YouTube recommends 4:2:0 uploads, converts full range to limited, and changes stream quality with viewing conditions, including player size. Loom's free plan records at up to 720p and serves renditions down to 480p. PowerPoint offers compression presets at 1080p, 720p and 480p. A video shown at half size in a slide pane is a 540p view; that half-size figure is an assumption, not a sourced number (F02, F03). (corrected: YouTube does not say players default to "Auto"; the slide-pane figure is not supported by F02 or F03)
- Measured in this session (E1, 2,640 OCR crops of Inter text at 1920x1080): H.264 at CRF 23 without downscaling left 10 px text as readable as the lossless capture. Downscaling is what destroys small text. In a 720p copy, OCR read the embedded number exactly in 47 to 48 of 48 strings at 18 px, 36 to 41 of 48 at 16 px and 19 to 27 of 48 at 14 px. In a 540p copy, 24 px held (48 of 48) and 20 px did not (36 of 48). In the delivered frame, reliable reads needed about 6.5 px of x-height. Results were mixed between 5.1 and 5.9 px and mostly failed at 4.9 px and below. Knoche and Sasse's 5 px minimum is a letter height illustrated with a capital E and was not measured in their studies, so it agrees with E1 only in order of magnitude (F04, F06). (corrected: the failure band starts at about 4.9 px, not 5.5 px, and the Knoche and Sasse figure is not an x-height)
- The norms point the same way. XAG 101 sets 18 px body height at 1080p for PC and 26 px for console. Apple sets a tvOS minimum of 23 pt and a default of 29 pt, in Medium weight. BBC subtitles use a line height of 7 to 8% of video height, multiplied by 0.6 on laptops. Microsoft recommends slide text of 18 pt or more, which is 36 px of a 1080p video that fills a widescreen slide (F05).
- A model blind read is not a legibility test. In two ground-truthed reads, Claude read 9 to 16 px text in 540p and 720p copies almost perfectly where OCR mostly failed, and it swapped plausible digits and words. A blind read can only check comprehension, one way (F07, downgraded to C: two frames, one reader).
- Dark gradients band after encoding. CAMBI scores for five dark hero backgrounds were 10 to 20 in a 720p H.264 copy. Netflix's rule of thumb puts "slightly annoying" banding at "around 5". A light gradient scored 0. Chromium's own gradient dither (median run of 1 px) became 49 px bands (F09).
- Grain does not survive the encode. x264 at CRF 23 erased animated grain completely. Static grain cost 48% more bytes and did not stop banding (CAMBI rose from 1.9 in the source to 10 to 18 after encoding). Netflix and Norkin report that grain is "notoriously difficult to compress" and "often completely removed" (F10).
- 1 px hairlines lose much of their contrast at 720p (1.48:1 fell to 1.20:1, and 1.24:1 to 1.15:1); 2 px lines survive. A full-range master mistagged as limited range crushes #0a0a0a, #0f0f0f and #111111 into a single black (F11, F12).
- Playwright 1.63.0 records VP8 at a fixed 1 Mbps, 25 fps and a default size that fits 800x800. In a 1.59 test its video showed no pointer (56 frames, luma 127 to 129). It is a debugging tool, not the judge's master (F13, F14).
- Projectors: the PISCR (ANSI/INFOCOMM 3M-2011) minimum system contrast is 15:1 for basic decision making and 7:1 for passive viewing. Under that model, grey-500 text on near-black drops from 4.10:1 to 3.20:1 and 1.97:1, and dark UIs lose more contrast than light ones. By AVIXA DISCAS, 16 px text at 125% zoom reads to about 2 image heights and 32 px to about 4 (F17, F18). At 125% and 150% zoom a 1920x1080 screen is 1536 and 1280 CSS px wide (F19).
- Frozen, honest data: Playwright's clock and HAR replay freeze time and network for checks (they do not freeze CSS animations; F20). The recording itself needs an app-level fixture mode with visible provenance labels (live, testnet, simulated) and an as-of time. *FTC v. Colgate-Palmolive* (1965) is the legal root: an undisclosed mock-up presented "as actual proof of a claim" deceives (F20, F21).
- Deliverable: a recording profile with 15 gates (16 after verification), and `_scripts/fd20/recording-check.mjs`. It FAILs a fixture that carries most of the automated defects (exit 2 with 8 FAIL, 8 WARN and 3 INFO in all nine recorded runs of the current version) and passes a clean one (exit 0). Its report table is not deterministic: on the same fixture the verifier's six runs gave CAMBI 12.356 once and 12.613 five times, with 3 or 4 contrast failures, while the researcher's runs all gave 12.566 and 3, because the frozen frame of a blinking element varies (F20). (corrected: the "identical tables" pair came from an earlier checker version, the claim did not hold on re-run, and the fixture does not exercise every defect)

## Findings

### FD20-F01 — Judges may see only the recording, and three platforms put hard limits on it
- **Grade:** A · **Kind:** ASSERTED · **Verdict:** CORRECTED
- **Claim:**
  - TOKEN2049 Origins, main track: live demos are prohibited, the screen recording must be embedded in the slides, and slides must be .ppt or .keynote. Every team also submits a GitHub repo and a project link (a live URL or hosted demo), so judges can open the product; the top 5 teams present live on the TOKEN2049 stage. (corrected: added the repo and live-URL requirements from the same data)
  - Cardano track: "a demo video of max 3 minutes". The judging criteria include "Could someone new to blockchain understand it quickly?" (User Experience & Design, weighted 20%).
  - Devpost's rules, seen in a 2026 challenge (The WebMCP Challenge, sponsor OpenAI OpCo, LLC): the video must be under three minutes, must include a clear demo "with audio that covers what you built", and must be public on YouTube. Judges are not required to watch past three minutes or to test the project. (corrected: the audio and YouTube requirements had been cut out of the quote)
  - ETHGlobal: at its in-person events the demo video is optional, each team presents live to the judges (4 minutes of demo, 3 of Q&A), and partners judge from the submitted materials. An uploaded video must run 2 to 4 minutes, and uploads below 720p fail. (corrected: the finding had presented the ETHGlobal video as the judged surface)
- **Implication for /frontend:** Treat the recording as the primary judging surface wherever judges review submissions asynchronously (Devpost, TOKEN2049 track judging, ETHGlobal partner prizes). Every feature and its proof must be legible in a 3-minute screen recording with no interaction from the judge. For TOKEN2049 the video plays on the stage screen from a deck, so the projector gates (F17 to F19) apply to it too, and the live URL must tell the same story as the video.
- **Evidence:**
  - [TOKEN2049 Origins Hackathon track data](https://edge.builderbase.com/events/public/token2049-origins-hackathon) — organiser's public API behind builderbase.com (TOKEN2049 / BuilderBase), record updated 2026-09-24, accessed 2026-10-01 — official rules data.
    - "Live demos are prohibited to avoid technical errors on stage. Use a screen recording and embed the video directly in your slides. Do not link to YouTube or external video."
    - ".ppt or .keynote only. Google Slides, Gamma or Vercel page links are not accepted — they won’t play reliably on stage."
    - "GitHub repo — public, or with judge access granted" · "Project link — live URL or hosted demo" · "Presentation slides — Google Drive link to a .ppt or .keynote file" (verifier addition)
    - "The top 5 teams demo live on the TOKEN2049 stage, in front of 25,000+ attendees." (verifier addition)
  - [Cardano — Agentic Commerce track data](https://edge.builderbase.com/events/public/cardano-agentic-commerce) — same API, accessed 2026-10-01 — official rules data.
    - "A demo video of max 3 minutes showing the product in action."
    - "20% User Experience & Design Is the design intuitive and user-friendly? Does it consider real-world onboarding and usability? Could someone new to blockchain understand it quickly?"
  - [The WebMCP Challenge — Official Rules](https://webmcp.devpost.com/rules) — Devpost (sponsor OpenAI OpCo, LLC), submission period 25 Aug to 3 Sep 2026, accessed 2026-10-01 — official rules (Devpost template).
    - "The video portion of the Submission: must be less than three (3) minutes. Judges are not required to watch beyond three minutes" · "must include a clear demo of your project functioning and with audio that covers what you built and how you used WebMCP" · "must be uploaded to and made publicly visible on YouTube, and a link to the video must be provided on the submission form on the Hackathon Website" (corrected: the original quote ran two bullets together and stopped before "and with audio")
    - "Judges are not required to test the Project and may choose to judge based solely on the text description, images, and video provided in the Submission."
  - [ETHGlobal New Delhi — Event details](https://ethglobal.com/events/newdelhi/info/details) — ETHGlobal, event page (event ended Sunday 28 September 2025), accessed 2026-10-01 — official event rules. The same video text appears on the Cannes (July 2025) and San Francisco 2024 (October 2024) pages. (corrected: the Cannes page is the 2025 event, not 2024)
    - "Must be between 2 and 4 minutes : Videos under 2 minutes or over 4 minutes will be automatically rejected during upload."
    - "DO NOT export the video in any resolution less than 720p (Upload will fail if the video is less than 720p)"
    - "Your demo video, while optional, is a key part of showcasing your project." (verifier addition)
    - "Each team has 7 minutes to present: 4 minutes for the demo, followed by 3 minutes for Q&A with the judges." · "Partners will judge submissions based on the project materials you submit." (verifier addition)
- **Limits / false positives:**
  - Rules change per event. The TOKEN2049 data came from an API the organisers are still editing, so re-fetch before submitting.
  - Devpost's rules differ per hackathon; this is one template instance.
  - DoraHacks publishes no platform-wide rule (see "What could not be found").
  - Where teams demo live (ETHGlobal's in-person judging, the Ledger OP3N finals) the recording is a backup surface, not the primary one.

### FD20-F02 — The deck path fixes the codec: MP4 with H.264 and AAC, never HEVC on Windows, and caption tracks do not survive compression
- **Grade:** A · **Kind:** ASSERTED · **Verdict:** CORRECTED
- **Claim:**
  - Microsoft recommends .mp4 with H.264 video and AAC audio for PowerPoint.
  - Microsoft sells HEVC playback for Windows apps as the HEVC Video Extensions, a Microsoft Store add-on listed at $0.99 in the US store (0,99 € when the listing is fetched from France). The listing does not say it is the only route to HEVC playback. (corrected: "Windows plays HEVC only through" overstated the listing)
  - Keynote accepts formats QuickTime supports. Depending on its optimisation settings, it may convert movies to HEVC or to H.264; its "Most compatible (H.264)" option converts to H.264 and can cap movie resolution.
  - PowerPoint's Compress Media offers 1080p, 720p and 480p presets, and it drops embedded subtitles and alternate audio tracks.
- **Implication for /frontend:** This belongs to the later recording step, but /frontend writes the recording spec. Master at 1920x1080 in H.264 High, 4:2:0, AAC, MP4 with fast start. Never use HEVC. Burn captions into the picture, because caption tracks are stripped. If the deck must shrink, choose the 1080p preset, since 720p lands in F04's harsher tier. Never save the deck as 97-2003 .ppt (F25).
- **Evidence:**
  - [Video and audio file formats supported in PowerPoint](https://support.microsoft.com/en-us/office/video-and-audio-file-formats-supported-in-powerpoint-d8b12450-26db-4c7b-a5c1-593d3418fb59) — Microsoft Support, accessed 2026-10-01 — official docs.
    - "Video : .mp4 files encoded with H.264 video and AAC audio"
    - "Support for Windows Media Video (.wmv, .asf), Windows Media Audio (.wma, .asf), MPEG-2 (.mpg, .mpeg, .mpe), Audio Video Interleave (.avi), Audio Interchange File Format (.aiff, .aif, .aifc), and Third Generation Partnership Project (3GPP) is limited and deprecated in PowerPoint version 2505 and above."
  - [HEVC Video Extensions](https://apps.microsoft.com/detail/9nmzlz57r3t7) — Microsoft Store listing (publisher Microsoft Corporation), accessed 2026-10-01 — official listing.
    - "Play High Efficiency Video Coding (HEVC) videos in any video app on your Windows 10 device." · page data `"displayPrice":"$0.99"` with `?hl=en-US&gl=US`; `"displayPrice":"0,99 €"` from a French connection
  - [Compress your media files](https://support.microsoft.com/en-us/office/compress-your-media-files-a45c956a-f4a6-4d47-99ef-b408ac5a9a6b) — Microsoft Support, accessed 2026-10-01 — official docs.
    - "Full HD (1080p) Save space while maintaining overall audio and video quality. HD (720p) Quality will be comparable to media which is streamed over the Internet. Standard (480p) Use when space is limited, such as when you are sending presentations via e-mail."
    - "Embedded subtitles and alternate audio tracks are lost in this compression process."
  - [Add video and audio in Keynote on Mac](https://support.apple.com/en-in/guide/keynote/tan63d61519a/mac) — Apple Keynote User Guide, accessed 2026-10-01 — official docs.
    - "Video and audio files must be in a format that QuickTime supports on your Mac."
  - [Set movie and image formats for Keynote presentations on Mac](https://support.apple.com/guide/keynote/set-movie-and-image-formats-tan12af068f9/mac) — Apple, accessed 2026-10-01 — official docs.
    - "Movies in ProRes or other unsupported formats are converted to HEVC. If your computer or device does not support HEVC, the movie is converted to H.264."
  - [Reduce a presentation’s file size in Keynote on Mac](https://support.apple.com/guide/keynote/reduce-the-presentation-file-size-tand16e52f8w/mac) — Apple, accessed 2026-10-01 — official docs.
    - "Most compatible (H.264): Movies in your presentation are converted to H.264 format, which plays on most iOS devices, iPadOS devices, and Mac computers."
    - "Movie Quality: Set the maximum resolution for movies."
  - Tested 2026-10-01 with ffmpeg 9.0.2 (gyan.dev full build): the export recipe in Deliverable E produced `codec_name=h264|profile=High|pix_fmt=yuv420p|color_range=tv|color_space=bt709|color_transfer=bt709|color_primaries=bt709`, AAC at 48 kHz, and the moov atom before mdat. Without `setparams`, the `-color_primaries` and `-color_trc` flags left the tags `unknown`. The verifier re-ran both commands on a synthetic 1920x1080 master and got the same tags, AAC 48000 Hz, moov at byte 36 and mdat at byte 2483.
- **Limits / false positives:**
  - The Microsoft pages give no file-size or resolution cap.
  - Whether the TOKEN2049 stage machine has the HEVC extension is unknown; avoiding HEVC removes the question.

### FD20-F03 — Streaming platforms serve a smaller, re-encoded copy
- **Grade:** A · **Kind:** ASSERTED · **Verdict:** CORRECTED
- **Claim:**
  - YouTube recommends H.264 uploads with 4:2:0 chroma, at 8 Mbps (1080p) or 5 Mbps (720p) for 24 to 30 fps. It asks for content to be uploaded in the frame rate it was recorded in, and it converts full range to limited. (corrected: the page is an upload recommendation; it does not say YouTube keeps the frame rate)
  - YouTube changes the quality of the stream with viewing conditions, among them the player or screen size; its Android help lists "Auto (recommended)" as the quality setting. (corrected: no page opened says players default to "Auto"; the "Auto" line appears in the Android version of the help page, not in the default computer version)
  - Loom's free Starter plan records at up to 720p. Its Windows app records H.264 at a target of 30 fps and serves renditions from the recorded resolution down to 480p.
- **Implication for /frontend:** Design for the 720p copy as the normal case and the 540p view (a small player, or a slide pane) as the worst case. Sizes that pass only at native 1080p are not recording-ready.
- **Evidence:**
  - [YouTube recommended upload encoding settings](https://support.google.com/youtube/answer/1722171?hl=en) — Google, accessed 2026-10-01 — official docs.
    - "Chroma subsampling: 4:2:0"
    - Table rows: "1080p 8 Mbps 12 Mbps" · "720p 5 Mbps 7.5 Mbps" (standard frame rate, high frame rate)
    - "Content should be encoded and uploaded in the same frame rate it was recorded."
    - "YouTube converts full color range to limited color range."
  - [Change the quality of your video](https://support.google.com/youtube/answer/91449?hl=en) — Google, accessed 2026-10-01 — official docs.
    - Computer version: "To give you the best viewing experience, YouTube changes the quality of your video stream based on your viewing conditions." · "Video player/screen size : Higher-quality videos generally play better on larger screens." (verifier addition)
    - Android version (`&co=GENIE.Platform%3DAndroid`): "Auto (recommended) : Changes to give you the best experience for your conditions." (corrected: this line is absent from the default computer version)
  - [Manage your video recording quality](https://support.atlassian.com/loom/docs/manage-your-video-recording-quality/) — Atlassian (Loom), accessed 2026-10-01 — official docs.
    - "Loom Starter users can choose their recording resolution up to 720p."
  - [Loom video encoding settings (by platform)](https://support.atlassian.com/loom/docs/loom-video-encoding-settings-by-platform/) — Atlassian (Loom), accessed 2026-10-01 — official docs.
    - "Codec: H.264, Frame Rate: Target 30fps, Bitrate: Variable bitrate." (Windows desktop app)
    - "Loom encodes the video and makes it available in all resolutions starting with the originally recorded resolution, down to 480p."
- **Limits / false positives:** YouTube does not publish its delivered (playback) bitrates or scalers. The 720p and 540p tiers in F04 are simulations, not measurements of YouTube's output. Loom's Chrome extension records VP8/VP9, not H.264.

### FD20-F04 — Measured: downscaling, not H.264 at CRF 23, destroys small UI text; 18 px holds in a 720p copy and 24 px in a 540p copy
- **Grade:** B · **Kind:** MEASURED · **Verdict:** CORRECTED
- **Claim:**
  - **Set-up.** Inter at 9 to 28 px, rendered by headless Chromium 147 (Playwright chromium-1217) at 1920x1080, DPR 1. Eight colour and weight variants, six strings per size. Each capture was encoded as a judge's copy (bicubic downscale, libx264 CRF 23 or 30, yuv420p, BT.709 limited range) and read back at frame 30 of a 2-second still loop. Every string was cropped, upscaled to 3x its 1080p size (Lanczos) and read by Windows.Media.Ocr. That gives 2,640 crops.
  - **Exact reads of the embedded number** (out of 48 strings, all variants pooled):

    | size | lossless | 1080p CRF 23 | 720p CRF 23 | 720p CRF 30 | 540p CRF 23 |
    |---|---|---|---|---|---|
    | 12 px | 47 | 47 | 4 | 13 | 0 |
    | 14 px | 48 | 48 | 27 | 19 | 0 |
    | 16 px | 48 | 48 | 41 | 36 | 8 |
    | 18 px | 48 | 47 | 47 | 48 | 6 |
    | 20 px | 47 | 46 | 48 | 48 | 36 |
    | 24 px | 46 | 46 | 47 | 47 | 48 |

  - **Mean character error rate at 720p CRF 23:** 26.1% at 12 px, 7.5% at 13 px, 2.3% at 14 px, 3.5% at 16 px, 0.1% at 18 px. The curve is not monotonic between 14 and 16 px. (corrected: the 16 px value was left out)
  - **In the delivered frame:** Inter's x-height is 0.547 em, measured with canvas at 1000 px. Reads were reliable from about 6.5 px of x-height (18 px at 720p and 24 px at 540p: 47 to 48 of 48). Between 5.1 and 5.9 px they were mixed (14 px at 720p: 27 and 19 of 48; 20 px at 540p: 36 of 48; 16 px at 720p: 41 and 36 of 48). At 4.9 px and below they mostly failed (at most 13 of 48). (corrected: the original said reads "mostly failed below about 5.5 px", but 20 px at 540p, 5.47 px, read 36 of 48)
- **Implication for /frontend:**
  - FAIL any text a judge must read whose x-height falls below 5.8 px in the 720p copy; for Inter that is under 16 px.
  - WARN between 5.8 and 6.5 px (16 to 17 px).
  - Require text marked key (the claim, proof values, state and provenance labels) to reach 6.5 px in the 540p copy, which for Inter means 24 px or more.
  - These gates are implemented in the checker.
- **Evidence:**
  - Experiment E1, scripts `_scripts/fd20/experiments/e1-capture.mjs`, `e1-degrade-ocr.py`, `e1-score.py`, `ocr.ps1`; results `_scripts/fd20/results/e1-ocr-score.json` — run 2026-10-01 on Windows 11 Pro 10.0.26200, Chromium 147.0.7727.15, ffmpeg 9.0.2 (gyan.dev full build, libx264), playwright-core 1.59.0 — in-session measurement. The verifier recomputed the table, the CER values and the 2,640 total from `e1-ocr-score.json`, and re-measured Inter's x-height with canvas at 1000 px (546.875 px).
    - Output row `16  48  48  41  36  8` (digits exact out of 48, conditions in the table order above).
    - Checker output on the fixture: "smallest text: 11px Inter (x-height 6.02px at 1080p, 4.0px at 720p)".
- **Limits / false positives:**
  - OCR stands in for a human reader. It is not a reading test.
  - The only recogniser installed on this machine is fr-FR, so it read English strings. Noise shows up even at lossless 24 to 28 px (45 to 46 of 48).
  - One font, still frames only, bicubic scaling, x264 only. YouTube also serves VP9 and AV1.
  - Crops were upscaled so that OCR resolution was not the limit. The data describe information loss, not physical viewing size.

### FD20-F05 — Broadcast, console and slide norms converge on large text, and they measure the glyph, not the CSS size
- **Grade:** A · **Kind:** ASSERTED · **Verdict:** CORRECTED
- **Claim:**
  - **XAG 101.** At 1080p, text should measure at least 18 px of body height on PC and 26 px on console. Body height runs from descender to ascender and is measured on a screenshot, counting only edge pixels above 2:1 contrast.
  - **Apple HIG.** tvOS has a default of 29 pt and a minimum of 23 pt, and its Body style is Medium weight. For thin custom fonts, Apple asks for sizes above the recommendations.
  - **BBC Subtitle Guidelines 1.2.5 (March 2026).** Authoring line height is 7 to 8% of video height. Laptops and desktops use a multiplier of 0.6 (range 0.5 to 1), and a default of 0.5° subtended at the eye may be used, which the BBC warns "may be too small for some devices". (corrected: the caveat was dropped)
  - **Microsoft PowerPoint.** Microsoft asks for slide text of 18 pt or more, and a widescreen slide is 7.5 in (540 pt) tall. A 1080p video filling the slide therefore maps 2 px to 1 pt: 18 pt equals 36 px of video (my arithmetic).
- **Implication for /frontend:**
  - Measure rendered glyphs, not `font-size`: the checker measures x-height through canvas metrics.
  - 18 px (XAG PC) is the comfortable floor for reading text in a recording; F04 puts the hard floor at 16 px. Inter's "hg" body height is 0.953 em, so XAG's 18 px body height is Inter at about 19 px. (corrected: added the Inter conversion)
  - Text that must be read from a projector or a stage screen belongs to the console and TV class (26 px and up).
  - In the brief, express sizes as "points on the slide": 16 px UI text in a full-slide video equals 8 pt slide text.
- **Evidence:**
  - [Xbox Accessibility Guideline 101](https://learn.microsoft.com/en-us/gaming/accessibility/xbox-accessibility-guidelines/101) — Microsoft, ms.date 2022-05-09, updated_at 2026-06-17, accessed 2026-10-01 — official guideline.
    - "PC/VR: Font size should equal or exceed: 18 px at 1080p 36 px at 4K"
    - "Console: Font size should equal or exceed: 26 px at 1080p 52 px at 4K"
    - "The following pixel measurements are based on body height, which is the sum of the number of pixels in the descender space, the x-height space, and the ascender space."
    - "If the contrast ratio of the pixel in question to the background color is higher than 2:1, it can be included in the ascender or descender measurement."
  - [Typography](https://developer.apple.com/design/human-interface-guidelines/typography) (read through its data endpoint `developer.apple.com/tutorials/data/design/human-interface-guidelines/typography.json`) — Apple Human Interface Guidelines, accessed 2026-10-01 — official guideline.
    - Table: "tvOS | 29 pt | 23 pt" (default size, minimum size); tvOS built-in styles: "Body | Medium | 29 | 36 | Bold"
    - "If you use a custom font with a thin weight, aim for larger than the recommended sizes to increase legibility."
    - Under the tvOS styles table: "Point size based on image resolution of 72 ppi for @1x and 144 ppi for @2x designs." (verifier addition)
  - [Images](https://developer.apple.com/design/human-interface-guidelines/images) (data endpoint `images.json`) — Apple HIG, accessed 2026-10-01 — "macOS, tvOS | @1x and @2x" · "a scale factor of 1 (also called @1x) describes a 1:1 pixel density, where one pixel is equal to one point." (verifier addition)
  - [BBC Subtitle Guidelines](https://www.bbc.co.uk/accessibility/forproducts/guides/subtitles/) — BBC, Version 1.2.5, March 2026, accessed 2026-10-01 — official guideline.
    - "Font size should be set to fit within a line height in the range 7% to 8% of the active video height for 16:9, 4:3 and 1:1 aspect ratio videos"
    - "Laptop and desktop computers 16:9 monitor 187mm-300mm x0.6 x0.5-x1"
    - "In the absence of other information, a default size of 0.5° subtended at the eye may be used to derive the default line height and calculate the multiplier, however this may be too small for some devices."
  - [Make your PowerPoint presentations accessible to people with disabilities](https://support.microsoft.com/en-us/office/make-your-powerpoint-presentations-accessible-to-people-with-disabilities-6f7772b2-2f33-4bd2-8ca7-dae3b2b3ef25) — Microsoft Support, accessed 2026-10-01 — official docs.
    - "Use a larger font size (18pt or larger), sans serif fonts, and sufficient white space."
  - [Change the size of your slides](https://support.microsoft.com/en-us/office/change-the-size-of-your-slides-040a811c-be43-40b9-8d04-0de5ed79987e) — Microsoft Support, accessed 2026-10-01 — official docs.
    - "Widescreen sets it to 13.333 in x 7.5 in."
- **Limits / false positives:**
  - These are norms, not measurements, and each targets a different viewing situation (couch, TV, slide).
  - Apple's HIG gives tvOS @1x and @2x and defines @1x as one pixel per point, but no page opened states that a 1080p tvOS screen is @1x, so 23 pt = 23 px at 1080p is an inference. (corrected: the original said no mapping page was opened)
  - XAG body height covers ascender and descender; for Inter, the canvas measure of "hg" is 0.953 em (verifier, 1000 px). (corrected: was "close to 1.0 em")

### FD20-F06 — A measured user study: text legibility decided perceived video quality; the paper also states 5 px and 5 arcmin minimums that its studies did not measure
- **Grade:** A · **Kind:** MEASURED · **Verdict:** CORRECTED
- **Claim:**
  - Knoche and Sasse (UCL, Proceedings of SPIE, 2006) ran three lab studies with 216 participants on mobile TV news. They found that "the legibility of text was a decisive factor" in how participants judged video quality.
  - With text re-rendered to stay legible, 168x126 clips became acceptable to most participants at 160 kbps or more.
  - The paper cites a 5 arcminute minimum for 20/20 vision (ANSI recommends 16) and states that fonts need "at least five pixels in height", illustrated with the capital letter E (three stroke rows and two gaps). The 5 arcmin figure carries a reference; the 5 px figure carries none. (corrected: the 5 px figure is uncited and is a letter height, not an x-height)
- **Implication for /frontend:**
  - A judge who cannot read the key figures marks the whole video down, not only the text.
  - The 5 px floor is a letter height. For Inter (cap height 0.734 em, x-height 0.547 em), a 5 px capital is a 3.7 px x-height, well below F04's measured 6.5 px reliable band. The paper and E1 agree only in order of magnitude, and E1's measured floor is the stricter one. (corrected: the original said the 5 px floor "matches" F04's x-height band, so "two independent sources agree")
- **Evidence:**
  - [Breaking the News on Mobile TV: User requirements of a popular mobile content](https://infoscience.epfl.ch/server/api/core/bitstreams/5a1b46e4-a6e5-4194-84f3-a8bacb1d4c77/content) — Hendrik O. Knoche and M. Angela Sasse, UCL; pre-final manuscript (PDF created 2006-01-10), EPFL Infoscience, accessed 2026-10-01; published in the Proceedings of SPIE (IS&T/SPIE Electronic Imaging), 2006 — peer-reviewed conference paper (pre-final copy).
    - "The legibility of text was a decisive factor in the participants' assessment of the video quality."
    - "For people with 20/20 visual acuity, the minimum readable text size is five minutes of arc25. The ANSI recommends a minimum size of 16 minutes of arc26"
    - "Fonts also need to be at least five pixels in height to be legible. The letter ‘E’, for example, needs three rows for the strokes and 2 for the spaces in between. These values depend on appropriate contrast, which suffers when text is encoded as part of a low bitrate video stream."
  - Inter metrics: canvas at 1000 px in Chromium 147, Inter from Google Fonts — x 546.875, H 734.375, "hg" 953.125 — verifier measurement 2026-10-01.
- **Limits / false positives:**
  - 2006: small screens (iPAQ), WMV codecs, news content.
  - Neither the 5 px nor the 5 arcmin figure was measured in the paper's three studies. (corrected: the original said both were "cited from the paper's references")

### FD20-F07 — A model's blind read over-reads degraded text: use it to check comprehension, never legibility
- **Grade:** C · **Kind:** OBSERVED · **Verdict:** DOWNGRADED
- **Downgrade reason:** Two frames and 22 strings, one reader, and that reader wrote the vocabulary. The scoring checks out, but the sample is closer to an anecdote than to measured practitioner work, so it drops from B to C. The implication stays: it only tells the checker to distrust a model read.
- **Claim:**
  - I read two crops at native size before seeing the ground truth.
  - Grey-400 on white in a 540p copy, 11 strings: the 8 strings from 12 px up were read correctly, except that at 18 px one word was replaced by a plausible one ("deposit" for "device"). One digit was wrong at 9 px ("16,722.41" for "18,722.41") and one at 11 px.
  - Red on near-black in a 720p copy, 11 strings: all correct from 9 px up.
  - On the same variants and conditions, Windows OCR had 44 to 100% character error at 9 to 16 px (grey-400 at 540p) and 31 to 100% at 9 to 12 px (red at 720p).
- **Implication for /frontend:**
  - The blind-read step shows a fresh subagent the 540p first frame and asks only what the product is, what it does and what proves it.
  - A failed read shows that the frame does not carry the message. A pass proves nothing about human legibility, which the deterministic size gates decide.
  - Never use a model read to confirm that a number is legible or correct.
- **Evidence:**
  - Blind reads 2026-10-01, files `_scripts/fd20/results/e1-blind-v3-540-myread.txt` and `e1-blind-v8-720-myread.txt`, scored against `_scripts/fd20/results/e1-manifest.json` (ground truth) — in-session observation. The verifier re-compared all 22 lines with the manifest and the OCR CER ranges with `e1-ocr-score.json`.
    - Scoring output: "9px  CER 2.5%  num BAD  truth: 18,722.41 dispute price pending withdraw | mine: 16,722.41 dispute price pending withdraw" · "18px  CER 11.9%  num OK  truth: Ledger device total buyer 1,337.08 dispute | mine: Ledger deposit total buyer 1,337.08 dispute"
- **Limits / false positives:**
  - Two frames, 22 strings.
  - The reader was the model that wrote the 40-word vocabulary, so word guesses were easier than for a stranger. The numbers were random.
  - Other models and humans were not tested.
  - Nothing in the files proves the reads were made before the ground truth was opened.

### FD20-F08 — Contrast, weight and hue cost one size step in the delivered copy
- **Grade:** B · **Kind:** MEASURED · **Verdict:** CORRECTED
- **Claim:**
  - In E1 at 720p CRF 23, the smallest size from which a variant read reliably (5 or more of 6 numbers exact and CER of 2% or less at every larger size) was:
    - 14 px for ink on white and for light on near-black;
    - 16 px for grey-500 and grey-400 on white, grey-500 and blue-500 on near-black;
    - 18 px for weight 300 and for red-500 on near-black.
  - At 540p, low-contrast grey-400 on white (2.54:1) failed up to 18 px, at 34.6% CER.
  - WCAG measures contrast as (L1 + 0.05) / (L2 + 0.05).
  - XAG 102 says text on a non-solid background should be measured against its lowest-contrast area, and demonstrates that high contrast survives blur.
- **Implication for /frontend:**
  - Keep WCAG 1.4.3 as the floor, measured on rendered pixels with the worst background pixel (the checker samples the screenshot).
  - Add one size step (18 px or more) for weights of 300 or lighter and for red text on dark backgrounds. Blue-500 on near-black read reliably from 16 px, like grey-500, so E1 does not support an extra step for blue. (corrected: blue had been grouped with red)
- **Evidence:**
  - Experiment E1 (as F04), per-variant table from `e1-ocr-score.json` — in-session measurement; the verifier recomputed every threshold above from the JSON.
    - "v6-ink-white-300 … h720c23 18" · "v8-red-dark-400 … h720c23 18" · "v4-light-dark-400 … h720c23 14" · "v7-blue-dark-400 … h720c23 16" (verifier addition)
  - [Web Content Accessibility Guidelines (WCAG) 2.2](https://www.w3.org/TR/WCAG22/) — W3C Recommendation 12 December 2024, accessed 2026-10-01 — standard.
    - "contrast ratio (L1 + 0.05) / (L2 + 0.05), where L1 is the relative luminance of the lighter of the colors"
    - SC 1.4.3: "The visual presentation of text and images of text has a contrast ratio of at least 4.5:1"
  - [Xbox Accessibility Guideline 102](https://learn.microsoft.com/en-us/gaming/accessibility/xbox-accessibility-guidelines/102) — Microsoft, ms.date 2023-06-08, accessed 2026-10-01 — official guideline.
    - "When text is displayed over a non-solid color background, the text contrast ratio should be measured between the text and the lowest contrasting area of the background."
    - "Note that with decreased sharpness, text with a strong contrast ratio is much more visible than text with a weak contrast ratio."
- **Limits / false positives:**
  - Six strings per cell. The weight-300 result at 16 px (2 of 6) looks like an OCR outlier next to 14 px (3 of 6).
  - Headless Chromium on Windows rendered LCD subpixel antialiasing. The stored scripts do not contain the measurement behind "mean |R−B| on 10 px text pixels was 50.9"; the verifier's own pass over the stored captures (a different pixel mask) found chromatic fringes on every variant, for example a mean |R−B| of 82 for ink on white, so the fringing is confirmed but the 50.9 figure could not be reproduced. Other capture setups may differ. (corrected: the figure is not reproducible from the stored scripts)

### FD20-F09 — Measured: dark gradients band after H.264 encoding, light ones do not, and the browser's own dither is erased
- **Grade:** B · **Kind:** MEASURED · **Verdict:** CORRECTED
- **Claim:**
  - CAMBI is Netflix's banding index. It starts at 0, the highest score Netflix has observed is 24 (unwatchable), and "around 5" is where banding "starts to become slightly annoying". (corrected: the original said it "runs from 0 to 24"; 24 is the highest score observed, not a defined scale end)
  - Eight 1920x1080 hero backgrounds were scored as lossless source → 1080p CRF 23 → 720p CRF 23 → 720p CRF 30:
    - dark three-stop purple: 6.06 → 12.59 → 17.77 → 20.03
    - near-black subtle (#0a0a0a to #171727): 7.70 → 17.24 → 14.11 → 17.28
    - radial violet glow on #09090b: 3.57 → 6.73 → 10.80 → 11.15
    - vivid violet to blue (#7c3aed to #2563eb): 0.50 → 3.70 → 4.55 → 9.60
    - light (#ffffff to #eef2ff): 0 at every step
    - flat control: 0.20 or less
  - Chromium dithered the near-black gradient: its luma column had a median run of 1 px and a maximum of 38 px. After the 1080p encode the median run was 49 px and the maximum 99 px.
- **Implication for /frontend:**
  - Two of the owner's tells (gradient backgrounds and glows) carry a measurable recording cost.
  - WARN on large gradients whose stops all have relative luminance below 0.1 (the checker composites translucent stops over the underlying background first). Every such gradient here scored above 5 at 720p.
  - FAIL when CAMBI on the simulated 720p copy exceeds 5.
  - Replace dark washes with flat surfaces, or with steep gradients (large luminance change over a short distance).
- **Evidence:**
  - [CAMBI](https://github.com/Netflix/vmaf/blob/master/resource/doc/cambi.md) — Netflix, VMAF repository docs (master; file last changed 2026-05-07, commit 721569bc1b), accessed 2026-10-01 — official tool docs.
    - "The CAMBI score starts at 0, meaning no banding is detected. A higher CAMBI score means more visible banding artifacts are identified. The maximum CAMBI observed in a sequence is 24 (unwatchable). As a rule of thumb, a CAMBI score around 5 is where banding starts to become slightly annoying (also note that banding is highly dependent on the viewing environment - the brigher the display, and the dimmer the ambient light, the more visible banding is)."
    - "`window_size` (min: 15, max: 127, default: 63): Window size to compute CAMBI (default: 63 corresponds to ~1 degree at 4K resolution and 1.5H)" (verifier addition)
  - Experiment E2, `_scripts/fd20/experiments/e2-capture.mjs`, `e2-measure.py`; results `_scripts/fd20/results/e2-cambi.json` — ffmpeg 9.0.2 `libvmaf=feature=name=cambi`, run 2026-10-01 — in-session measurement; every value above re-read from the JSON by the verifier.
    - `"g2-near-black-subtle": {"src_cambi": 7.697, "src_col": {"levels": 15, "median_run": 1.0, "max_run": 38}, "h1080c23_cambi": 17.241, "h1080c23_col": {"levels": 12, "median_run": 49.0, "max_run": 99}`
    - `"g3-light-subtle": {"src_cambi": 0.0, … "h720c30_cambi": 0.0`
- **Limits / false positives:**
  - Eight synthetic pages, x264 only.
  - The luminance-0.1 cut-off is a heuristic calibrated on these pages.
  - CAMBI is a banding model, not an observer.
  - The two dark linear gradients already scored 6.1 and 7.7 in the lossless source, so for them the encode worsened existing banding. The radial glow scored 3.6 in the source and 10.8 after the 720p encode, so there the encode pushed it past 5. (corrected: the original said all dark gradients banded in the source, "CAMBI 6 to 8", and that the encode "does not create it")
  - CAMBI's default window is calibrated at about 1 degree for 4K viewed at 1.5 picture heights. E2 and the checker score 720p frames with the defaults, so the rule of thumb of 5 is applied outside that calibration. (added at verification)

### FD20-F10 — Grain overlays do not survive encoding: animated grain is erased, static grain costs bytes, and neither stops banding
- **Grade:** B · **Kind:** MEASURED · **Verdict:** CORRECTED
- **Claim:**
  - Netflix: film grain is "notoriously difficult to compress".
  - Norkin and Birkbeck: when grain is encoded directly (in AV1), it "is often completely removed or it manifests pulsing".
  - In E3 (1280x720, 1 second, x264 CRF 23), grain energy measured as the high-pass standard deviation in a flat region fell from 0.58 to 0.13 for animated grain, the same level as no grain (0.13). The encoder simply erased it.
  - Static grain survived in part (0.45) and cost 48% more bytes than no grain (23,435 bytes against 15,855).
  - Text-region SSIM fell slightly with grain, from 0.9940 to 0.9906 (static) and 0.9902 (animated).
  - Grain removed banding from the lossless source (CAMBI 1.89), but the 720p copies still banded (15.23 at CRF 23, 17.64 at CRF 30).
  - The Supreme Court's 1965 opinion recounts the FTC hearing examiner's finding that real sandpaper would have looked like plain coloured paper on television. (corrected: it is the examiner's finding as recounted by the Court, not a note in "the Supreme Court record")
- **Implication for /frontend:**
  - Tell #20 (grain overlays) is at best invisible and at worst costly in a recording.
  - In record mode, turn grain off and never rely on it to hide banding.
  - WARN wherever feTurbulence, a noise image or a grain class appears.
- **Evidence:**
  - [Unleashing Film Grain Synthesis on Netflix and Enhancing Visuals for Millions](https://netflixtechblog.com/av1-scale-film-grain-synthesis-the-awakening-ee09cfdff40b) — Li-Heng Chen, Andrey Norkin, Liwei Guo, Zhi Li, Agata Opalach, Anush Moorthy; Netflix Technology Blog, 2 Jul 2025, accessed 2026-10-01 (read through Exa; direct fetch returned 403) — vendor engineering blog (measured).
    - "Its random nature makes it notoriously difficult to compress. Traditional compression algorithms struggle to manage it, often forcing a choice between preserving the grain and reducing file size."
  - [Film Grain Synthesis for AV1 Video Codec](https://norkin.org/pdf/DCC_2018_AV1_film_grain.pdf) — Andrey Norkin (Netflix), Neil Birkbeck (Google); PDF hosted by the author, file name DCC_2018 (the PDF itself names no venue), accessed 2026-10-01 — conference paper.
    - "Randomness makes prediction difficult, motion estimation less precise, and the prediction residual in case of motion compensation contains noise with twice the variance of the film grain. Prohibitively high bitrates are often required to reconstruct film grain with sufficient quality."
    - "the film grain pattern is more temporally stable than the grain encoded by the AV1 directly, in which case grain is often completely removed or it manifests pulsing because of temporal quantizer variation."
  - [Film grain in AV1](https://norkin.org/research/film_grain/index.html) — Andrey Norkin, author's research page (undated), accessed 2026-10-01 (direct fetch worked at verification) — practitioner and author commentary.
    - "Film grain tool allows streaming video at a lower bitrate while providing better perceptual representation of the film grain. There is also an additional benefit of film grain masking some compression artifacts, such as banding, ringing, and blockingness." (corrected: the preceding sentence shows the benefit belongs to the AV1 film grain tool)
  - Experiment E3, `_scripts/fd20/experiments/e3-capture.mjs`, `e3-measure.py`; results `_scripts/fd20/results/e3-grain-text.json` — run 2026-10-01 (text crop corrected and re-run the same day) — in-session measurement; values re-read from the JSON by the verifier.
    - `e3-animated-grain {"crf23_bytes_1s": 16596, … "crf23_text_ssim": 0.9902, "grain_hp_std_src": 0.582, … "grain_hp_std_crf23": 0.127}`
    - `e3-static-grain {"crf23_bytes_1s": 23435, … "crf23_text_ssim": 0.9906, "grain_hp_std_src": 0.583, … "grain_hp_std_crf23": 0.453}`
    - `e3-no-grain {"crf23_bytes_1s": 15855, … "crf23_text_ssim": 0.994, … "grain_hp_std_crf23": 0.134}`
  - [FTC v. Colgate-Palmolive Co., 380 U.S. 374](https://www.law.cornell.edu/supremecourt/text/380/374) — U.S. Supreme Court, decided April 5, 1965 (Cornell LII), accessed 2026-10-01 — judgment.
    - "However, the examiner found that Rapid Shave could shave sandpaper, even though not in the short time represented by the commercials, and that if real sandpaper had been used in the commercials the inadequacies of television transmission would have made it appear to viewers to be nothing more than plain, colored paper." (corrected: quote extended to show whose finding it is)
- **Limits / false positives:**
  - One grain recipe (feTurbulence at 0.12 opacity, overlay blend), one gradient, x264 only.
  - YouTube's own encoders may behave differently.
  - Norkin's page credits the masking to grain that the AV1 film grain tool synthesizes after decoding. A grain overlay baked into a screen recording gets no such decoder-side synthesis, so that benefit does not carry over. Baked-in static grain did partly survive at 1080p CRF 23 (CAMBI 10.34 against 17.24 without grain), but not enough to fall below 5. (corrected: the original read Norkin as saying grain masks banding "when it survives")

### FD20-F11 — Measured: 1 px hairlines lose much of their contrast at 720p, while 2 px lines survive
- **Grade:** B · **Kind:** MEASURED · **Verdict:** CORRECTED
- **Claim:** Median WCAG contrast of 12 lines per style, lossless → 720p CRF 23 → 540p CRF 23:
  - grey-200 on white, 1 px: 1.24 → 1.15 → 1.10
  - grey-300, 1 px: 1.47 → 1.26 → 1.18
  - grey-200, 2 px: 1.24 → 1.24 → 1.17
  - grey-400, 1 px: 2.54 → 1.67 → 1.45
  - white 8% on #0a0a0a, 1 px: 1.17 → 1.08 → 1.06
  - white 15%, 1 px: 1.48 → 1.20 → 1.14
  - white 15%, 2 px: 1.48 → 1.44 → 1.29
  - zinc-700 on dark, 1 px: 1.90 → 1.34 → 1.24
- **Implication for /frontend:**
  - Structure carried only by faint 1 px borders (table rules, card edges on same-colour backgrounds, dark-UI dividers) fades in the recording.
  - Use 2 px lines, fills or spacing for structure that matters.
  - The checker WARNs on 1 px borders below 1.5:1.
- **Evidence:**
  - Experiment E4, `_scripts/fd20/experiments/e4-hairlines.mjs` — run 2026-10-01 — in-session measurement. The stored script renders the lines and encodes the 720p and 540p copies but contains no measurement step and prints only "done"; the output rows below came from a step that was not saved. The verifier reproduced every value above from the stored images (`lines.png`, `lines.720.png`, `lines.540.png`) by taking, per line, the peak-contrast row within ±3 px and the median over 12 lines. (corrected: the rows had been attributed to the stored script)
    - Output rows "white8-on-dark-1px 1.174 1.075 1.059" and "gray200-on-white-2px 1.238 1.237 1.171"
- **Limits / false positives:**
  - Horizontal lines only, at fixed positions. How a 1 px line lands on the 2/3 grid decides how much survives.
  - No threshold for line visibility was found in the sources opened; 1.5:1 is a design choice based on this data.
  - The source images live in the researcher's scratch folder, not in `_scripts/fd20`, so the measurement cannot be re-run from the skill folder alone.

### FD20-F12 — Dark UIs survive a correct encode but collapse under a colour-range mismatch
- **Grade:** B · **Kind:** MEASURED · **Verdict:** VERIFIED
- **Claim:**
  - Surfaces of #0a0a0a, #0f0f0f, #111111, #141414, #18181b, #1f1f23, #27272a and #3f3f46 kept their steps after a correctly tagged 720p encode. For example, the contrast of #141414 against #0a0a0a went from 1.075 to 1.066.
  - A full-range encode mistagged as limited, the classic recording fault, decoded #0a0a0a, #0f0f0f and #111111 all as 0 and #141414 as 2. Surface steps fell to between 1.00 and 1.05 up to #18181b.
  - YouTube converts full range to limited, so a wrong tag at upload propagates.
  - x264 offers an adaptive-quantisation mode "with bias to dark scenes". My inference is that its authors treat dark areas as a special case.
- **Implication for /frontend:**
  - For dark themes, keep surface steps at 1.1:1 or more, or add a border.
  - Check the master's `color_range` with ffprobe before it goes into the deck.
  - Record the colour range in the recording spec.
- **Evidence:**
  - Experiment E6, `_scripts/fd20/experiments/e6-dark-surfaces.mjs` plus the mistag commands in Deliverable E — run 2026-10-01 — in-session measurement. The verifier re-measured the stored frames and re-ran the mistag recipe on the stored `full.mp4`, getting the same values.
    - Output: "surfaces.png 10.0 15.0 17.0 20.0 24.0 31.0 39.0 63.0" · "mistagged.png 0.0 0.0 0.0 2.0 7.0 15.0 24.0 52.0" (mean red channel per surface)
  - [x264 command-line help (`x264.c`)](https://code.videolan.org/videolan/x264/-/raw/master/x264.c) — VideoLAN x264, master at commit 0480cb05fa (2025-09-10), accessed 2026-10-01 — source code.
    - "- 3: Auto-variance AQ with bias to dark scenes"
  - [YouTube recommended upload encoding settings](https://support.google.com/youtube/answer/1722171?hl=en) — Google, accessed 2026-10-01 — official docs.
    - "YouTube converts full color range to limited color range."
- **Limits / false positives:**
  - The mistag was simulated with a bitstream filter; I did not reproduce it with OBS.
  - The reverse fault (limited range read as full, which washes blacks out) was not measured.
  - No official OBS page on colour range was found: only forum posts, which I did not use.
  - Verifier note: the stored E6 script's own "mismatch" encode (full-range pixels, `-color_range tv`) did not crush anything under ffmpeg 9.0.2 (it decoded as 10, 15, 17, 19, 24, 31, 38, 62), which is why the bitstream-filter recipe was needed. That the wrong tag "propagates" through YouTube is an inference from YouTube's one-line statement, not tested.

### FD20-F13 — Playwright's recorder is a debugging tool: 800x800 default, fixed 1 Mbps VP8 at 25 fps in the current release, frames pre-compressed to JPEG
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:**
  - Playwright's `recordVideo` defaults to the viewport scaled to fit 800x800.
  - In v1.63.0, the latest release (2026-09-04), the recorder encodes VP8 at `-b:v 1M` and 25 fps with one thread, from screencast JPEG frames at quality 90.
  - The unreleased main branch scales bitrate with pixel rate. Its comment admits that at 1920x1080 and 60 fps the 1 Mbps budget "visibly blurs scrolling text".
  - A custom-fps option (#42752, merged 2026-09-17) is on main only.
- **Implication for /frontend:**
  - Use Playwright for lossless PNG captures and for the checks.
  - Never use `recordVideo` output as the judge's master or as evidence of how legible the video is.
  - If a scripted recording is wanted, record with OBS or Screen Studio while Playwright drives the page, or pipe screenshots to ffmpeg.
- **Evidence:**
  - [docs/src/videos.md](https://github.com/microsoft/playwright/blob/main/docs/src/videos.md) — Microsoft Playwright, main, accessed 2026-10-01 — official docs source.
    - "The video size defaults to the viewport size scaled down to fit 800x800."
  - [packages/playwright-core/src/server/videoRecorder.ts @ v1.63.0](https://github.com/microsoft/playwright/blob/v1.63.0/packages/playwright-core/src/server/videoRecorder.ts) — accessed 2026-10-01 — source code.
    - "const fps = 25;" · "-c:v vp8 -qmin 0 -qmax 50 -crf 8 -deadline realtime -speed 8 -b:v 1M -threads 1"
  - [videoRecorder.ts @ main](https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/server/videoRecorder.ts) — last commit f8ac602a30 (2026-09-30), accessed 2026-10-01 — source code.
    - "Larger or faster videos get the bitrate scaled with the pixel rate: at 1920x1080 and 60fps" / "the 1M budget visibly blurs scrolling text, while the scaled ~14M is visually lossless."
  - [screencast.ts @ v1.63.0](https://github.com/microsoft/playwright/blob/v1.63.0/packages/playwright-core/src/server/screencast.ts) — accessed 2026-10-01 — source code.
    - "quality: quality ?? 90," (and `crPage.ts` @ v1.63.0 sends `Page.startScreencast` with `format: 'jpeg'`)
  - Command run: `gh api repos/microsoft/playwright/commits?path=packages/playwright-core/src/server/videoRecorder.ts` → "8bb2c0972a 2026-09-17T17:25:05Z feat(video): allow recording video at a custom fps (#42752)"; `gh api repos/microsoft/playwright/releases` → latest "v1.63.0 2026-09-04T22:40:31Z".
- **Limits / false positives:**
  - FD06 already covers the CLI's `video-start`. This finding covers the library path.
  - The main-branch behaviour may change before release.
  - Verifier note: Screen Studio is macOS-only (F14), so on the owner's Windows machine the scripted-recording options are OBS or ffmpeg piping.

### FD20-F14 — The cursor: a Playwright video shows none, and dedicated recorders re-render it enlarged and smoothed
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:**
  - A playwright-core 1.59 `recordVideo` of a flat grey page, with 41 mouse moves and a click, produced 56 frames whose luma never left 127 to 129: no pointer was drawn.
  - Since v1.61, Playwright's `screencast.showActions` can draw an animated pointer ("pointer", the default).
  - Screen Studio records the cursor separately, so it can be resized and smoothed after recording, and clicks ripple. It is macOS only.
  - Windows can enlarge the system pointer and change its colour.
- **Implication for /frontend:**
  - The recording spec must name a cursor: either an enlarged, high-contrast system pointer (OBS on Windows) or a recorder with cursor effects.
  - UI states must never depend on cursor position to make sense (see F15).
- **Evidence:**
  - Experiment E5, `_scripts/fd20/experiments/e5-cursor.mjs` — run 2026-10-01 — in-session observation; the verifier re-ran the script's signalstats pass on the stored `cursor-test.webm` (56 frames, YMIN 127 to 128, YMAX 127 to 129).
    - Output: "frames 56 min YMIN 127 max YMAX 129"; ffprobe: "codec_name=vp8|width=1280|height=720|r_frame_rate=25/1"
  - [docs/src/api/class-screencast.md @ v1.63.0](https://github.com/microsoft/playwright/blob/v1.63.0/docs/src/api/class-screencast.md) — Microsoft Playwright, accessed 2026-10-01 — official API docs (`showActions` since v1.59; its `cursor` option since v1.61).
    - "Cursor decoration shown for pointer actions. `"pointer"` (the default) renders a mouse pointer that animates from the previous action point to the next one."
  - [Screen Studio](https://screen.studio/) — Screen Studio homepage and FAQ, accessed 2026-10-01 — vendor page.
    - "it can apply many effects after the video is recorded, such as making mouse movement smooth, changing cursor size and shape, etc. Most screen recording apps record your screen with the mouse cursor, making it impossible to apply cursor effects after the recording is done."
    - "Currently, Screen Studio only supports macOS."
    - "A quiet circle or ripple, so every click is easy to follow"
  - [Make your mouse, keyboard, and other input devices easier to use](https://support.microsoft.com/en-us/windows/make-your-mouse-keyboard-and-other-input-devices-easier-to-use-10733da7-fa82-88be-0672-f123d4b3dcfe) — Microsoft Support, accessed 2026-10-01 — official docs.
    - "Under Mouse pointer , adjust the Size slider until your mouse pointer is the size you'd like. Under Mouse pointer style , select an option to change the color of your mouse pointer to white, black, inverted, or any of the bright recommended colors."
- **Limits / false positives:**
  - Tested on playwright-core 1.59 (matching the installed Chromium), not 1.63.
  - No official source was found for the default Windows pointer size in pixels.
  - Verifier note: the same FAQ answers "Is the Windows version ready?" with "No, and there are no near-future plans to add Windows support." The owner records on Windows 11.

### FD20-F15 — Content that appears only on hover is absent from a recording unless someone scripts the hover
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:**
  - WCAG 1.4.13 defines hover-triggered content as content that becomes visible on hover and hidden when hover is removed.
  - Tooltips from the HTML `title` attribute are drawn by the user agent. They sit outside the page's pixels, so a page-level capture such as a Playwright screenshot or screencast cannot include them (my inference, untested), and an OS-level recording shows them only while the cursor rests on the element.
  - Many primary input devices cannot hover at all (`hover: none`).
  - The checker's live probe hovered a fixture's `.info` trigger (found by parsing `.info:hover .tip`) and reported the text that appeared, "Refund after 72 h if the seller never ships".
- **Implication for /frontend:**
  - Anything a judge must see (an explanation, a value, a status) is rendered at rest.
  - A hover may be scripted in the recording only for an explicitly listed moment.
  - The checker FAILs on text revealed by hover and WARNs on `:hover` visibility rules and `title` tooltips.
- **Evidence:**
  - [WCAG 2.2](https://www.w3.org/TR/WCAG22/) — W3C Recommendation 12 December 2024, accessed 2026-10-01 — standard.
    - SC 1.4.13: "Where receiving and then removing pointer hover or keyboard focus triggers additional content to become visible and then hidden, the following are true"
    - "Examples of additional content controlled by the user agent include browser tooltips created through use of the HTML title attribute [ HTML ]."
  - [hover CSS media feature (MDN source)](https://github.com/mdn/content/blob/main/files/en-us/web/css/reference/at-rules/@media/hover/index.md) — MDN, accessed 2026-10-01 — official reference.
    - "The primary input mechanism cannot hover at all or cannot conveniently hover (e.g., many mobile devices emulate hovering when the user performs an inconvenient long tap), or there is no primary pointing input mechanism."
  - Checker run on `_scripts/fd20/fixtures/fixture-bad.html` — 2026-10-01 — in-session observation (`results/recording-check-fixture-bad.report.json`); the verifier's six runs reported the same hover finding and the same revealed text.
    - "FAIL | hover-only | 1 elements reveal text only on hover; show it at rest or script the hover in the recording"
- **Limits / false positives:**
  - The probe hovers at most 60 triggers in the first viewport.
  - It cannot read cross-origin stylesheets; it reports them as INFO.
  - Hover effects that change only colour are not flagged.

### FD20-F16 — Motion in a 25 to 30 fps recording: UI transitions last 2 to 15 frames, reading needs about 0.3 s per word, and flashes above 3 per second are restricted
- **Grade:** A · **Kind:** ASSERTED · **Verdict:** CORRECTED
- **Claim:**
  - NN/g puts most UI animations at 100 to 500 ms, and 100 ms is the lower end of perceivable motion.
  - Recording rates differ by tool: 25 fps by default in Playwright and 30 fps in Loom, while YouTube asks for uploads at the frame rate they were recorded in. At 25 fps a 100 ms transition spans 2.5 frames (my arithmetic). (corrected: YouTube's page is an upload recommendation, not a statement that it keeps the rate)
  - BBC subtitles allow about 0.3 s per word, for example 1.2 s for four words.
  - WCAG 2.3.1 (Level A) bans more than three flashes in any one second unless the flashes are below the general flash and red flash thresholds, which a small flashing area can be. SC 2.3.2 (Level AAA) bans more than three flashes in any one second outright. The checker's 333 ms FAIL is therefore stricter than 2.3.1 and matches 2.3.2. (corrected: the threshold exemption had been dropped)
  - Screen Studio adds motion blur to quick moves.
- **Implication for /frontend:**
  - A state change that carries proof must settle within 400 ms and then hold still for at least 0.33 s per word of its label (at least 1.2 s).
  - Decorative loops (pulses, tickers, marquees) freeze in record mode.
  - Blinking faster than 333 ms per cycle FAILs (a design choice aligned with SC 2.3.2, not a 2.3.1 violation in itself).
  - Scroll only between states, never while a value must be read.
- **Evidence:**
  - [Executing UX Animations: Duration and Motion Characteristics](https://www.nngroup.com/articles/animation-duration/) — Page Laubheimer, Nielsen Norman Group, 9 Feb 2020, accessed 2026-10-01 — reputable practitioner research.
    - "In general, the duration of most animations should be in the range of 100–500 ms, depending on complexity and on how far the element is traveling."
    - "100 ms is at the lower end of perceivable motion, where it almost feels like an instantaneous jump from one place to another, but is enough to make the feedback noticeable."
  - [BBC Subtitle Guidelines](https://www.bbc.co.uk/accessibility/forproducts/guides/subtitles/) — BBC, Version 1.2.5, March 2026, accessed 2026-10-01 — official guideline.
    - "you should aim to leave a subtitle on screen for a minimum period of around 0.3 seconds per word (e.g. 1.2 seconds for a 4-word subtitle)."
  - [WCAG 2.2](https://www.w3.org/TR/WCAG22/) — W3C, accessed 2026-10-01 — standard.
    - SC 2.3.1 (Level A): "Web pages do not contain anything that flashes more than three times in any one second period, or the flash is below the general flash and red flash thresholds."
    - SC 2.3.2 (Level AAA): "Web pages do not contain anything that flashes more than three times in any one second period." (verifier addition)
    - Definition: a flash sequence is below the threshold if "the combined area of flashes occurring concurrently occupies no more than a total of .006 steradians within any 10 degree visual field on the screen (25% of any 10 degree visual field on the screen) at typical viewing distance" (verifier addition)
  - [Loom video encoding settings](https://support.atlassian.com/loom/docs/loom-video-encoding-settings-by-platform/) — "Frame Rate: Target 30fps"; [videoRecorder.ts @ v1.63.0](https://github.com/microsoft/playwright/blob/v1.63.0/packages/playwright-core/src/server/videoRecorder.ts) — "const fps = 25;"; both accessed 2026-10-01.
  - [Screen Studio](https://screen.studio/) — accessed 2026-10-01 — vendor page.
    - "Optics-based motion blur makes every quick move look far smoother, the way a camera would film it."
- **Limits / false positives:**
  - NN/g's numbers concern interactive use, not viewers of a video.
  - Subtitle dwell times are for reading captions and are borrowed here as a floor for on-screen labels.
  - The 400 ms settle time and 0.33 s per word are design choices derived from these sources, not quoted values.

### FD20-F17 — Projectors lift black: at the PISCR minima, dark UIs lose more contrast than light ones
- **Grade:** B · **Kind:** ASSERTED · **Verdict:** CORRECTED
- **Claim:**
  - PISCR is ANSI/INFOCOMM 3M-2011, Projected Image System Contrast Ratio (dated 2011-06-30, front and rear projection), which defines four viewing categories with minimum system contrast measured in the room with ambient light. The trade press reports the minima as 7:1 for passive viewing, 15:1 for basic decision making, 50:1 for analytical work and 80:1 for full-motion video. (corrected: the trade-press article does not name "3M-2011"; the designation comes from the ANSI preview, and the ratio values still come only from the trade press)
  - AVIXA has since published ANSI/AVIXA V201.01:2021, Image System Contrast Ratio, which applies to "all displayed images regardless of AV technology (e.g., direct view display, rear projection, front projection)". Its minima were not opened. (added at verification)
  - Model (my derivation): if the projector adds a black floor of 1/C, WCAG's formula corresponds to C = 21. Under that model:

    | pair | WCAG | at 15:1 | at 7:1 |
    |---|---|---|---|
    | grey-500 on white | 4.83 | 4.49 | 3.49 |
    | grey-500 on #0a0a0a | 4.10 | 3.20 | 1.97 |
    | grey-400 on #0a0a0a | 7.80 | 5.84 | 3.12 |
    | blue-500 on #0a0a0a | 5.38 | 4.12 | 2.37 |
    | ink on white | 17.74 | 13.29 | 6.63 |

- **Implication for /frontend:**
  - For the Ledger OP3N finals and the TOKEN2049 stage, prefer light surfaces, or give dark UIs text with 7:1 or more.
  - The checker WARNs when text passes WCAG on screen but drops below 4.5:1 at a 15:1 floor.
- **Evidence:**
  - [InfoComm’s PISCR Standard Maximizes Image Capabilities in Ambient Light](https://www.commercialintegrator.com/news/infocomms_piscr_standard_maximizes_image_capabilities_in_ambient_light/8243/) — Robert Archer, Commercial Integrator, 6 Jun 2016, accessed 2026-10-01 (read through Exa, since direct fetch returned 403) — trade press.
    - "Passive viewing requires a minimum contrast ratio of 7:1." · "Minimum contrast ratio is 15:1." (basic decision making) · "Minimum contrast ratio is 50:1." (analytical) · "Minimum contrast ratio is 80:1." (full motion video)
    - "the maximum contrast ratio a projector and screen can deliver is ultimately affected and thus determined by ambient light."
    - "Note that the standard does not apply to flat-panel displays regardless of what technology they employ (LED, LCD, plasma and OLED)" (verifier addition)
  - [ANSI/INFOCOMM 3M-2011 preview](https://webstore.ansi.org/preview-pages/InfoComm/preview_ANSI+INFOCOMM+3M-201.pdf) — InfoComm International, 2011-06-30, ANSI webstore preview, accessed 2026-10-01 (read through Exa) — standard front matter (verifier addition).
    - "ANSI/INFOCOMM 3M-2011 Projected Image System Contrast Ratio" · "It applies to front and rear projection." · "this Standard defines four viewing categories based on their stated purpose and establishes the required minimum contrast ratios for each viewing category."
  - [Image System Contrast Ratio](https://www.avixa.org/resources/standards/image-system-contrast-ratio) — AVIXA, "Document Number V201.01:2021", accessed 2026-10-01 (read through Exa) — standards page (verifier addition).
  - [WCAG 2.2](https://www.w3.org/TR/WCAG22/) — W3C, accessed 2026-10-01 — "(L1 + 0.05) / (L2 + 0.05)".
  - Model computed 2026-10-01; the function `projected()` is exported by `_scripts/fd20/recording-check.mjs` — derivation; the verifier recomputed every cell of the table.
- **Limits / false positives:**
  - The ratio values were not read in a standard text; the ANSI preview stops before the requirements section.
  - PISCR covers projection only. An LED wall or flat panel on a stage falls under the 2021 successor, whose minima were not opened.
  - The additive-floor model ignores projector gamma, uneven ambient light and screen gain.

### FD20-F18 — Room sizing by AVIXA DISCAS: a lowercase letter's share of image height sets the farthest seat
- **Grade:** A · **Kind:** ASSERTED · **Verdict:** VERIFIED
- **Claim:**
  - DISCAS defines Percent Element Height as the share of the display a lowercase letter occupies. For basic decision making, the farthest viewer distance equals image height × %EH × 200; AVIXA's own example is "36.8 x .02 x 200". AVIXA calls 2 to 4% typical and 3% a good starting point.
  - Applied to Inter (x-height 0.547 em) on a 1080-pixel image (my derivation), the farthest viewer sits about (x-height in device px) / 5.4 image heights away, x-height being font size × 0.547 × zoom:
    - 16 px at 125% zoom reads to about 2.0 image heights, or 3.0 m for a 1.5 m image;
    - 32 px at 125% to about 4.1 image heights (6.1 m);
    - 48 px at 125% to about 6.1 image heights (9.1 m).
- **Implication for /frontend:**
  - Only key text will be read from the back of a room.
  - For the Ledger finals, make the claim and proof values 32 to 48 CSS px and accept that body text is for the front row.
  - With the room's dimensions known, the formula yields the minimum size directly.
- **Evidence:**
  - [CTS-Prep Workshop I: Aspect Ratio and DISCAS](https://cdn.avixa.org/production/docs/default-source/default-document-library/cts-prep-aspect-ratio-and-discas-apr2020.pdf?sfvrsn=56494d78_2) — AVIXA (Jose Mozota CTS, CTS-I), Italy, April 2020, accessed 2026-10-01 — official training material from the standard's publisher.
    - "Percent Element Height - Percentage of display that the element takes up • With text: lowercase letter"
    - "BDM is the most common type of viewing category • Concerned with overall content rather than detail • Used for PowerPoint, word processing, and spreadsheets"
    - "For 2%EH: 36.8 x .02 x 200 or 934 x .02 x 200 • FV for 2%EH = 147.2 inches (3736 mm) or 12.3 feet"
    - "Typically use something from 2% Element Height to 4% Element Height • Depends upon client’s needs • A 3% Element Height is a good starting point"
    - "5 minutes of arc for optotype • 1 minute of arc for line"
  - [Learn More About Display Size](https://www.avixa.org/resources/display-image-size-calculators/learn-more-about-display-size) — AVIXA, accessed 2026-10-01 (read through Exa) — first-party page (verifier addition): "For BDM Acuity of 200", with a viewing ratio of 2.00 to 3.00 requiring a minimum %Element Height of 1.50%, consistent with the × 200 formula.
  - [AVIXA V202.01:2016 preview](https://webstore.ansi.org/preview-pages/InfoComm/preview_AVIXA+V202.01-2016.pdf) — AVIXA (formerly ANSI/INFOCOMM V202.01:2016), 2016-05-23, ANSI webstore preview, accessed 2026-10-01 (read through Exa) — standard front matter (verifier addition). Exceptions: "This Standard does not: … Apply to single-user displays (e.g., computer monitors, laptop screens)."
  - The verifier recomputed the three derived distances (2.03, 4.05 and 6.08 image heights).
- **Limits / false positives:**
  - I read AVIXA's training deck, not the ANSI/AVIXA V202.01 standard.
  - The derived table assumes that the projected image shows exactly 1080 device px.
  - Verifier note: AVIXA's store lists ANSI/AVIXA V202.01:2026 (published April 2026); whether it changed the BDM acuity factor was not checked. DISCAS excludes single-user displays, so it applies to the finals room, not to a judge watching on a laptop.

### FD20-F19 — Browser zoom at 125% or 150% is a layout test and a legibility lever: design first for a 1536 CSS px viewport
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:**
  - Page zoom raises `devicePixelRatio`, so a 1920x1080 screen at 125% and 150% zoom offers 1536x864 and 1280x720 CSS px.
  - Windows itself sets 125% and 150% scale factors on dense displays.
  - The checker's zoom pass found the fixture scrolling sideways by 260 CSS px at 125% and 516 px at 150% (a 1,700 px-wide element).
  - Recording at 125% makes every CSS size 1.25 times larger in the video: 16 px becomes 20 device px and passes F04's 720p tier with margin (my derivation).
- **Implication for /frontend:**
  - Build the first viewport for 1536x864 CSS px (the owner has seen a stage run at 125%).
  - Require no horizontal overflow at 1536 and 1280.
  - Recommend recording at 125% zoom.
  - The checker FAILs on horizontal overflow and WARNs when key elements leave the first viewport.
- **Evidence:**
  - [Window: devicePixelRatio property (MDN source)](https://github.com/mdn/content/blob/main/files/en-us/web/api/window/devicepixelratio/index.md) — MDN, accessed 2026-10-01 — official reference.
    - "Page zooming affects the value of `devicePixelRatio`. When a page is zoomed in (made larger), the size of a CSS pixel increases, and so the `devicePixelRatio` value increases."
  - [High DPI and Windows 8.1](https://learn.microsoft.com/en-us/windows-hardware/manufacture/desktop/high-dpi-and-windows?view=windows-11) — Microsoft Learn, accessed 2026-10-01 — official docs (written for Windows 8 and 8.1). (corrected: the page title is "High DPI and Windows 8.1", not "High DPI support for Windows (hardware manufacturing)")
    - "Windows scaling has to move from 100% (13.3” 1366x768) to 125% (13.3” 1600x900), 150% (10.6” 1920x1080) or 200% (13.3” 2560x1440)."
  - Checker run on `fixture-bad.html` — 2026-10-01 — in-session observation; identical zoom results in the verifier's six runs.
    - "FAIL | zoom | at 125% zoom the page scrolls sideways by 260 CSS px" · "FAIL | zoom | at 150% zoom the page scrolls sideways by 516 CSS px"
- **Limits / false positives:**
  - The zoom was emulated with `deviceScaleFactor` and a smaller viewport, not with Chrome's zoom UI. For layout the two are equivalent, but they rasterise text differently.
  - The Microsoft page predates Windows 11.

### FD20-F20 — Frozen data: Playwright can freeze time and replay the network, but the real recording needs the app's own fixture mode
- **Grade:** A · **Kind:** ASSERTED · **Verdict:** CORRECTED
- **Claim:**
  - Playwright recommends `clock.setFixedTime` for predictable time.
  - Its clock overrides Date, the timers, `requestAnimationFrame` and `performance`. CSS animations are not in that list.
  - `routeFromHAR` can record real responses once (`update: true`) and replay them.
  - Both work only in a Playwright-driven browser. A recording made with OBS or Screen Studio in the owner's browser gets none of it.
- **Implication for /frontend:**
  - Checks use Playwright's clock and HAR replay.
  - The product ships a record mode (for example `?record=1`) that serves a named fixture or snapshot, fixes the displayed time, seeds randomness and freezes decorative animation, while keeping visible provenance labels (F21).
  - The checker freezes animations itself (finite ones jump to their end, infinite ones pause and seek to their first keyframe), but that does not yield a deterministic frame. On the bad fixture the report table varied between runs: the researcher's five recorded runs (two with an earlier checker version, three with the current one) all printed CAMBI 12.566 with 3 contrast failures, while the verifier's six runs with the current checker file printed CAMBI 12.356 with 3 failures once and 12.613 with 4 failures five times. The 1080p captures of two verifier runs differed in 222 pixels, all inside the blinking "LIVE" badge. Exit code 2 held in all eleven runs, and the counts of 8 FAIL, 8 WARN and 3 INFO in the nine runs of the current version (the earlier version printed 7 WARN). To make the report deterministic, the page must be frozen by its own record mode before capture (or the checker must wait for a frame after seeking), and fixtures must not load fonts from the network. (corrected: the original said two runs "printed identical report tables" and presented the frame as deterministic; that identical pair was made with an earlier checker version)
- **Evidence:**
  - [docs/src/clock.md @ v1.63.0](https://github.com/microsoft/playwright/blob/v1.63.0/docs/src/clock.md) — Microsoft Playwright, accessed 2026-10-01 — official docs source.
    - "The recommended approach is to use `setFixedTime` to set the time to a specific value."
    - "[`property: Page.clock`] overrides native global classes and functions related to time allowing them to be manually controlled: - `Date` - `setTimeout` - `clearTimeout` - `setInterval` - `clearInterval` - `requestAnimationFrame` - `cancelAnimationFrame` - `requestIdleCallback` - `cancelIdleCallback` - `performance` - `Event.timeStamp`"
  - [docs/src/mock.md @ v1.63.0](https://github.com/microsoft/playwright/blob/v1.63.0/docs/src/mock.md) — accessed 2026-10-01 — official docs source.
    - "Setting `update` option to true will create or update the HAR file with the actual network information instead of serving the requests from the HAR file."
  - Researcher's runs: two checker runs on the fixture, then `diff` of the printed report tables → "IDENTICAL" — 2026-10-01 00:14 — in-session observation (tables in the researcher's scratch `lab/out/rc-run1.txt` and `rc-run2.txt`, which show 8 FAIL, 7 WARN and 3 INFO, i.e. a checker version older than the published one; the later `rc-final-bad.txt` and `rc-final-bad2.txt` at 00:25 and 00:27 also match each other, and `rc-final-bad3.txt` at 00:35 is the only researcher run of the published file). (corrected: dated and tied to the checker version that produced it)
  - Verifier's runs: `node recording-check.mjs --url fixtures/fixture-bad.html` six times, 2026-10-01, playwright-core 1.59.0, Chromium 147.0.7727.15 headless shell, ffmpeg 9.0.2 — first `diff` of runs 1 and 2 → tables differ ("3 visible text runs" against "4", "CAMBI … 12.356" against "12.613"); pixel diff of the two `capture-1080.png` files → 222 pixels in the box x 136 to 168, y 263 to 274. Viewed side by side, run 1 shows "LIVE" and run 2 shows the badge blank; in runs 2 to 6 the report lists "LIVE" among the contrast failures at 1:1, so the screenshot caught the blink at opacity 0, not the first keyframe the freeze aims for. (verifier addition)
- **Limits / false positives:**
  - A frozen chain state (a fixed block height or balance) must still be real or labelled simulated; freezing is not permission to invent (F21).
  - The cause of the researcher's stable 12.566 is not established; the fixture also loads Inter from fonts.googleapis.com at run time, a second source of drift.

### FD20-F21 — Honest labels: a demonstration presented as proof must be genuine or disclosed; label live, testnet and simulated data and time-stamp it
- **Grade:** A · **Kind:** ASSERTED · **Verdict:** VERIFIED
- **Claim:**
  - In *FTC v. Colgate-Palmolive* the Supreme Court sustained an order against presenting a test "as actual proof of a claim" when it is not genuine "because of the undisclosed use and substitution of a mock-up". Props that are not offered as proof were left outside the order.
  - Devpost asks for "a clear demo of your project functioning".
  - The Cardano track asks for "a working prototype on Cardano network".
- **Implication for /frontend:**
  - Every data region carries a visible provenance label (live, testnet or preprod with the chain name, simulated or fixture) and an as-of time or block height.
  - Simulated values are never styled as on-chain proof.
  - The checker WARNs when numbers appear without a label or stamp, and reads `data-provenance` and `data-as-of` when present.
- **Evidence:**
  - [FTC v. Colgate-Palmolive Co., 380 U.S. 374](https://www.law.cornell.edu/supremecourt/text/380/374) — U.S. Supreme Court, decided April 5, 1965 (Cornell LII), accessed 2026-10-01 — judgment.
    - "presenting a test, experiment or demonstration that (1) is represented to the public as actual proof of a claim made for the product which is material to inducing its sale, and (2) is not in fact a genuine test, experiment or demonstration being conducted as represented and does not in fact constitute actual proof of the claim, because of the undisclosed use and substitution of a mock-up or prop instead of the product"
    - "Clearly, however, a commercial which depicts happy actors delightedly eating ice cream that is in fact mashed potatoes or drinking a product appearing to be coffee but which is in fact some other substance is not covered by the present order."
  - [The WebMCP Challenge — Official Rules](https://webmcp.devpost.com/rules) — Devpost, accessed 2026-10-01 — "must include a clear demo of your project functioning".
  - [Cardano — Agentic Commerce track data](https://edge.builderbase.com/events/public/cardano-agentic-commerce) — accessed 2026-10-01 — "A working prototype on Cardano network: a DApp with a frontend, or a tool/agent with a live demo."
- **Limits / false positives:**
  - US advertising law applied by analogy. A hackathon video is not an advertisement under the FTC Act.
  - The checker's provenance test is a regular expression; it cannot tell whether a label is true.
  - Verifier note: the order quoted is the Commission's final order of May 7, 1963, which the Court sustained.

### FD20-F22 — Ledger flows: the device screen is off-camera, so mirror the device step in the page
- **Grade:** A · **Kind:** ASSERTED · **Verdict:** VERIFIED
- **Claim:**
  - Ledger's Device Management Kit reports a `Pending` state with `requiredUserInteraction`, for example "User needs to sign the typed data displayed on the device", and a `step` for signing flows.
  - Speculos emulates Nano X, Nano S+, Flex, Stax and Apex+. It serves the device display in a browser and offers REST screenshots and screen text.
- **Implication for /frontend:**
  - For the Ledger OP3N build, render a device-step panel ("Confirm on your Ledger: …") driven by `requiredUserInteraction`, so that a screen recording shows what the user approves.
  - In development, use Speculos's `/screenshot` to show what the device displays. For the finals, film the real device or show the emulator side by side, labelled as such.
- **Evidence:**
  - [Ethereum Signer Kit](https://developers.ledger.com/docs/device-interaction/dmk-ts/references/signers/eth) — Ledger Developer Portal, accessed 2026-10-01 — official docs.
    - "When the status is DeviceActionStatus.Pending, the state will include an intermediateValue object that provides useful information for interaction. The intermediateValue contains: requiredUserInteraction : Indicates what action is needed from the user step : The current step in the device action flow, available for the ‘signTransaction’ and ‘signTypedData’ flow."
    - "User needs to sign the typed data displayed on the device."
  - [Speculos Quickstart](https://speculos.ledger.com/user/quickstart.html) and [Driving Speculos from code or an agent](https://speculos.ledger.com/user/agent.html) — Ledger, accessed 2026-10-01 — official docs.
    - "Speculos emulates Ledger devices ( Nano X , Nano S+ , Flex , Stax , Apex+ ) on a regular computer, so you can run and drive a device app without any hardware."
    - "Everything a human does in the web UI — sending commands, pressing buttons, reading the screen, taking screenshots — is available programmatically."
- **Limits / false positives:**
  - Whether OP3N judges accept emulator footage is unknown.
  - Clear-signing screens differ per app and per device.

### FD20-F23 — Muted viewing and captions: the picture must tell the story, captions must be burned in, and ETHGlobal and Devpost still want a human voice
- **Grade:** A · **Kind:** ASSERTED · **Verdict:** CORRECTED
- **Claim:**
  - Xbox guidance notes that muted players rely on on-screen text.
  - WCAG 1.2.2 requires captions for prerecorded audio.
  - BBC subtitlers must transcribe on-screen text that the stream's size or quality made illegible.
  - PowerPoint drops caption tracks on Compress Media (F02).
  - ETHGlobal tells teams not to use music with on-screen text instead of talking, nor text-to-speech or AI voiceover, and asks teams whose video breaks these rules to re-submit it. (corrected: the page does not say such videos are rejected; the consequence it states is a re-submission request)
  - The Devpost template opened requires "audio that covers what you built" (F01). (added at verification)
- **Implication for /frontend:**
  - For BNB (possibly watched muted), each state carries a short on-screen label that says what just happened ("Refund released, block 1,284,211"). Captions go into the picture.
  - For ETHGlobal- and Devpost-style events the narration is a human voice; the labels still carry the facts.
- **Evidence:**
  - [Xbox Accessibility Guideline 101](https://learn.microsoft.com/en-us/gaming/accessibility/xbox-accessibility-guidelines/101) — Microsoft, accessed 2026-10-01 — official guideline.
    - "Sometimes when players are in a situation in which their TV volume should be muted, or conversely, when their environment is very noisy, they rely on on screen text to obtain information that they can't hear."
  - [WCAG 2.2](https://www.w3.org/TR/WCAG22/) — W3C, accessed 2026-10-01 — SC 1.2.2: "Captions are provided for all prerecorded audio content in synchronized media, except when the media is a media alternative for text and is clearly labeled as such."
  - [BBC Subtitle Guidelines](https://www.bbc.co.uk/accessibility/forproducts/guides/subtitles/) — BBC, v1.2.5, accessed 2026-10-01 — "If the onscreen graphics are not easily legible because of the streamed image size or quality, the subtitles must include any text contained within those graphics which provide contextual information."
  - [Make your PowerPoint presentations accessible](https://support.microsoft.com/en-us/office/make-your-powerpoint-presentations-accessible-to-people-with-disabilities-6f7772b2-2f33-4bd2-8ca7-dae3b2b3ef25) — Microsoft, accessed 2026-10-01 — "Closed captions, subtitles, and alternative audio tracks are not preserved when you use the Compress Media or Optimize Media Compatibility features."
  - [ETHGlobal New Delhi — Event details](https://ethglobal.com/events/newdelhi/info/details) — accessed 2026-10-01 — "DO NOT play music with text on the video describing your project (instead of talking)" · "DO NOT use a text to speech synthesizer / AI Voiceover" · "If we see one or more of these items on your submission, you will be asked to re-submit the video."
  - [The WebMCP Challenge — Official Rules](https://webmcp.devpost.com/rules) — Devpost, accessed 2026-10-01 — "must include a clear demo of your project functioning and with audio that covers what you built and how you used WebMCP" (verifier addition)
- **Limits / false positives:** Whether BNB judges watch muted is the owner's assumption, not a published rule.

### FD20-F24 — Recording pipeline: record at native resolution in a crash-safe container (MKV or OBS's Hybrid MP4), export to MP4 with fast start, and simulate the judge's copy with ffmpeg
- **Grade:** A · **Kind:** ASSERTED · **Verdict:** CORRECTED
- **Claim:**
  - OBS's 2023 recording guide recommends MKV because an ungraceful stop corrupts less, can remux to MP4 automatically, and can rescale output (which the master should not do).
  - OBS 30.2 (July 2024) added Hybrid MP4, which "remains recoverable even if writing the file is aborted", and OBS 32.0 (September 2025) made Hybrid MP4/MOV the default output format for new profiles. On a current OBS, the default container is already crash-safe; MKV remains a valid choice. (corrected: the 2023 guide predates Hybrid MP4, so "MKV master" is no longer the only safe choice)
  - YouTube wants the moov atom first ("Fast Start"). A Hybrid MP4 writes its full moov at the end of the file, so the export step with `-movflags +faststart` still applies.
  - The ffmpeg recipes in Deliverable E (720p and 540p judge copies, the CAMBI score, the tag check, the deck export) were each run in this session.
- **Implication for /frontend:**
  - The recording spec names: native 1920x1080 capture, no rescale, an MKV or Hybrid MP4 master, then an H.264/AAC MP4 export with fast start and BT.709 tags.
  - /frontend runs the judge-copy simulation as part of the build gate, not after recording.
- **Evidence:**
  - [Standard Recording Output Guide](https://obsproject.com/kb/standard-recording-output-guide) — OBS Project knowledge base, 2023-05-26, accessed 2026-10-01 — official docs.
    - "MKV is recommended in case of unforeseen issues arising, since MKV will not corrupt the whole file if there is no graceful stoppage of recording."
    - "You can also select Automatically remux to mp4 if you know you’ll always need your videos remuxed."
    - "You’re also able to rescale the output to have a different resolution, but maintained aspect ratio, relative to your canvas size in OBS."
  - [Hybrid MP4 & Hybrid MOV Formats](https://obsproject.com/kb/hybrid-mp4) — OBS Project knowledge base, 2024-06-06, accessed 2026-10-01 — official docs (verifier addition).
    - "Hybrid MP4 and Hybrid MOV are the names of new output formats introduced in OBS 30.2 (Hybrid MP4) and OBS 32.0 (Hybrid MOV), that aim to provide reliable and compatible output without the drawbacks of traditional or fragmented MP4/MOV. It remains recoverable even if writing the file is aborted, e.g. due to system crashes or power outages, while still maintaining wide compatibility."
  - [OBS Studio 32.0 Release Notes](https://obsproject.com/blog/obs-studio-32-0-release-notes) — OBS Project, 2025-09-22, accessed 2026-10-01 — official release notes (verifier addition).
    - "Hybrid MP4/MOV is now out of beta and has been made the default output format for new profiles"
  - [OBS Studio 30.2 Release Notes](https://obsproject.com/blog/obs-studio-30-2-release-notes) — OBS Project, 12 July 2024, accessed 2026-10-01 — "Added "Hybrid MP4" output format (BETA)" (verifier addition).
  - [Writing an MP4 Muxer for Fun and Profit](https://obsproject.com/blog/obs-studio-hybrid-mp4) — OBS Project blog, 2024-07-12, accessed 2026-10-01 — "a full moov is written at the very end of the file that indexes the media data exactly like a normal MP4 would" (verifier addition).
  - [YouTube recommended upload encoding settings](https://support.google.com/youtube/answer/1722171?hl=en) — Google, accessed 2026-10-01 — "moov atom at the front of the file (Fast Start)"
  - Commands run 2026-10-01 (outputs quoted in F02 and F12) — in-session observation; the verifier re-ran the deck export and the mistag recipe.
- **Limits / false positives:** Only 30 fps synthetic clips were tested. Screen Studio's own export settings were not opened (the pages returned the vendor's LLM summary). Which OBS version the owner runs, and whether an existing profile still uses MKV or plain MP4, is unknown.

### FD20-F25 — A literal ".ppt" deck turns the embedded video into a still picture: read TOKEN2049's ".ppt or .keynote only" as .pptx or Keynote .key, and confirm it (added at verification)
- **Grade:** A · **Kind:** ASSERTED · **Verdict:** VERIFIED (added at verification)
- **Claim:**
  - TOKEN2049 asks for "a Google Drive link to a .ppt or .keynote file" and for the screen recording to be embedded in the slides (F01).
  - Microsoft: when a presentation is saved as PowerPoint 97-2003 (.ppt), "Media clips that are embedded or upgraded in PowerPoint 2010 or newer versions are converted to an image"; the Mac version of the page adds that "The media object is permanently converted to a picture." Microsoft's workaround is to link the file instead of embedding it, which TOKEN2049 forbids for external video and which would not survive a Google Drive link.
  - For a presentation already saved as .pptx, modern PowerPoint does not offer .ppt under Save As by default; it is reached through Export > Change File Type.
  - IANA's registration for Keynote documents lists the file extension .key; ".keynote" is not listed. Keynote saves a single file by default but suggests a package for presentations over 500 MB or with large video, and some upload services refuse package files.
- **Implication for /frontend (recording spec and deck handoff):**
  - Never export the TOKEN2049 deck as 97-2003 .ppt. Deliver .pptx (or a single-file Keynote .key) with the H.264 MP4 embedded, and get the organisers' confirmation that .pptx counts before the deadline (Wed 7 Oct 23:59 SGT).
  - Keep a Keynote deck as a single file, not a package, so that Google Drive stores it as one file.
  - Before submitting, download the deck from the Google Drive link on another machine and play the video in Slide Show.
- **Evidence:**
  - [Compatibility Checker in PowerPoint](https://support.microsoft.com/en-us/powerpoint/compatibility-checker-in-powerpoint) — Microsoft Support, accessed 2026-10-01 — official docs.
    - "“The media clips inserted or upgraded in this version of PowerPoint will be saved as Pictures.”" · "Media clips that are embedded or upgraded in PowerPoint 2010 or newer versions are converted to an image that you cannot edit in earlier versions of PowerPoint." · "Re-insert the media clip and use Link to File instead of embedding."
  - [Compatibility Checker (PowerPoint for Mac)](https://support.microsoft.com/en-us/powerpoint/compatibility-checker-powerpoint-for-mac) — Microsoft Support, accessed 2026-10-01 — official docs.
    - "To represent your embedded media clip, it's converted to an image that you can't edit in earlier versions of PowerPoint. The media object is permanently converted to a picture. You cannot play or edit the audio or movie object after the presentation is saved in this file format."
  - [About compatibility mode in PowerPoint](https://support.microsoft.com/en-us/powerpoint/about-compatibility-mode-in-powerpoint) — Microsoft Support, accessed 2026-10-01 — official docs.
    - "By default, if you've saved a presentation as a modern .pptx, the option isn't offered under Save as or Save a copy . You may be able to save it as a .ppt file with Export ."
  - [Media type application/vnd.apple.keynote](https://www.iana.org/assignments/media-types/application/vnd.apple.keynote) — IANA registry, accessed 2026-10-01 — registry entry.
    - "This type is the native application format for the Keynote applications on iOS and MacOS." · "File extension(s): .key"
  - [Save a large Keynote presentation as a package file on Mac](https://support.apple.com/guide/keynote/save-a-large-presentation-as-a-package-file-tanaa443947b/mac) — Apple Keynote User Guide, accessed 2026-10-01 — official docs.
    - "By default, Keynote saves your presentation as a single file. If your presentation is over 500 MB or contains large video or image files, Keynote may perform better if you save the presentation as a package."
    - "You may need to revert because some web or email services don’t allow you to upload or attach a package file."
- **Limits / false positives:**
  - A .ppt save was not tested in this session; the statements are Microsoft's.
  - Whether the organisers mean .pptx by ".ppt" is unknown; their data never mentions .pptx.

## Dropped at verification

None. Every finding survived; F07 lost a grade.

## Deliverable

### A. Recording profile: the copies a judge actually sees

| Copy | Pixels | How it arises | Source |
|---|---|---|---|
| Master capture | 1920x1080 device px, 30 fps (60 only with the bitrate for it) | OBS (MKV or Hybrid MP4) or Screen Studio (macOS only), no rescale | F01, F03, F14, F24 |
| Stream copy | 1280x720, H.264 4:2:0, about CRF 23 | YouTube adaptive quality, Loom Starter, PowerPoint "HD (720p)" | F02, F03 |
| Slide-pane copy | about 960x540 on screen | video at about half size inside a slide in Normal view | derived, not sourced |
| Projector | 1920x1080 at 125% or 150% zoom = 1536x864 or 1280x720 CSS px | stage laptop | F18, F19 |

### B. Gates (build-time, deterministic unless marked)

| # | Gate | Threshold | Severity | Basis |
|---|---|---|---|---|
| G1 | Text a judge must read | x-height in the 720p copy ≥ 5.8 px (Inter ≥ 16 px) | FAIL | F04, F05 |
| G2 | Comfortable reading text | x-height in the 720p copy ≥ 6.5 px (Inter ≥ 18 px; XAG PC body height is Inter ≈ 19 px) | WARN | F04, F05 (XAG PC 18 px) |
| G3 | Key text (`data-rec-role="key"`: claim, proof values, state and provenance labels) | x-height in the 540p copy ≥ 6.5 px (Inter ≥ 24 px) | FAIL | F04, F05 (XAG console 26 px, tvOS 23 pt) |
| G4 | Thin weights (300 or lighter), red on dark | one step up (≥ 18 px); blue on dark is not supported by E1 for this step | WARN (review) | F08 (corrected: blue removed) |
| G5 | Rendered contrast, sampled from pixels against the worst background | WCAG 1.4.3: 4.5:1, or 3:1 for large text | FAIL | F08 |
| G6 | Projector contrast | ≥ 4.5:1 at a 15:1 system floor | WARN | F17 |
| G7 | Banding | CAMBI on the 720p H.264 copy ≤ 5 (rule of thumb calibrated at 4K, 1.5H); large gradients with all stops at L < 0.1 flagged | FAIL / WARN | F09 |
| G8 | Grain and noise overlays | none in record mode | WARN | F10 |
| G9 | Hairlines | 1 px borders < 1.5:1 that carry structure become 2 px or fills | WARN | F11 |
| G10 | Dark surfaces | surface steps ≥ 1.1:1, master `color_range=tv` checked with ffprobe | WARN (manual) | F12 |
| G11 | Hover-only content | no text revealed only on hover; no `title` tooltips on key elements | FAIL / WARN | F15 |
| G12 | Motion | no blinking under 333 ms per cycle (stricter than WCAG 2.3.1, equal to SC 2.3.2); loops frozen in record mode; proof states hold ≥ 0.33 s per word (≥ 1.2 s) | FAIL / WARN / manual | F16 |
| G13 | Provenance | every data region shows live, testnet or simulated plus an as-of time or block | WARN | F21 |
| G14 | Zoom | no horizontal overflow at 1536 and 1280 CSS px; key elements in the first viewport | FAIL / WARN | F19 |
| G15 | Device steps (Ledger) | `requiredUserInteraction` mirrored in the page | manual | F22 |
| G16 | Deck format (TOKEN2049) | .pptx or single-file .key with the MP4 embedded; never 97-2003 .ppt; played back from the Drive copy | manual | F25 (added at verification) |

### C. Record-mode contract the build must provide

- `?record=1` (or an equivalent environment flag), which:
  - serves a named fixture or snapshot with `data-provenance` and `data-as-of` on each data region, and a visible label;
  - fixes the displayed clock;
  - seeds randomness;
  - disables grain, loops, marquees, blinking badges and cursor-following effects, so that the checker's capture is deterministic (F20);
  - renders at rest everything that is otherwise hover-only.
- `data-rec-role="key"` on the claim, the proof values and the state labels. `data-rec-role="decor"` on text nobody needs to read.
- A layout verified at 1536x864 CSS px. The recording is made at 125% browser zoom on a 1920x1080 screen.
- For Ledger flows, a device-step panel driven by the DMK's `intermediateValue.requiredUserInteraction`.

### D. The checker: `_scripts/fd20/recording-check.mjs`

- **Usage:** `node recording-check.mjs --url <url|file> [--out dir] [--wait ms]`. Environment variables: `PLAYWRIGHT_CORE_PATH` and `CHROMIUM_PATH`, the same convention as FD19's capture gate, plus `FFMPEG_PATH`. Exit code 2 when any FAIL.
- **Outputs:** `capture-1080.png`, `capture-720.png` and `capture-540.png` (real H.264 copies when ffmpeg has libx264), `capture-zoom125.png`, `capture-zoom150.png`, `report.json`, `report.md`, and `blind-read-prompt.md` (the one-way comprehension check, F07).
- **What it measures:**
  - x-height through canvas metrics at 1000 px, per text run;
  - contrast sampled from the screenshot pixels, with a background ring and the worst background pixel;
  - the projector model;
  - `:hover` rules and their triggers, followed by a live hover probe;
  - `title` tooltips;
  - gradient stops and their luminance (translucent stops composited over the underlying background);
  - feTurbulence, noise and grain layers;
  - 1 px low-contrast borders;
  - `document.getAnimations()`, checking for loops and blinking;
  - provenance text and attributes;
  - CAMBI through `libvmaf`;
  - horizontal overflow at 125% and 150%.
- **Verified 2026-10-01:**
  - `fixtures/fixture-bad.html` → exit 2 with 8 FAIL, 8 WARN and 3 INFO in all nine recorded runs of the current or near-current version (researcher 3, verifier 6): text below 5.8 px, key text below the 540p tier, 3 or 4 contrast failures, a hover-only tooltip, a 200 ms blink, CAMBI between 12.356 and 12.613 (12.566 in all the researcher's runs), overflow of 260 and 516 CSS px. (corrected: the contrast count and CAMBI vary between runs)
  - `fixtures/fixture-clean.html` → exit 0 in four runs (CAMBI 0 in the researcher's run, 0.001 in the verifier's three).
  - Report tables are not identical across runs on the bad fixture (F20). The researcher's identical pair was made with an earlier checker version (8 FAIL, 7 WARN); the verifier's first two runs of the published file did not match. (corrected: the original said "Two consecutive runs printed identical report tables")
  - The bad fixture does not exercise the provenance WARN, the missing-key WARN or the key-below-fold WARN, so those paths are untested. (added at verification)
  - Reports are in `_scripts/fd20/results/`.
- **Known gaps:**
  - The hover probe covers the first 60 triggers in the first viewport.
  - Cross-origin CSS is not scanned.
  - Gradient parsing reads computed `rgb()` and `rgba()` only.
  - Provenance checking is a regular expression.
  - Without annotations, every non-decorative text run is held to G1.
  - `freezeAnimations` pauses and seeks infinite animations, and the screenshot follows immediately with no wait for a painted frame; the verifier's captures show the blinking badge at opacity 1 in one run and 0 in five, which changes the contrast count and CAMBI (F20). The fixtures also load Inter from Google Fonts at run time, a further possible source of drift. (added at verification)
  - The file header comment still claims "Deterministic: the same page, browser build and ffmpeg build give the same report", and its motion message labels a sub-333 ms blink a "WCAG 2.3.1 flash risk" although 2.3.1 exempts flashes below the area thresholds (F16). (added at verification)

### E. ffmpeg recipes (each run in this session)

```sh
# judge's 720p copy of a capture (use 960:540 for the slide-pane copy)
ffmpeg -loop 1 -framerate 30 -t 2 -i capture-1080.png \
  -vf "scale=1280:720:flags=bicubic:out_color_matrix=bt709:out_range=tv,format=yuv420p,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv" \
  -c:v libx264 -crf 23 judge-720.mp4
ffmpeg -i judge-720.mp4 -vf "select=eq(n\,30),scale=in_color_matrix=bt709:in_range=tv:out_range=pc,format=rgb24" -frames:v 1 -update 1 judge-720.png
# banding score (Netflix CAMBI, needs an ffmpeg built with libvmaf; run from the output folder)
ffmpeg -i judge-720.mp4 -i judge-720.mp4 -lavfi "[0:v][1:v]libvmaf=feature=name=cambi:log_path=cambi.json:log_fmt=json" -f null -
# deck master: H.264 High 4:2:0 + AAC 48 kHz, BT.709 tags, moov first (input: an MKV or Hybrid MP4 master, F24)
ffmpeg -i master.mkv -vf "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv" \
  -c:v libx264 -preset slow -crf 18 -c:a aac -b:a 192k -ar 48000 -movflags +faststart deck-video.mp4
ffprobe -v error -select_streams v -show_entries stream=codec_name,profile,pix_fmt,color_range,color_space,color_primaries,color_transfer -of compact deck-video.mp4
# reproduce the crushed-blacks fault (full range mistagged as limited) for teaching
ffmpeg -i full.mp4 -c copy -bsf:v h264_metadata=video_full_range_flag=0 -color_range tv mistagged.mp4
```

### F. Per event

- **TOKEN2049 Origins (6 to 7 Oct):**
  - Video of 3 minutes or less, as an H.264 MP4 embedded in the deck. The rules say ".ppt or .keynote only", but a 97-2003 .ppt turns the embedded video into a picture (F25): deliver .pptx or a single-file .key and get the organisers' confirmation. Never HEVC, never a link.
  - Judges also get a repo and a live URL, so the live page must match the video (F01).
  - It plays on a stage screen, so the G3 key tier and G6 projector contrast apply.
  - The Cardano "new to blockchain" criterion makes the blind-read questions 1 and 5 the acceptance test for the first frame.
- **Ledger OP3N (finals 16 Oct, live, projector):**
  - Gates G14 (125% zoom), G6 and G15.
  - Key text at 32 to 48 CSS px for the back rows (F18).
- **BNB (submit by 11 Oct):**
  - A dense live board watched at 1920x1080, possibly muted.
  - Gates G1 to G3 on the numbers, G13 on every figure (live or snapshot, with a block or time stamp), G12 (freeze tickers while recording), and on-screen state labels (F23).

## Contradictions between sources

1. **Model reads, OCR and human norms disagree about how small is legible.** Claude read 9 px text in a 540p copy (F07). Windows OCR needed 18 to 24 px (F04). XAG and Apple ask for 18 to 29 at native 1080p (F05). The gates follow the measured OCR break points, which fall inside the normative range. The model read is kept for comprehension only.
2. **Grain against banding.** Norkin's research page says grain synthesized by the AV1 film grain tool after decoding masks banding. Grain baked into the source did hide banding in the lossless source (CAMBI 1.89 against 7.70), but after encoding it was erased (animated) or too weak (static) to keep CAMBI under 5 (F10). The two statements concern different mechanisms. (corrected: Norkin's statement is about decoder-side synthesized grain, not "preserved grain")
3. **Playwright's docs against its code.** The docs describe only the size default. The released code fixes 1 Mbps at 25 fps, while main scales bitrate and adds custom fps (F13). FD06 cites the CLI's 25 fps default, which is consistent with this.
4. **16 or 18 px.** FD17-F22 (USWDS) sets 16 px for body text on screen. XAG PC asks for 18 px of body height at 1080p, which is Inter at about 19 px. The 720p measurements put 16 px at 75 to 85% exact reads and 18 px at 98 to 100%. Both hold for their medium; the recording gate uses 16 px to FAIL and 18 px to WARN.
5. **Narration.** ETHGlobal tells teams not to submit text-plus-music videos or synthetic voices and asks offenders to re-submit, and the Devpost template requires narration audio, while BNB viewing may be muted. One master can serve both only if the picture carries the facts (labels) and a human voice narrates. (corrected: "forbids" replaced by what the page says)
6. **PISCR values.** Search snippets from a Q&A site gave other PISCR numbers (35:1 and 10:1). I did not open or use them. The trade-press article lists 7, 15, 50 and 80.
7. **Checker determinism.** The researcher's runs agreed (two of them on an earlier checker version); the verifier's six runs of the published file did not (F20). (added at verification)

## What could not be found, and how it was searched

- **A DoraHacks platform-wide video rule.** The "How to submit a BUIDL" guide (read through Exa) has no video field rules. Hackathon rule pages are client-rendered (curl returned 2.5 KB). Rules are per hackathon.
- **The PISCR and DISCAS ratio values and formulas in the standards themselves.** At verification, the ANSI webstore previews of ANSI/INFOCOMM 3M-2011 and AVIXA V202.01:2016 were read through Exa (front matter, scope, exceptions); neither preview reaches the requirements section. AVIXA lists a successor, ANSI/AVIXA V201.01:2021 Image System Contrast Ratio, and a new DISCAS edition, ANSI/AVIXA V202.01:2026 (April 2026); neither text was opened. A third-party S3 copy of V202.01 was not opened, because it was unclear whether it was authorised. (corrected: the previews were found; the successors were not mentioned)
- **YouTube's delivered bitrates and scalers.** They are not in the help pages opened (upload settings, quality selection).
- **File-size limits for video embedded in PowerPoint or Keynote.** They are absent from the Microsoft and Apple pages opened; Apple only suggests a package above 500 MB (F25).
- **A human study of UI text legibility in modern (H.264, 1080p to 720p) screen recordings.** An Exa search surfaced Knoche and Sasse (2006, mobile TV), Meuel et al. (PCS 2012, x264 screen content, an adaptive-QP proposal) and a 2016 ACM TOMM screencast measurement, none with UI text thresholds. E1's OCR measurement fills the gap as a proxy.
- **Netflix's Timed Text Style Guide gives no pixel size** ("tts:fontSize shall be defined as 100%. Do not use pixel values.", [Timed Text Style Guide: General Requirements](https://partnerhelp.netflixstudios.com/hc/en-us/articles/215758617-Timed-Text-Style-Guide-General-Requirements), seen in an Exa search result at verification). FCC and Ofcom caption rules were not opened.
- **Official OBS documentation of colour range or colour format.** Only forum posts and a practitioner guide (Xaymar) were found; they were not used as evidence.
- **Screen Studio's "Focused" animation setting.** It appears only on a `preview.` subdomain surfaced by Exa. The canonical guide pages returned the vendor's LLM summary, so it was not used.
- **The default Windows pointer size in pixels, and a page stating that a 1080p tvOS screen is @1x.** Apple's HIG gives tvOS @1x and @2x and defines @1x as one pixel per point (F05), but no page opened ties the 1080p Apple TV to @1x.

## Weak spots of this dossier

- **F04 and F08 rest on OCR.** A French-language engine read English strings, with crops upscaled to 3x. The data measure information loss, not human reading at a physical distance. Other limits: one font (Inter), Chromium on Windows with LCD antialiasing, still frames (scrolling was not measured), bicubic scaling, x264 only, CRF rather than capped bitrate, six strings per cell.
- **F07 is two frames and 22 strings,** read by the model that wrote the vocabulary.
- **F09 and F10 use synthetic pages,** one grain recipe and x264. The 0.1 luminance cut-off is calibrated on eight pages, and CAMBI's threshold of 5 is applied to 720p frames outside its 4K calibration.
- **F11's measurement step was not saved** with the script; the verifier reproduced it from images that live only in the researcher's scratch folder.
- **F17's projector model is a simple additive floor,** and its PISCR numbers come from trade press. F18's table assumes that the image shows exactly 1080 device px, and uses Inter's x-height.
- **The checker's report is not deterministic** on an animated page (F20), and its fixtures depend on Google Fonts at run time.
- **Wording checks.** Several quotes were checked by curl text extraction, and some were read through Exa (Netflix blog, PISCR article, ANSI previews, AVIXA pages), where formatting may differ from the page.
- **The TOKEN2049 rules come from an organiser API** that the owner's own notes say is still being edited.
- **The checker's thresholds encode F04.** If the owner's recording tool differs (for example Screen Studio's upscaler, or 4K capture), recalibrate with `_scripts/fd20/experiments/e1-*`.

## Verification notes

- **Method.** Every cited URL was re-opened on 2026-10-01 with curl (text extracted locally) or, where curl was blocked, through Exa's fetch; GitHub files were read from raw.githubusercontent.com and commit and release dates through `gh api`. Quotes were matched against the extracted text; numbers were recomputed. In-session data were checked against the stored files: the E1 pooled table, CER values, per-variant thresholds, blind-read lines and crop count were recomputed from `e1-ocr-score.json` and `e1-manifest.json`; E2 and E3 values were re-read from their JSON; E4 contrasts were re-measured from the stored images with an independent method; E5 luma statistics and E6 surface values were re-measured from the stored video and frames; the F17 table and F18 distances were recomputed; Inter's metrics were re-measured with canvas at 1000 px; the deck-export and mistag recipes were re-run with ffmpeg 9.0.2; the checker was run six times on the bad fixture and three times on the clean one.
- **Sources that needed a workaround.** w3.org returned a 403 challenge to a browser user agent and served the page to a plain one. netflixtechblog.com and commercialintegrator.com returned 403 and were read through Exa. The ANSI webstore previews, the AVIXA standards and calculator pages and the AVIXA store listing were read through Exa; the Knoche and Sasse venue (Proceedings of SPIE, 2006) and the Netflix Timed Text quote come from Exa search results, not from fetched pages. The YouTube "Auto (recommended)" line appears in the Android variant of the help page and not in the default computer variant (the iOS variant was not retrieved). The Microsoft Store price depends on the market (USD with `gl=US`, EUR from France).
- **Not opened.** The PISCR, ISCR and DISCAS standard texts beyond their previews; the ISCR V201.01:2021 minima; the DISCAS 2026 edition.
- **Residual doubts.**
  - The checker's run-to-run drift is traced to the blinking badge (pixel diff and a visual check of two captures); why the researcher's runs always produced 12.566, a value none of the verifier's runs reached, is not established.
  - The Knoche and Sasse 5 px figure is read as a letter height because the paper illustrates it with a capital E; the paper does not say cap height or x-height explicitly.
  - Whether TOKEN2049 accepts .pptx is unknown until the organisers answer.
  - The "mean |R−B| 50.9" figure in F08 could not be reproduced; only the presence of LCD fringing was confirmed.
  - Grades A and B for mixed-source findings (F14, F16) follow the strongest primary source in each; their vendor or practitioner parts (Screen Studio, NN/g) are weaker.
