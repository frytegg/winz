# First impressions, prototypicality, and how a jury understands a product fast
> Code FD11 · slug evidence-first-impressions-jury · researched 2026-09-30 · verified 2026-09-30 · counts: verified 18 / corrected 12 / downgraded 0 / dropped 0 / added 2

## Summary

- People rate a homepage's visual appeal reliably after 50 ms. Lindgaard 2006 found mean ratings at 50 ms and 500 ms correlated at r = .947. But the pages were chosen as the best and worst of 100, and individual viewers were much less consistent at 50 ms: 40% of their test-retest correlations fell below .60. The first glance separated the best pages from the worst. Because the middle pages were dropped, the study says nothing about ranking good pages against each other. (corrected at verification: the earlier wording "it does not rank good pages" claimed a result the study never tested)
- Visual complexity and prototypicality (looking like a typical member of the category) both register at 17 ms. Complexity has the larger effect there, and prototypicality's effect matches it by 33-50 ms. (corrected at verification: prototypicality does not wait until 33 ms; Tuch 2012 finds it significant at 17 ms, only weaker) Pages low in complexity and high in prototypicality were rated most beautiful (Tuch 2012, company sites, PT ηp² = .81). In Reinecke 2013, complexity outweighed colourfulness, and a 500 ms appeal model with demographics explained 48% of the variance.
- Prototypicality also predicts trust. Miniukovich and Figl 2023 (1,530 participants) found its direct effect on trust larger than its indirect effects through beauty or usability; together with those two it explains 29-68% of trust variance, depending on the category. In an experiment on bank homepages (Figl 2025, N = 107), typical pages improved attitudes, and when viewers were distracted, a typical design narrowed the gap between weak and strong messages; strong messages still scored higher. Hekkert's MAYA work (2003) finds typicality and novelty predict preference only jointly: novelty is preferred while it does not cost typicality, and typicality while it does not cost novelty. (corrected at verification: "typical design outweighed the message" overstated Figl 2025, and the MAYA sentence gave only half of Hekkert's symmetric result) This supports borrowing a category's conventions, not one site's brand. No study covers crypto sites or hackathon juries.
- Attention concentrates at the top: 57% of viewing time above the fold, 74% in the first two screenfuls and 81% in the first three (NN/g 2018, desktop). Liu 2010 found 98.5% of 205,873 pages show "negative aging": the chance of leaving is highest in the first seconds and falls the longer a visitor stays. (corrected at verification: negative aging is a falling leave rate, not a finding that most visitors leave quickly) In Fogg 2003, "design look" appeared in 46.1% of 2,440 credibility comments.
- Juries: MLH plans 4 minutes per project per judge, 2 of them for the demo. ETHGlobal gives finalists 7 minutes and screens async events down to the top 20%. Devpost budgets about 5 hours for 30 projects. DoraHacks runs an AI judge that reads the project page and the GitHub repo, and can let human judges skip projects it did not recommend. In ETHGlobal's 2026 rules, projects built entirely by AI risk exclusion.
- I captured ten real protocol and fintech first viewports today. Headlines run 2-6 words. Six of ten carry a sentence saying what the product does, four show live figures, and one (Uniswap) is the product itself. None explains a mechanism above the fold. Several of the owner's 20 tells appear on these sites: Ethena's gradient H1 and blurred-glass nav, Chainlink's Inter body text, purple-family backgrounds on Aave, Lido and Stripe, and labels above the H1 on Aave and Stripe. A checker that bans those tells outright will fire on its own control sites.
- The owner's Orma pair (naive reading muted and dashed, correct reading accent and solid, with the gap as the largest number) uses all three of Gleicher's comparison building blocks, spread across three separate elements, and adds the non-colour cue that WCAG 1.4.1 asks for. (corrected at verification: "meets WCAG 1.4.1" claimed a conformance result nobody audited, and Gleicher et al. report never meeting a single design that combines all three blocks) It stayed intact because an audit checked it after an animation had erased the dashes once.

## Findings

### FD11-F01 — Visual appeal is judged reliably within 50 ms, shown only on clearly good and clearly bad pages
- **Grade:** A · **Kind:** MEASURED · **Verdict:** CORRECTED
- **Claim:** Lindgaard, Fernandes, Dudek and Brown (2006) ran three studies. Study 1: 22 participants rated 100 homepages shown for 500 ms, twice. Study 2: 31 participants rated the 25 highest- and 25 lowest-rated pages. Study 3: 40 participants, 20 at 50 ms and 20 at 500 ms. Mean appeal ratings at 50 ms and 500 ms correlated at r = .947 in phase 1. The stimulus pool was deliberately extreme ("best and worst examples"), and the middle pages were dropped from Studies 2 and 3. Individual consistency was lower at 50 ms: 40% of participants' phase-to-phase correlations fell below r = .60, against none at 500 ms. The average inter-rater correlation was r = .337 at 50 ms against .557 at 500 ms (phase 1).
- **Implication for /frontend:** The first viewport is classed as good or bad before any copy is read. What matters is staying out of the bad group, which is where the slop tells sit. The study gives no support for chasing marginal polish, and none for claims about understanding content in 50 ms, which it did not test.
- **Evidence:**
  - [Attention web designers: You have 50 milliseconds to make a good first impression!](https://www.makinggood.ac.nz/media/1265/lindegaardetal_2006_attention.pdf) — Lindgaard, Fernandes, Dudek, Brown; Behaviour & Information Technology 25(2):115-126, March 2006 (DOI 10.1080/01449290500330448), accessed 2026-09-30 — peer-reviewed article (full-text copy hosted by makinggood.ac.nz).
    - "Thus, visual appeal can be assessed within 50 ms, suggesting that web designers have about 50 ms to make a good first impression."
    - "In the first study, 100 homepages, collected purely as best and worst examples of visually appealing web pages by members of the Human Oriented Technology Lab (HOT Lab)"
    - "It revealed that r = .947, p < .001 (r2 = .897)." (the PDF text layer renders = and < as broken glyphs)
    - "in the 50-ms condition 40% of the correlations were below r = .60 whereas none was below r = .60 in the 500-ms condition"
    - "In the 50-ms condition, the average correlation was r = .337 on the first phase and r = .403 on the second."
- **Limits / false positives:** The study used pre-2006 homepages screenshotted in Internet Explorer 6 at 1024×768, university students (Studies 1 and 2) and passive screenshot viewing, and measured appeal only (no trust, no comprehension). The authors say they "were not interested in determining the reliability of judgements of homepages falling between the very appealing and very unappealing homepages", so the study is silent on mid-quality pages. Study 1 contains an internal inconsistency: the text says "The squared Pearson Product Moment correlation coefficient (r) was .97" while the Figure 2 caption gives r² = .94. The value r = .97 is the one consistent with r² = .94, and the same paragraph says 94% of the variance was shared. (corrected: the title said the 50 ms judgment works "only between" extreme pages, but the study tested only extremes and says nothing either way about middle pages; "2006 homepages" was wrong, the screenshots predate the 2006 publication)

### FD11-F02 — Visual complexity and prototypicality both register at 17 ms, complexity more strongly; prototypicality matches it by 33 ms; low complexity with high prototypicality was rated most beautiful
- **Grade:** A · **Kind:** MEASURED · **Verdict:** CORRECTED
- **Claim:** Tuch, Presslaber, Stöcklin, Opwis and Bargas-Avila (2012) started from a pool of 464 company homepages. After exclusions, 270 were rated online by 267 people for visual complexity (VC) and for prototypicality (PT), using the item "This website looks like a typical company website"; inter-rater agreement was ICC .82 for VC and .78 for PT. They then chose 120 homepages that crossed the two factors. Study 1 (n = 59, masked exposures of 50, 500 or 1000 ms) found main effects of VC (ηp² = .58) and PT (ηp² = .81) on beauty, plus a VC×PT interaction. Study 2 (n = 82, 17, 33 or 50 ms) found both effects already at 17 ms, with VC stronger there (ηp² .38 against .19) and the two roughly equal at 33 ms (.65/.66) and 50 ms (.57/.66). Pages low in VC and high in PT were rated most beautiful. Low-PT pages were rated unattractive at every level of complexity. One of the 120 pages lost its data to a logging error, so Study 1 analysed 119. (corrected: the title said prototypicality registers only "by 33-50 ms"; the paper finds significant effects of both factors at 17 ms, prototypicality's smaller there, ηp² .19 against .38)
- **Implication for /frontend:** Two levers act before anything is read. Reduce first-viewport complexity, which has the larger effect at the shortest exposure. And look like a typical member of the category the jury will file the product under. This is the empirical basis for borrowing the conventions of the sponsor's customers: the target is looking typical of a category, not copying one site.
- **Evidence:**
  - [The role of visual complexity and prototypicality regarding first impression of websites: Working towards understanding aesthetic judgments](https://research.google.com/pubs/archive/38315.pdf) — Tuch, Presslaber, Stöcklin, Opwis, Bargas-Avila; preprint (dated 17 August 2012) of Int. J. Human-Computer Studies 70(11):794-811 (DOI 10.1016/j.ijhcs.2012.06.003), accessed 2026-09-30 — peer-reviewed article, author preprint.
    - "Results suggest that VC and PT affect aesthetic perception even within 17ms, though the effect of PT is less pronounced than the one of VC. With increasing presentation time the effect of PT becomes as influential as the VC effect."
    - "Overall, websites with low VC and high PT were perceived as highly appealing."
    - "prototypically (PT; "This website looks like a typical company website")"
    - "Websites of low prototypicality are generaly judged as being unattractive" ... "in fact, this counts for websites of high as well as low complexity."
    - "Designs that contradict what users typically expect of a website may trigger a suboptimal first impression and impair users' expectations."
- **Limits / false positives:** The study covers company websites only; the authors list "Website types" as a limitation. Participants had no design training: mainly psychology undergraduates at the University of Basel in Study 1, and 82 regular web users aged 16-63, paid in course credit or cash, in Study 2. The brands were unfamiliar, and the outcome was beauty, not trust or comprehension. Prototypicality is relative to a category, and the study does not say which category a hackathon jury uses.

### FD11-F03 — Complexity outweighs colourfulness, and even award-nominated sites split first impressions
- **Grade:** A · **Kind:** MEASURED · **Verdict:** VERIFIED
- **Claim:** Reinecke et al. (CHI 2013) collected ratings of 450 websites from 548 volunteers on LabintheWild, with 500 ms exposures repeated to check consistency. Image-metric models predicted perceived complexity (r = .80, R² = .65). A mixed model that added demographics explained 48% of appeal variance (adj. R² = .48). High complexity produced the largest drop in appeal, while low and medium complexity were liked about equally. Colourfulness played "only a minor role". The 20 Webby Award nominees averaged between 4.21 and 6.57 on a 9-point scale, against an overall mean of 4.73 for the other sites.
- **Implication for /frontend:** Spend effort on removing elements from the first viewport, not on colour choices. Do not treat "award-style" design as universally liked.
- **Evidence:**
  - [Predicting users' first impressions of website aesthetics with a quantification of perceived visual complexity and colorfulness](https://eecs.harvard.edu/~kgajos/papers/2013/reinecke13aesthetics.pdf) — Reinecke, Yeh, Miratrix, Mardiko, Zhao, Liu, Gajos; CHI 2013, pp. 2049-2058 (DOI 10.1145/2470654.2481281), accessed 2026-09-30 — peer-reviewed paper (authors' copy).
    - "The model accounts for 48% of the variation in aesthetic preferences (adj. R2 = .48, see also Figure 4)."
    - "our analyses show that a high visual complexity results in the largest decrease in appeal, but websites with low levels of complexity are similarly liked to those with a medium complexity."
    - "An interesting finding of our work is that the perceived colorfulness only plays a minor role in people's first impression of appeal."
    - "Yet the 20 Webby Award websites in our study received average ratings between 4.21 and 6.57 (across all participants on a 9-point scale, and as compared to the overall mean of 4.73 for all the other sites)."
- **Limits / false positives:** The sample was self-selected and more educated and multinational than typical web users (the authors' own limitation). The authors also state the work "was not intended to predict judgements that have been found to be influenced by appeal, such as the perceived trustworthiness and usability". Reinecke finds low and medium complexity liked about equally; Tuch finds a linear decline (see Contradictions).

### FD11-F04 — Preferred colourfulness and complexity depend on the audience; more education means less of both
- **Grade:** A · **Kind:** MEASURED · **Verdict:** VERIFIED
- **Claim:** Reinecke and Gajos (CHI 2014) collected 2.4 million ratings from nearly 40,000 participants at 500 ms exposure. The levels of colourfulness and complexity that people like most vary with age, gender, country and education, and education correlates negatively with a preference for colourful, complex sites.
- **Implication for /frontend:** Tune the design to the jury, not to a universal taste. If the jurors are sponsor engineers, founders and investors (an assumption to confirm per event), the evidence points toward restrained colour and low complexity. International juries such as TOKEN2049 Singapore span many countries, so avoid bets on any one country's colour preferences.
- **Evidence:**
  - [Quantifying Visual Preferences Around the World](https://eecs.harvard.edu/~kgajos/papers/2014/reinecke14visual.pdf) — Reinecke, Gajos; CHI 2014 (DOI 10.1145/2556288.2557052), accessed 2026-09-30 — peer-reviewed paper (authors' copy).
    - "we collected 2.4 million ratings of the visual appeal of websites from nearly 40 thousand participants of diverse backgrounds"
    - "Education level negatively correlates with preferences for colorful and complex sites."
    - "it has been argued that universal design guidelines are useful only to a certain extent, because aesthetic impressions vary substantially across individuals"
    - (added at verification) "it underlines that appeal is largely subjective even after a short exposure time of 500ms. The finding challenges previous assumptions that individual variability in aesthetic taste is small during the initial visceral reaction toward a design"
- **Limits / false positives:** Online volunteers and first-impression appeal only. There are no data on judges or crypto audiences, and the jury's education level is an assumption.

### FD11-F05 — First-viewport complexity can be measured from a screenshot; ten exemplars span 47-133 KiB, and texture inflates the proxy
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:** Aalto Interface Metrics (AIM; MIT licence; last push 2023-06-11) implements screenshot metrics. They include JPEG file size at quality 70 (filed under "Visual complexity > Information amount > Visual clutter"), feature congestion, subband entropy, Hasler-Süsstrunk colourfulness, grid quality and white space. I applied the JPEG q70 proxy to the 1440×900 first viewports captured for F17. The results run from 47 KiB (app.uniswap.org) to 133 KiB (Morpho). Morpho looks clean yet scores highest because of its fine grid and line texture, and Ondo's photograph gives 107 KiB.
- **Implication for /frontend:** /frontend can gate first-viewport complexity mechanically against the range of the category's own exemplars: a Playwright screenshot plus a few lines of Python with PIL, or AIM's metric modules. It must calibrate on those exemplars and must not treat the number as a quality score, because texture and photographs raise it without adding clutter.
- **Evidence:**
  - [aalto-ui/aim](https://github.com/aalto-ui/aim) — Aalto University, MIT, accessed 2026-09-30 — source code. Command: `gh api repos/aalto-ui/aim --jq '{full_name, description, license: .license.spdx_id, pushed_at, stargazers_count, archived}'` returned `"license":"MIT","pushed_at":"2023-06-11T10:48:44Z","archived":false`. Metric modules listed include `m2_jpeg_file_size.py`, `m7_subband_entropy.py`, `m8_feature_congestion.py`, `m15_colorfulness_hassler_susstrunk.py`, `m21_grid_quality.py` and `m22_white_space.py`.
  - [m2_jpeg_file_size.py](https://raw.githubusercontent.com/aalto-ui/aim/HEAD/backend/aim/metrics/m2/m2_jpeg_file_size.py) — AIM, accessed 2026-09-30 — source code docstring.
    - "The file size (in bytes) of an image, saved in the JPEG format (image quality 70)."
    - "Category: Visual complexity > Information amount > Visual clutter."
  - Own measurement (PIL, JPEG q70, 1440×900 PNGs from F17): uniswap 47 and 54 (the same page, captured twice 10 s apart), hyperliquid 62, ethena 64, lido 67, eigencloud 70, chainlink 77, aave 78, stripe 99, ondo 107, morpho 133 KiB. The captures are in `research/assets/evidence-first-impressions-jury/`.
- **Limits / false positives:** One capture per site. The proxy's validation rests on the references in the AIM docstring (Miniukovich and De Angeli 2014-2015), which I did not re-check. No threshold for "too complex" is established here. (verification note: re-measured on the same PNGs with PIL 10.4.0 at JPEG q70; every figure matches after rounding, hyperliquid being 62.5 KiB. The first `uniswap.png` capture lacks the blurred floating token icons that the second, `uniswap-app.png`, shows, which explains most of the 47 against 54 KiB gap.)

### FD11-F06 — Prototypicality predicts trustworthiness more directly than beauty or usability do (correlational, three site categories)
- **Grade:** A · **Kind:** MEASURED · **Verdict:** VERIFIED
- **Claim:** Miniukovich and Figl (IJHCS 2023) ran a study with 1,530 participants on homepages of banks, online shops and universities. The screenshots come from a dataset of 3,156 homepages rated by MTurk workers in 3,319 sessions. Prototypicality correlated strongly with visual aesthetics, perceived pre-use usability and trustworthiness, and its direct effect on trust outweighed its indirect effects through the other two. Together the three explained between 29% and 68% of trust variance, depending on the category.
- **Implication for /frontend:** Looking typical of the category is also a trust signal, which matters for anything that handles money. Choose the prototype to borrow from the category of the sponsor's customers (bank, broker, exchange, DeFi protocol), because that is the frame in which the jury judges trust.
- **Evidence:**
  - [The Effect of Prototypicality on Webpage Aesthetics, Usability, and Trustworthiness (SSRN abstract page)](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4451026) — Miniukovich, Figl; posted 17 May 2023; published IJHCS 179:103103, Nov 2023 (DOI 10.1016/j.ijhcs.2023.103103), accessed 2026-09-30 — abstract of a peer-reviewed article.
    - "This paper addresses this gap by conducting a user study with 1530 participants to investigate webpage prototypicality. The study revealed a strong correlation between prototypicality and webpage visual aesthetics, perceived pre-use usability, and trustworthiness. Notably, the direct effect of prototypicality on trustworthiness outweighed the indirect effects through aesthetics and usability. Overall, prototypicality, aesthetics, and usability collectively accounted for 29% and 68% of the variance in trustworthiness, depending on the webpage category."
  - [Dataset of user evaluations of prototypicality, aesthetics, usability and trustworthiness of homepages of banking, e-commerce and university websites](https://pmc.ncbi.nlm.nih.gov/articles/PMC10823051/) — Miniukovich, Figl; Data in Brief, 2023-12-18, accessed 2026-09-30 — dataset paper.
    - "The dataset contains full-page screenshots of homepages of commercial banking (N = 1033), online shopping (N = 1064), and university (N = 1059) websites"
    - "Design prototypicality was measured with three items, including typicality, exemplar goodness, and family resemblance"
- **Limits / false positives:** The study is correlational; the 2025 follow-up says so explicitly (F07). I could not open the full text (ScienceDirect returned a captcha), so the per-category coefficients are unverified. The categories are banking, shopping and universities, not crypto. (verification note: the dataset paper says the ratings were given on full-width, full-page screenshots that "scrolled down automatically", pausing three seconds on the top part, so this is not a 50 ms first-impression paradigm. Unpaywall lists the published article as open access under CC BY at the publisher, but ScienceDirect and the Elsevier text API could not be opened from here either.)

### FD11-F07 — In an experiment, typical bank homepages improved attitudes, and under distraction they narrowed the gap between weak and strong messages
- **Grade:** A · **Kind:** MEASURED · **Verdict:** CORRECTED
- **Claim:** Figl, Miniukovich, Ernst and Lehrer (Electronic Markets 2025) ran an online mixed-design experiment with N = 107 participants from Prolific, in the UK and US. They showed 16 bank homepages, 8 high and 8 low in prototypicality, chosen from 1,032 pages rated by 1,298 MTurk workers. Each page was paired with a strong or weak text message, and half the participants worked under a working-memory distractor. High prototypicality improved attitudes in both conditions (general attitude b = 0.73 without the distractor, b = 0.66 with it). Message strength was also significant in both conditions. Under distraction, the prototypicality × message-strength interaction was significant for general attitude (b = −0.38, p = 0.024) and marginal for employer attractiveness (b = −0.437, p = 0.057): with a typical design, weak and strong messages scored closer together, and with an atypical design, message strength mattered more. In the authors' results section, prototypicality "could buffer the effects of weak messages, but strong messages were still more effective"; their discussion describes the same result as typical design taking "precedence over the message". The authors add that AI site builders replicate common patterns and so produce highly prototypical pages. (corrected: "under distraction typical design outweighed the message" overstated the result; the measured effect is a buffering interaction, significant for one of two outcomes, and strong messages still won)
- **Implication for /frontend:** A judge scoring the 30th project is a distracted viewer. A typical-looking page cushions a weak explanation, while an atypical one makes the jury weigh the words more. A strong explanation still scores higher either way, so typicality is no substitute for it. The skill must not confuse "prototypical" with "generated": what AI builders produce is typical of AI-built sites, not of the sponsor's customers' category (see Contradictions).
- **Evidence:**
  - [The danger of not being typical: The positive effect of webpage prototypicality on users' attitudes](https://pmc.ncbi.nlm.nih.gov/articles/PMC12078413/) — Figl, Miniukovich, Ernst, Lehrer; Electronic Markets, 2025-05-14 (DOI 10.1007/s12525-025-00777-9), accessed 2026-09-30 — peer-reviewed article (open access).
    - "Interestingly, when users' cognitive elaboration was low, the impact of prototypical design took precedence over the message."
    - "In contrast, when the website had an atypical design, users paid closer attention to the message, making the strength of the message much more important."
    - "When users engaged in high elaboration, there was a main positive effect of webpage prototypicality (employer attractiveness: b = 0.52, p = 0.015; general attitude: b = 0.73, p = 0.002)"
    - (added at verification) "Interestingly, in the low elaboration condition with the working memory task, there was an (almost) significant interaction effect between prototypicality and message strength (employer attractiveness: b = − 0.437, p = 0.057; general attitude: b = − 0.38, p = 0.024)."
    - (added at verification) "That is, under low elaboration, prototypicality could buffer the effects of weak messages, but strong messages were still more effective."
    - "these AI solutions replicate widely observed design patterns, thus producing highly prototypical pages."
    - "Our findings from an online experiment (N = 107) underscore the positive impact of both high prototypicality and strong messages on users' attitudes toward organizations."
- **Limits / false positives:** The study covers banking only (the authors flag the sector's risk profile), with general-population raters, static screenshots and familiar brands excluded. The predicted moderation by elaboration level (H3, H4) was not supported. H5 (low prototypicality raises the weight of message strength) was only partially supported, under distraction, and H6 was supported. The low-elaboration group had 51 participants and the high-elaboration group 56.

### FD11-F08 — Typicality and novelty predict preference only jointly: each helps while it does not cost the other (MAYA)
- **Grade:** A · **Kind:** MEASURED · **Verdict:** CORRECTED
- **Claim:** Hekkert, Snelders and van Wieringen (2003) ran three studies on consumer products. Typicality (operationalised as "goodness of example") and novelty predicted aesthetic preference jointly and equally and suppressed each other's effects. Neither correlated with preference directly; each relationship became highly significant only once the other variable was partialled out. People preferred novelty that did not cost typicality, and typicality that did not cost novelty. Observer expertise did not change their relative contribution. (corrected: the title gave only the novelty half of a symmetric result and omitted that neither variable predicts preference on its own)
- **Implication for /frontend:** This resolves the tension between prototypicality and the Originality and WOW criteria juries use (F21): be typical in form (layout, conventions, component grammar) and novel in substance (the mechanism, the proof, the signature visual). Pure typicality is not the target either; the study found no direct link between typicality alone and preference.
- **Evidence:**
  - [PubMed abstract 12648393 (E-utilities)](https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=12648393&rettype=abstract&retmode=text) — Hekkert, Snelders, van Wieringen; British Journal of Psychology 94(Pt 1):111-124, Feb 2003 (DOI 10.1348/000712603762842147), accessed 2026-09-30 — peer-reviewed abstract.
    - "In sum, all three studies showed that people prefer novel designs as long as the novelty does not affect typicality, or, phrased differently, they prefer typicality given that this is not to the detriment of novelty. Preferred are products with an optimal combination of both aspects."
    - "In Study 2, it was furthermore demonstrated that the expertise level of observers did not affect the relative contribution of novelty and typicality."
    - (added at verification) "Direct correlations between both variables and aesthetic preference were not significant, but each relationship became highly significant when the influence of the other variable was partialed out."
- **Limits / false positives:** The studies used industrial products, not web pages. I opened only the abstract; the full text is paywalled. An academia.edu page for the paper carries a generated summary with extra numbers, which I did not verify and did not use.

### FD11-F09 — "Design look" is the credibility cue people mention most (46.1% of comments)
- **Grade:** A · **Kind:** MEASURED · **Verdict:** VERIFIED
- **Claim:** In Fogg et al. (DUX 2003), 2,684 people compared pairs of live sites in 10 categories, including finance (E*Trade among the examples), and wrote 2,440 comments. "Design look" appeared in 46.1% of the comments, information structure in 28.5%, information focus in 25.1%, name recognition and reputation in 14.1%, tone of writing (including "marketing language") in 9.0% and functionality in 8.6%.
- **Implication for /frontend:** A jury reads the look as a credibility signal about the team and its claims. Unfamiliar names lost credibility in those comments, and a hackathon project is always unfamiliar, so the design and the proof must carry what a known brand would otherwise carry.
- **Evidence:**
  - [How Do Users Evaluate the Credibility of Web Sites? A Study with Over 2,500 Participants](https://studylib.net/doc/8904150/how-do-users-evaluate-the-credibility-of-web-sites%3F-a-stu...) — Fogg, Soohoo, Danielson, Marable, Stanford, Tauber; DUX 2003 (DOI 10.1145/997078.997097), accessed 2026-09-30 — peer-reviewed paper (full-text copy on studylib; the ACM DL PDF was not reachable).
    - "We found that the "design look" of the site was mentioned most frequently, being present in 46.1% of the comments."
    - "Users frequently commented on unfamiliar sites, typically harming the credibility of the site."
    - "Looks childish and like it was put together in 5 minutes. —F, 25, Maryland"
- **Limits / false positives:** The data are from 2002. Comment frequencies measure what people said they used, not causal weight, and the participants were the general public, not judges. (verification note: the authors add two caveats of their own. "Design look" "may be the broadest category" of their coding scheme, and participants recruited for a charity donation probably had little motivation, so under the Elaboration Likelihood Model they leaned on peripheral cues such as appearance. The second caveat arguably fits a tired judge too.)

### FD11-F10 — Attention: 57% above the fold, 74% in two screenfuls, 81% in three; the top half of the first screen gets 65%
- **Grade:** B · **Kind:** MEASURED · **Verdict:** VERIFIED
- **Claim:** NN/g (Fessenden 2018) analysed over 130,000 fixations from 120 participants on 1920×1080 screens, across tasks on news, e-commerce, blog, FAQ and encyclopedia pages. About 57% of page-viewing time fell above the fold, against 80% in their 2010 study. 74% fell in the first two screenfuls (up to 2160 px) and 81% in the first three. More than 65% of above-the-fold time went to the top half of the viewport, and more than 42% of all viewing time to the top 20% of a page.
- **Implication for /frontend:** The first viewport must carry the identity sentence and one proof. The full feature map can live in screenfuls 2 and 3. Anything below the third screenful is unlikely to be seen by a judge who is scanning.
- **Evidence:**
  - [Scrolling and Attention](https://www.nngroup.com/articles/scrolling-and-attention/) — Therese Fessenden, NN/g, 2018-04-15, accessed 2026-09-30 — vendor eyetracking data.
    - "In our most recent study, users spent about 57% of their page-viewing time above the fold. 74% of the viewing time was spent in the first two screenfuls, up to 2160px."
    - "8 years ago, 80% of the viewing time was spent in the first screenful of info (above the fold); today, 81% of the viewing time is spent in the first three screenfuls of information."
    - "More than 65% of the viewing time above the fold was concentrated in the top half of the viewport."
    - "Reserve the top of the page for high-priority content: key business and user goals. The lower parts of the page can accommodate secondary or related information. Keep major CTAs above the fold."
- **Limits / false positives:** Desktop only, goal-directed tasks on content sites; judges evaluating a project are not searching for something. The analysis pools pages of different lengths, which the article notes ("the result can be due to short page lengths").

### FD11-F11 — Unformatted text gets scanned in an F shape; descriptive headings produce the "layer-cake" pattern, the most effective way to scan
- **Grade:** B · **Kind:** MEASURED · **Verdict:** VERIFIED
- **Claim:** NN/g's eyetracking (the F-pattern was first identified in 2006 and revisited in 2017) shows F-shaped scanning when three conditions hold: unformatted text, a user trying to be efficient, and low commitment. The other patterns named are layer-cake, spotted, marking, bypassing and commitment. The layer-cake pattern, which concentrates fixations on headings and subheadings, is called "by far the most effective way to scan pages".
- **Implication for /frontend:** Each feature section needs a heading that names the feature and its result in words a judge can take in without reading the body. A judge who reads only the headings should come away with the feature list.
- **Evidence:**
  - [F-Shaped Pattern of Reading on the Web: Misunderstood, But Still Relevant (Even on Mobile)](https://www.nngroup.com/articles/f-shaped-pattern-reading-web-content/) — Kara Pernice, NN/g, 2017-11-12 (last reviewed 2026-08-19), accessed 2026-09-30 — vendor eyetracking data.
    - "People scan in an F-shape when all of these 3 elements are present: A page or a section of a page includes text that has little or no formatting for the web." ... "The user is trying to be most efficient on that page. The user is not so committed or interested that he is willing to read every word."
    - "Make no mistake, the F-shaped scanning pattern is bad for users and businesses: it means that users may skip important content simply because it appears on the right side of the page."
  - [The Layer-Cake Pattern of Scanning Content on the Web](https://www.nngroup.com/articles/layer-cake-pattern-scanning/) — Kara Pernice, NN/g, 2019-08-04, accessed 2026-09-30 — vendor eyetracking data.
    - "Aside from reading every (or almost every) word, the layer-cake pattern is by far the most effective way to scan pages: most of the time, it ensures that users will find the information they are looking for (if it is present on the page)."
- **Limits / false positives:** The heatmaps come from reading tasks, such as 47 people on one site. "Most effective" is NN/g's judgement from observation, not a controlled comparison reported in the article.

### FD11-F12 — Visitors screen pages hard in the first seconds: 98.5% of 205,873 pages show "negative aging"; the "10 seconds" rule is NN/g's reading of that curve
- **Grade:** A · **Kind:** MEASURED · **Verdict:** VERIFIED
- **Claim:** Liu, White and Dumais (SIGIR 2010) fitted Weibull distributions to dwell times on 205,873 pages that each had at least 10,000 visits. The shape parameter k was below 1 on 98.5% of pages, meaning the rate of leaving falls over time; the authors call the behaviour "screen-and-glean". The dwell-time scale was 70 s or less on 80% of pages, and less entertaining categories (Computers, Education) were screened more harshly. Nielsen (2011) reads the curve as follows: the first 10 s decide, the next 20 s are still risky, and the curve flattens after about 30 s. From that he concludes the value proposition must be clear within 10 seconds.
- **Implication for /frontend:** A technical project page falls in the harshly screened group. The first 10 seconds of the page, and of the video, must say what the project is and why it matters; the rest of the page only gets read once that screen is passed.
- **Evidence:**
  - [Understanding Web Browsing Behaviors through Weibull Analysis of Dwell Time](http://ryenwhite.com/papers/LiuSIGIR2010.pdf) — Liu, White, Dumais; SIGIR 2010 (DOI 10.1145/1835449.1835513), accessed 2026-09-30 — peer-reviewed paper.
    - "We see that the dwell time is no more than 70 seconds on 80% of the 205,873 pages"
    - "We see that [k] is less than 1 on 98.5% pages." (the symbol k is lost in the PDF text layer)
    - "This observation leads to a hypothesis that negative aging is more common on less-entertaining pages than on fun pages, which in turn suggests that people tend to screen less-entertaining pages more harshly."
  - [How Long Do Users Stay on Web Pages?](https://www.nngroup.com/articles/how-long-do-users-stay-on-web-pages/) — Jakob Nielsen, NN/g, 2011-09-11, accessed 2026-09-30 — practitioner interpretation.
    - "It's clear from the chart that the first 10 seconds of the page visit are critical for users' decision to stay or leave."
    - "To gain several minutes of user attention, you must clearly communicate your value proposition within 10 seconds."
- **Limits / false positives:** The data are browser logs from ordinary browsing, not from evaluation (two weeks of logs from a browser plug-in, en-US market, opted-in users). The 10-second rule is Nielsen's inference; value-proposition clarity was never measured. NN/g writes "99% of web pages" where the paper says 98.5%. The harsher screening of less entertaining categories is framed in the paper as a hypothesis that the category data support, not as a tested effect.

### FD11-F13 — Say what it does, and say it specifically: two copy tests (2001) and the 2024 homepage principles
- **Grade:** B · **Kind:** ASSERTED · **Verdict:** VERIFIED
- **Claim:** Nielsen (2001) calls generic taglines "content-free word count" and proposes two tests. First, list your tagline among competitors' taglines without names and see whether people can tell who does what. Second, rewrite your copy to say the opposite and ask whether any company would say that. NN/g's 2024 homepage principles say:
  - Include a tagline that states what the site does unless the name already gives it away.
  - Replace cheerful welcomes with meaningful taglines.
  - Show specific examples rather than umbrella terms.
  - Avoid purely decorative images.
  - Speak the users' language.
  - Put the most important content above the fold.
  NN/g 2017 adds that making users think to work out whether they are in the right place makes them suspicious of the site.
- **Implication for /frontend:** A deterministic copy check is possible, in three parts. (1) The H1 plus subhead must name a user, an action and an object. (2) Swap test: would the copy read the same with the sponsor's competitor's name in it? (3) Opposite test: flag claims such as "secure, fast, scalable" that nobody would negate. This matches /prose's rule on unambiguous praise words.
- **Evidence:**
  - [Tagline Blues: What's the Site About?](https://www.nngroup.com/articles/tagline-blues-whats-the-site-about/) — Jakob Nielsen, NN/g, 2001-07-21, accessed 2026-09-30 — practitioner guideline.
    - "A website's tagline must explain what the company does and what makes it unique among competitors. Two questions can help you assess your own tagline: Would it work just as well for competitors? Would any company ever claim the opposite?"
    - "these taglines are basically content-free word count"
  - [Homepage Design: 5 Fundamental Principles](https://www.nngroup.com/articles/homepage-design-principles/) — Huei-Hsin Wang, NN/g, 2024-03-15, accessed 2026-09-30 — practitioner guideline.
    - "Do not assume visitors to your site know your brand. Unless your company name inherently gives away what you do, include a concise tagline on your homepage to communicate who you are and what you do."
    - "Thoughtfully curated content examples are more effective in communicating your value than broad, umbrella terms."
    - "Avoid purely decorative or unhelpful graphics, as users tend to skip over them."
  - [First Impressions Matter: How Designers Can Support Humans' Automatic Cognitive Processing](https://www.nngroup.com/articles/first-impressions-human-automaticity/) — Therese Fessenden, NN/g, 2017-10-01, accessed 2026-09-30 — practitioner guideline.
    - "Clearly state who you are and what you do. If users have to invoke System 2 to figure out whether they're in the right place, the increased cognitive effort will cause them to scrutinize and be suspicious of the site."
- **Limits / false positives:** These are guidelines, and none of the three articles reports a measurement. The 2024 article's "studies indicate" gives no reference. (verification note: only part (3) of the proposed check, a word list of claims nobody would negate, is deterministic. Parts (1) and (2) need a model or a human, so they cannot be tier-1 rules of a deterministic checker.)

### FD11-F14 — "5-second test" means two different things; the one validation study found purpose identification equal at 5 s and unlimited, and secondary purposes almost never identified
- **Grade:** A · **Kind:** MEASURED · **Verdict:** VERIFIED
- **Claim:** Perfetti (UIE, 2007) defines the test as purpose recall on single-purpose pages. Participants are told the page will show for 5 s and asked to remember everything, then asked what its most important information was. Perfetti adds that the test works poorly on home pages. NN/g (Chan 2024) defines it instead as a gut reaction to visual style, notes that 5 s is "too short for reading copy", and advises not warning participants in advance. Gronier (J. Usability Studies 2016) tested 146 participants, 68 at 5 s and 78 with unlimited viewing, on one weather homepage with three official purposes. Purpose identification did not differ significantly (1.00/3 against 1.05/3). The main purpose was named by 97.1% and 92.3%. The two secondary purposes were named by only 2.9% and 0% (5 s) and by 9.0% and 2.6% (unlimited). Pragmatic quality and some NetQu@l dimensions scored higher with unlimited viewing.
- **Implication for /frontend:** Viewers take one purpose from a first look, and they do not find secondary features on their own, even given more time. So /frontend should (a) make one purpose unmistakable; (b) surface every other feature explicitly, each with its own heading and proof (see principles); (c) when running a human 5-second test, use Perfetti's version and ask "what does it do, and for whom?", knowing NN/g's version measures style only.
- **Evidence:**
  - [Measuring the First Impression: Testing the Validity of the 5 Second Test](https://www.guillaumegronier.com/resources/2016_JUS_Gronier.pdf) — Guillaume Gronier, Journal of Usability Studies 12(1):8-25, Nov 2016, accessed 2026-09-30 — peer-reviewed article.
    - "The results show that the 5ST is effective for measuring the level of objective identification because there is no significant difference between the two groups, t(126) = -0.91, p = 0.37."
    - Table 4, 5SEC (n=68) / UT (n=78): current weather 66 (97.1%) / 72 (92.3%); weather warnings 2 (2.9%) / 7 (9.0%); five-day forecasts 0 (0.0%) / 2 (2.6%).
    - "The small sample for each condition is not a negligible limitation."
  - [5-Second Tests: Measuring Your Site's Content Pages](https://articles.centercentre.com/five_second_test/) — Christine Perfetti, Center Centre (UIE), published there 2007-09-11, accessed 2026-09-30 — practitioner method.
    - "Next, before we show the user our page, we tell them we'll only display it for 5 seconds. We ask them to try to remember everything they see in this short period."
    - "Home pages and major navigation pages don't yield as valuable results, because they often serve many different tasks."
  - [Testing Visual Design: A Comprehensive Guide](https://www.nngroup.com/articles/testing-visual-design/) — Megan Chan, NN/g, 2024-12-13, accessed 2026-09-30 — practitioner method.
    - "Five seconds of viewing time is too short for reading copy or noticing details like specific fonts, but it is enough to formulate an impression of the visual style."
    - "When conducting a 5-second test, avoid warning participants that the design will be shown for only five seconds."
- **Limits / false positives:** One site, one validation study, n = 146. Whether a page is a home page or a single-purpose page changes what the test measures (Perfetti).

### FD11-F15 — People look at real products and real people; decorative images get skipped and promotional copy costs usability
- **Grade:** B · **Kind:** MEASURED · **Verdict:** CORRECTED
- **Claim:** In NN/g eyetracking (Nielsen 2010), big decorative "feel-good" images were ignored, while product photos, real people and information-carrying images were scrutinised. In one example, a user spent 10% more time on team portraits than on biographies that took 316% more space. In Morkes and Nielsen (1997), 51 users tested five versions of one site ("Travel Nebraska", seven pages each, between-subjects), one of them the promotional control. Against that control, measured usability rose 58% with concise text, 47% with scannable text, 27% with objective (non-promotional) text, and 124% with all three combined. (corrected: "five versions against a promotional control" implied six versions; the five conditions include the control)
- **Implication for /frontend:** Put the running product and its real outputs in the first viewport: a screen recording, a live widget, real numbers. Do not use stock or abstract imagery as the main visual for a project nobody knows. Write objective copy, which addresses tell 17 (buzzword copy).
- **Evidence:**
  - [Photos as Web Content](https://www.nngroup.com/articles/photos-as-web-content/) — Jakob Nielsen, NN/g, 2010-10-31 (last reviewed 2026-08-13), accessed 2026-09-30 — vendor eyetracking data.
    - "Users pay close attention to photos and other images that contain relevant information but ignore fluffy pictures used to "jazz up" web pages."
    - "Photos of products and real people (as opposed to stock photos of models) often fall into this category."
  - [Concise, SCANNABLE, and Objective: How to Write for the Web](https://www.nngroup.com/articles/concise-scannable-and-objective-how-to-write-for-the-web/) — John Morkes, Jakob Nielsen, 1997-01-01, accessed 2026-09-30 — vendor study.
    - "a sample Web site scored 58% higher in measured usability when it was written concisely, 47% higher when the text was scannable, and 27% higher when it was written in an objective style instead of the promotional style used in the control condition"
    - "In this empirical study, 51 Web users tested 5 variations of a Web site."
- **Limits / false positives:** The 1997 study had about 10 users per condition on a travel site. The 2010 examples are qualitative gaze plots.

### FD11-F16 — "Powered by X" describes how, not what: it is not a value proposition
- **Grade:** B · **Kind:** ASSERTED · **Verdict:** VERIFIED
- **Claim:** NN/g (Samsonov 2025) argues that a good value proposition states what the user gets, not the technology behind it, and that relative descriptors such as "easier" or "more powerful" signal an undefined one. It calls AI "a technology, not a user benefit" and cites Cicek, Gursoy and Lu for "AI" in product descriptions reducing conversion.
- **Implication for /frontend:** The same failure applies to "powered by ZK", "AI" or "blockchain" in a hackathon headline. The headline should state the outcome for the sponsor's customer. The technology belongs in the mechanism section and in the section on the sponsor's integration.
- **Evidence:**
  - [“Powered By AI” Is Not a Value Proposition](https://www.nngroup.com/articles/powered-by-ai-is-not-a-value-proposition/) — Pavel Samsonov, NN/g, 2025-07-04, accessed 2026-09-30 — practitioner article.
    - "In contrast, relative descriptors such as "easier" or "more powerful" are often a sign that the value proposition is not defined"
    - "AI is a technology, not a user benefit. In a crowded market, it is not an effective differentiator."
- **Limits / false positives:** An opinion article, and I did not open the conversion study it cites. Some hackathon tracks reward naming the sponsor's technology (F25): name it in the integration section, not as the value proposition.

### FD11-F17 — Ten protocol and fintech first viewports: 2-6-word headlines, an explanatory sentence on 6 of 10, live figures on 4, the product itself on 1
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:** Captured 2026-09-30 between 19:36 and 19:38 UTC with headless Chromium (Python Playwright 1.58.0), a 1440×900 viewport, en-US locale and a French IP: a screenshot of the first viewport plus the visible text. What each first viewport shows:
  - uniswap.org redirects to app.uniswap.org. The H1 "Swap anytime, anywhere." sits above a working Sell/Buy swap widget with one CTA, "Get started", and the sentence "Buy and sell crypto with zero app fees on 23+ networks including Ethereum, Unichain, and Base." Blurred token icons float around it in the second capture (`uniswap-app.png`); the first (`uniswap.png`, 10 s earlier) shows none.
  - aave.com: the label "Aave App" above the H1 "The World's Savings App", then "Get paid every second with global rates and Balance Protection." and 2 CTAs. Three phone mockups of the app: two show "Earning 7.25%", and the third shows "Simulated Rate 7.25%" instead. Lavender background; cookie banner. (corrected: the earlier wording had all three mockups showing "Earning 7.25%" and one of them also labelled "Simulated Rate"; in `aave.png` and `fold.json` only two say "Earning", at x = 421 and x = 678, and the third says "Simulated Rate", at x = 902)
  - morpho.org: H1 "Bring the world's credit onchain", then "An open network for lenders, borrowers, and everyone building between them." Live figures "TOTAL DEPOSITS $16,661,271,703" and "OUTSTANDING LOANS $5,492,965,656" sit under monospace labels, beside a converging-line graphic on a blueprint grid. "Use Morpho" is in the nav.
  - ondo.finance: an announcement bar (BlackRock portfolios), then the H1 "Welcome to the Open Economy" over a city photograph, "Scroll to explore", and a partner logo strip. The explanatory sentence exists in the page at y = 856 px but is not visible in the screenshot.
  - chain.link: no H1. "LINK" sits beside a rotating list (DeFi, Stablecoins, Stocks, Tokenized Assets...), with the sentence "Chainlink is the industry-standard oracle platform bringing the capital markets onchain and the market leader powering the majority of decentralized finance (DeFi).", 2 CTAs and an institutional logo strip (ANZ, DTCC, Fidelity, Mastercard, SIX, Polymarket, SGX FX...).
  - stripe.com/en-fr: a live counter, "Global GDP running on Stripe: 1.72445140%", above the H1 "Financial infrastructure to grow your revenue.", which continues for one more sentence. 2 CTAs, a customer logo strip and a gradient ribbon.
  - hyperliquid.xyz: the serif H1 "Infrastructure to House All Finance", then "Trade crypto, commodities, indices, FX, and real-world assets onchain, 24/7, without intermediaries.", the CTA "TRADE", a partner logo strip and a particle band.
  - ethena.fi: nav pills "$5.4B" and "5.0% APY", then the H1 "Digital Dollars for the Internet Economy" over a planet render, the CTA "Earn with USDe", and a row of figures: "Avg sUSDe APY 10.5%", "Total Rewards Distributed $785,949,402", "Total Supply $5.4B". No explanatory sentence.
  - eigenlayer.xyz redirects to eigencloud.xyz (rebranded). An announcement bar, the H1 "Verifiable cloud for the Agentic Era", "Build apps and agents your users can trust.", the CTA "Start building now" and a 3D block render.
  - lido.fi: an announcement bar, the H1 "Liquid / Decentralized / Simple staking with stETH", "Empowering and securing Ethereum since 2020", live "2.3% APR*" and "$26,295,181,692 TVL**", the CTA "Stake" and a gradient brand drop.
  Tally across the ten:
  - Headlines run 2-6 words (median 5).
  - A visible explanatory sentence: 6/10 (Uniswap, Aave, Morpho, Chainlink, Stripe, Hyperliquid). A vague benefit line instead: 2/10 (EigenCloud, Lido). Neither: 2/10 (Ethena, Ondo).
  - Live protocol figures: 4/10 (Morpho, Ethena, Lido, Stripe). The product itself: 1/10 (Uniswap); product mockups: 1/10 (Aave).
  - Logo strips: 4/10 (Hyperliquid, Chainlink, Stripe, Ondo). Announcement bars: 3/10.
  - Two primary CTAs or fewer: all ten. Abstract or decorative art: 8/10. A mechanism diagram above the fold: none.
- **Implication for /frontend:** The structure worth borrowing: a short headline, one explanatory sentence, at most 2 CTAs, and one proof strip (live figures or logos). For a product nobody knows, the strongest pattern is Uniswap's: the homepage is the product. None of the ten explains a mechanism above the fold, which leaves room for a hackathon project whose value is its mechanism (F27).
- **Evidence:**
  - OBSERVED. The script `fold.py` and all captures (`*.png`, `fold.json`) are in `C:/Users/Utilisateur/.claude/skills/frontend/research/assets/evidence-first-impressions-jury/`. Command: `python fold.py "uniswap|https://uniswap.org/" "uniswap-app|https://app.uniswap.org/" "aave|https://aave.com/" "morpho|https://morpho.org/" "ondo|https://ondo.finance/" "chainlink|https://chain.link/" "stripe|https://stripe.com/" "hyperliquid|https://hyperliquid.xyz/" "ethena|https://ethena.fi/" "eigenlayer|https://www.eigenlayer.xyz/"`, then `python fold.py "stripe|https://stripe.com/en-fr" "lido|https://lido.fi/"`. Output lines include `uniswap https://app.uniswap.org/ Uniswap | Trade Crypto on DeFi’s Leading Exchange` and `eigenlayer https://www.eigencloud.xyz/ EigenCloud – Verifiable cloud for the Agentic Era`. From this IP, stripe.com redirected to its French page, so the English variant /en-fr was captured instead.
- **Limits / false positives:** One capture, one viewport size, desktop only, from a French IP. Some content exists in the page but not on screen (Hyperliquid's press cards, Ondo's sentence, EigenCloud's menus), so the tally follows the screenshots. Live figures change by the minute: Ethena's rewards counter reads $785,949,402 in `ethena.png` but $785,949,372 and $785,949,408 in the DOM text captured seconds later. The 2-6-word range counts only Stripe's emphasised first sentence (its H1 element holds two sentences, about 25 words). The range and the median of 5 hold whether Lido's rotating H1 is counted as its four visible words or its six DOM words, and Chainlink's as "LINK" plus one rotating word. (verification note: all eleven screenshots, ten sites with Uniswap captured twice, and `fold.json`, `fold.py` and `tells.py` were opened and re-read; Python Playwright 1.58.0 is the installed version.)

### FD11-F18 — The two exemplars with no explanatory sentence are established brands; a hackathon project has no brand to lean on
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:** Ethena, whose total supply shows as $5.4B, and Ondo show no sentence in the first viewport saying what the product does. Both rely on name recognition and in-page proof: figures, a BlackRock announcement, partner logos. In Fogg et al. (F09), comments about unfamiliar names typically hurt credibility, and NN/g advises never assuming visitors know the brand (F13).
- **Implication for /frontend:** Do not carry vague headlines such as "Welcome to the Open Economy" from famous protocols into a hackathon project. Borrow their layout and proof devices, not their brand-dependent copy: the jury met the project's name a few minutes earlier.
- **Evidence:**
  - OBSERVED in `ethena.png`, `ondo.png` and `fold.json` (the same capture as F17). Ondo's `fold.json` record holds the sentence "At Ondo, we design institutional-grade platforms, assets, and infrastructure to bring financial markets onchai[n...]" at y = 856 in a 900 px viewport, and it does not appear in `ondo.png`. Supporting sources: F09 (Fogg 2003) and F13 (NN/g 2024).
- **Limits / false positives:** Two cases. The inference that brand recognition licenses vagueness is mine: F09 and F13 support it, but it was not measured on these sites.

### FD11-F19 — Several of the owner's "vibecoding" tells appear on the exemplar sites themselves
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:** A computed-style probe of the same first viewports (`tells.py`) found the following.
  - Ethena's H1 uses `background-clip: text` with a linear gradient: tell 2, gradient hero text. All three stops sit at hue 217-219°, so it is a lightness gradient, not a sweep across hues. The same gradient colours its figures.
  - Ethena's nav bar uses `backdrop-filter: blur(12px)`: tell 6, glass. Stripe's cookie banner also uses `blur(20px)`, and Hyperliquid stacks eight empty layers with progressive blurs from 0.0625 px to 8 px.
  - Chainlink's body font is `Inter, Tahoma, sans-serif`, and Inter sets its nav, sentence and buttons while the rotating display words use TASA Orbiter VF: tell 4, for body text only. Ethena's stack is `SuisseIntl, Inter, system-ui, sans-serif`, and its CSS self-hosts SuisseIntl in weights 100-500, so the first viewport renders SuisseIntl; Inter is only a declared fallback there, not tell 4. (corrected: Ethena was counted as tell 4 on the strength of an unrendered fallback; the probe records each element's declared first family, not the rendered font)
  - Lido's hero carries radial glows at 20-25% opacity in pink (hue 346°), blue-violet (241°) and peach (14°). Aave's hero sits on a lavender background, and Stripe's ribbon runs purple to pink to orange. These are the tell 1 family, judged from the screenshots.
  - Aave places a product label ("Aave App") above its H1, and Stripe a live counter: the tell 9 position.
  - No site has emoji in its headings, so tell 3 is absent from all ten.
  - Hyperliquid sets its H1 in a light serif display face (Teodor Light), not italic.
- **Implication for /frontend:** A slop checker built from the 20 tells would fire on the category's exemplars, which breaks the skill family's standard that tier-1 rules stay silent on human-designed controls. Tells 1, 2, 4, 6 and 9 need tier-2 treatment. They pass when the value can be traced to a named exemplar or to the sponsor's brand. They get flagged when they are a framework default, when several occur together, or, for gradient text, when the gradient sweeps across hues rather than lightness. The checker has to measure this, not assume it.
- **Evidence:**
  - OBSERVED. `tells.py` and `tells.json` are in the assets folder. Excerpts from `tells.json`:
    - ethena H1: `"bi": "linear-gradient(90deg, rgb(164, 175, 194) -1.49%, rgb(231, 239, 252) 19.18%, rgb(191, 212, 250) 60.52%)", "clip": "text"`
    - ethena nav: `{"tag": "DIV", "bf": "blur(12px)", "text": "Products\nEcosystem\nNetwork\nTransparency\nResources\n$5.4B\n5.0%"}`
    - chainlink: `"bodyFf": "Inter, Tahoma, sans-serif"`
    - lido: `radial-gradient(rgba(255, 91, 130, 0.2) 0px, rgba(0, 0, 0, 0) 60%)` and `radial-gradient(rgba(147, 146, 255, 0.2) 0px, rgba(0, 0, 0, 0) 60%)`
  - Hues computed with Python `colorsys`: (164,175,194) = 218°, (231,239,252) = 217°, (191,212,250) = 219°, (255,91,130) = 346°, (147,146,255) = 241°.
  - (added at verification) `tells.json` also records `stripe` glass `{"tag": "DIV", "bf": "blur(20px)", "text": "We use cookies to improve your experience and for marketing."}` and eight `hyperliquid` glass entries from `blur(0.0625px)` to `blur(8px)` with empty text.
  - (added at verification) Ethena stylesheet `https://ethena.fi/_next/static/css/cd2de672c2e4a59a.css` (hashed name, changes per deploy), accessed 2026-09-30: `@font-face{font-family:SuisseIntl;font-style:normal;font-weight:400;font-display:swap;src:url(/_next/static/media/SuisseIntl-Regular.c86b497a.woff2)format("woff2");...}`, with faces from weight 100 to 500. A second stylesheet, `2f464403e88bbcf0.css`, self-hosts Inter as well.
- **Limits / false positives:** The probe checks only four tells from computed styles in a first viewport: gradient text, glass, font family and gradient backgrounds. More are detectable from computed styles and the DOM (coloured left borders for tell 5, emoji in headings for tell 3, a small element above the H1 for tell 9, text contrast for tell 7), but this probe did not look. It also reads each element's declared first font family, not the font that rendered. The purple-family call on Aave and Stripe is my visual judgement from the screenshots. Tells 8, 10, 12, 13 and 14 need full-page and interaction probes, which I did not run. (corrected: "only four tells can be detected from computed styles" overstated a limit of this probe as a limit of the method)

### FD11-F20 — How exemplars show proof without clutter: exact live figures with small labels, a "simulated" label, logo strips; and they ignore NN/g's advice against decorative imagery
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:** Proof devices seen in the first viewports:
  - exact live figures to the dollar with small labels: uppercase monospace labels above the figures on Morpho ("TOTAL DEPOSITS $16,661,271,703"), plain labels with footnote markers below them on Lido ("$26,295,181,692" over "TVL**");
  - a live counter in the slot above the headline (Stripe);
  - metric pills in the nav (Ethena);
  - third-party logo strips (Chainlink, Hyperliquid, Stripe, Ondo);
  - an explicit status label on a figure that is not live, on one of Aave's three mockups ("Simulated Rate 7.25%"); the other two show "Earning 7.25%" with no label. Aave's own waitlist terms define simulated rates as "Annual Percentage Yield (APY) projections generated under illustrative and hypothetical conditions", so the label is a disclosure term, applied inconsistently here.
  Eight of the ten also use decorative or abstract visuals (a planet, 3D blocks, a city photograph, ribbons, particles), which NN/g advises against (F13, F15).
- **Implication for /frontend:** For a hackathon, that means:
  - one or two exact live figures in the first viewport, each with a short label and a link to its source;
  - a status label on anything simulated or on testnet (the Aave pattern);
  - a strip for the sponsor's integration that points to evidence, not a logo wall of unrelated brands.
  The exemplars can afford abstract art because their brands and figures already do the explaining. A project without a brand should give that space to the product (F15, F18).
- **Evidence:**
  - OBSERVED in `morpho.png`, `lido.png`, `stripe.png`, `ethena.png`, `aave.png`, `chainlink.png`, `hyperliquid.png` and `ondo.png`, plus the `fold.json` text records. Aave: "Simulated Rate" at y = 652. Morpho: "TOTAL DEPOSITS" at 11.1px in FK Grotesk Mono, the figure "16,661,271,703" at 29.6px. Lido: the figures at y = 659, the labels "APR*" and "TVL**" at y = 702.
  - (added at verification) [Aave App Waitlist Supplemental Terms](https://aave.com/legal/app/waitlist-supplemental-terms) — Aave Labs, undated on the page, accessed 2026-09-30 — official legal terms.
    - "Simulated rates represent Annual Percentage Yield (APY) projections generated under illustrative and hypothetical conditions."
    - "Any savings rates, “boosts,” or APY figures displayed within the Program interface are illustrative simulations only, based on hypothetical market scenarios."
- **Limits / false positives:** A snapshot. I did not check the exemplars' figures against chain data, and "without clutter" is my own judgement. The Aave terms govern the waitlist programme's interface; that they are the reason for the homepage label is an inference. (corrected: Lido's labels sit below its figures, not above; the "Simulated Rate" label appears on one of three mockups, not as a general honest-labelling practice)

### FD11-F21 — ETHGlobal: 7-minute finalist slots, five criteria including usability, async screening to the top 20%, 2-4-minute videos
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:** The ETHOnline 2026 rules page sets out:
  - Finalists present for 7 minutes: 4 of demo, 3 of Q&A.
  - Criteria: Technicality, Originality, Practicality, Usability (UI/UX/DX) and WOW Factor.
  - At most async events, a first async round screens projects, and "typically, only the top 20%" advance. Partners judge asynchronously from the submitted materials.
  - The demo video runs 2-4 minutes, and uploads below 720p or over 4 minutes are rejected. Sped-up video, text over music and AI voiceovers are not allowed; backstory should take 20 seconds at most, and slides 4 bullets at most.
  At ETHGlobal Singapore 2024, 24 judges picked 10 finalists from 309 submissions.
- **Implication for /frontend:** At async events judges first see the frontend through a recording, and at every ETHGlobal event partners judge from the submitted materials. The frontend must stay legible in a 720p recording and show the project working inside the 4-minute demo, and it must make usability visible, since that is an explicit criterion. Only about 3% of projects (10 of 309) reached the Singapore 2024 stage. At in-person events that screen is a live 7-minute session per team, not a reading of the materials; at async events it is the materials. (corrected: "the screening happens on the materials" was stated for an in-person event, where ETHGlobal's rules give every finalist-track team a live 7-minute judging session)
- **Evidence:**
  - [ETHOnline 2026 — Event details](https://ethglobal.com/events/ethonline2026/info/details) — ETHGlobal, accessed 2026-09-30 — official rules.
    - "Each team has 7 minutes to present: 4 minutes for the demo, followed by 3 minutes for Q&A with the judges."
    - "Usability (UI/UX/DX): How intuitive is your project? Have you made it easy for users to interact with your solution?"
    - "The first round is asynchronous, and the second round is live judging at the event. The judging criteria for both rounds is the same and the first round of async judging is used to screen projects. Typically, only the top 20% of projects advance to the live judging session."
    - "Must be between 2 and 4 minutes: Videos under 2 minutes or over 4 minutes will be automatically rejected during upload."
    - "DO NOT export the video in any resolution less than 720p (Upload will fail if the video is less than 720p)"
    - "DO NOT use a text to speech synthesizer / AI Voiceover"
  - [ETHGlobal Singapore 2024: Recap](https://ethglobal.medium.com/ethglobal-singapore-2024-recap-ce128f7a800f) — ETHGlobal, 2024-10-01, accessed 2026-09-30 — organiser report.
    - "The excitement reached its highest point as the top 10 finalists out of 309 submissions were revealed"
    - "Our 24 amazing judges had their work cut out for them."
  - (added at verification) [ETHGlobal New York 2026 — Event details](https://ethglobal.com/events/newyork2026/info/details) — ETHGlobal, accessed 2026-09-30 — official rules of an in-person event. The Cannes 2026, Tokyo 2026 and Lisbon 2026 pages carry the same sentences.
    - "Demo Video: While optional, we strongly encourage you to include a 2-4 minute demo video showcasing your project."
    - "You may optionally present to partners at their booths for feedback and networking; this is not required for judging — partners will evaluate submissions based on the materials you provide."
    - "Head to the judging check-in table, where you'll be prepared for your session. Each team has 7 minutes to present: 4 minutes for the demo, followed by 3 minutes for Q&A with the judges."
- **Limits / false positives:** Rules vary by event; in-person events make the video optional (the New York 2026 page above). TOKEN2049 Origins, Ledger OP3N and the BNB hack have their own rules, which I did not check here.

### FD11-F22 — ETHGlobal's 2026 AI policy: document where AI was used, expect exclusion for fully AI-built projects, include the spec files
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:** The same rules page requires attribution of AI-generated or AI-assisted files. It says projects that rely entirely on AI "may not be eligible for partner prizes or finalist consideration", and it requires spec files, prompts and planning artifacts whenever a spec-driven workflow is used.
- **Implication for /frontend:** A frontend that "screams vibecoding" is more than an aesthetic risk: it invites the question of whether the team contributed anything meaningful. /frontend should leave a trail that can be shown to judges: the exemplar captures, the design decisions with their sources, and the feature map. /execution's spec files must ship in the repository.
- **Evidence:**
  - [ETHOnline 2026 — Event details](https://ethglobal.com/events/ethonline2026/info/details) — ETHGlobal, accessed 2026-09-30 — official rules.
    - "Attribution: Clearly document in your submission where and how AI tools were used in the project. This includes specifying which parts of the code, specific files, or assets were generated or assisted by AI."
    - "Submissions that rely entirely on AI without meaningful contributions from team members may not be eligible for partner prizes or finalist consideration."
    - "Judges need to see the full picture of how you directed the AI, not just the generated output."
- **Limits / false positives:** One organiser; other events may differ.

### FD11-F23 — Devpost: about 30 projects in ~5 judging hours, 1-5 stars per criterion; the video is often among the first things judges review, and it should say what the app does in its first seconds
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:** Devpost's help centre says organisers often send judges at most 30 projects and expect about 5 hours of scoring, which works out to about 10 minutes per project (my arithmetic). Judges rate each criterion from 1 to 5 stars, and the platform weights criteria equally. The demo video is "often one of the first things" judges review. A screencast is recommended over "snazzy marketing videos", and the app's purpose should be stated in the first few seconds.
- **Implication for /frontend:** Async judges spend minutes, not hours, and the video is often one of the first things they open, so the product's first screen should appear in the video's first seconds. The frontend must show what it does without depending on narration. (corrected: the title and implication said judges "watch the video first" and "start with the video"; Devpost says only that the video is "often one of the first things" judges review)
- **Evidence:**
  - [Judging & public voting](https://help.devpost.com/article/64-judging-public-voting) — Devpost, last updated 2024-11-01, accessed 2026-09-30 — official help article.
    - "For example, we often send a max of 30 projects to judges with the expectation that scoring will take about 5 hours."
  - [How to judge an online Hackathon](https://help.devpost.com/article/103-how-to-judge-an-online-hackathon) — Devpost, last updated 2026-08-11, accessed 2026-09-30 — official help article.
    - "For each item in the list of criteria, you will assign a rating of 1-5 stars."
  - [Video-making best practices](https://help.devpost.com/article/84-video-making-best-practices) — Devpost, last updated 2026-05-27, accessed 2026-09-30 — official help article.
    - "In fact, it’s often one of the first things that judges, voters, and those checking out your software will review."
    - "Snazzy marketing videos are great for promotional purposes, but they don’t help others understand and evaluate your app."
    - "Be sure to explain what your app does (and if making the video for a specific hackathon, how it addresses the hackathon) in the first few seconds of your video."
- **Limits / false positives:** "30 projects in 5 hours" is an example, not a rule; the per-project time is derived.

### FD11-F24 — MLH plans 4 minutes per project per judge, 2 of them for presentation and demo; videos should demo, not present
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:** MLH's organiser guide budgets 4 minutes per project per judge: 2 for presentation and demo, 1 for questions and scoring, 1 for walking to the next table. Its example assumes 3 judging rounds per project, so 175 projects in 2 hours need 18 judges. Stage finalists need about 7 minutes per team, 3-5 of them presenting. The guide recommends 2-minute videos that demo the hack, and reports a 2026-season average of 1 project per 4 checked-in hackers.
- **Implication for /frontend:** In expo judging, a judge sees the product for about 2 minutes. The first screen and the one demo path must make sense inside that window, and the page must still explain itself once the team is gone, because judges move on and discuss projects later.
- **Evidence:**
  - [Judging Plan — MLH Hackathon Organizer Guide](https://guide.mlh.io/general-information/judging-and-submissions/judging-plan) — Major League Hacking, accessed 2026-09-30 — official organiser guide.
    - "Time taken by a Judge per project (MLH recommendation: 4 mins per project. 2 minutes for presentation + demo, 1 minute for questions from judges and score compilations, and 1 minute for judge travel)"
    - "Structurally, we recommend having hackers submit 2 minute videos on your submission platform for the judges to review." ... "Their video should be a demo of their hack, not a presentation."
    - "Keep in mind you will need ~7 minutes per team if you do this, 3-5 for the presentation and 2 minutes to set up the next group."
- **Limits / false positives:** These are student hackathons, and the figures are planning assumptions, not observed judge behaviour. (verification note: the cited URL now redirects to guide.mlh.com. The same paragraph says the video "is not needed for judging when science fair style, but can be a reference during final deliberations", which supports the point that judges return to the materials after the table visit.)

### FD11-F25 — DoraHacks: an AI judge reads the page and the repo first; organisers can let judges skip non-recommended projects; "the first two paragraphs"
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:** DoraHacks' AI judging ranks submissions against requirements the organiser writes, and its BUIDL AI reads attached links, GitHub included, as well as the project page. With "Recommendation" enabled, judges can review only the highlighted submissions. Common human metrics include Innovation/Wow Factor, Profile Completion, Alignment with Track Requirements, Code Quality and Business Feasibility. DoraHacks' own submission advice:
  - Judges review "dozens or even hundreds" of submissions.
  - The first two paragraphs should make the project's worth clear.
  - Avoid grandiose claims.
  - Do not make sponsors hunt for evidence of the integration.
  - Check that the demo site loads.
- **Implication for /frontend:** The first reader may be a model reading text. Every claim the frontend makes must also exist as text in the README and on the page, not only in images or a canvas. The sponsor integration must be stated plainly and linked to proof, and the same text must survive a human skim.
- **Evidence:**
  - [Introducing Hackathon AI](https://dorahacks.io/blog/guides/hackathon-ai) — DoraHacks, published 2026-01-22, accessed 2026-09-30 — official product guide.
    - "BUIDL AI looks at attached links (including Github) as well as the BUIDL profiles, so sifting through code repos for proof of relevance to your hackathon is a thing of the past."
  - [Judging Guide For Judges](https://dorahacks.io/blog/guides/judging-judges) — DoraHacks, 2026 (see Contradictions for the dates), accessed 2026-09-30 — official guide.
    - "This typically allows judges to skip some submissions and review only the highlighted (recommended) ones that meet the configured threshold."
  - [Judging Guide for Hackathon Organizers](https://dorahacks.io/blog/guides/judging-organizers) — DoraHacks, page shows "Published on 2026/02/14", accessed 2026-09-30 — official guide.
    - "Common metrics include Innovation/Wow Factor, Profile Completion, Alignment with Track Requirements, Code Quality, and Business Feasibility."
  - [What Does a Good Hackathon Submission Look Like?](https://dorahacks.io/blog/news/good-hackathon-submission) — DoraHacks, published 2026-01-31, accessed 2026-09-30 — official advice.
    - "Judges review dozens or even hundreds of submissions, and the ones that stand out are clear, complete, and easy to evaluate."
    - "If a judge only reads your first two paragraphs, they should already understand what makes your project worth attention."
    - "Don't assume judges will dig through your code to verify eligibility."
- **Limits / false positives:** These platform features are organiser options. The publication dates on the guide pages are inconsistent (see Contradictions).

### FD11-F26 — Judges' own accounts: say what it is in the first sentence, give one contrast moment, deploy it, and stop polishing at "shipped product"
- **Grade:** C · **Kind:** ASSERTED · **Verdict:** CORRECTED
- **Claim:** Practitioner accounts point the same way:
  - Teams that opened with "this is a tool that does X for Y" scored better, and judges rank each project against the last few they saw (Kurbaitaev, three hackathons in July 2026).
  - One clear "oh, this is possible now" moment beats a tour of features, and something must work within about 90 seconds (judges of the JetBrains x Codex Hackathon, quoted by Katherine Druckman on the JetBrains blog, June 2026).
  - An ETHDenver 2023 judge, the EIP editor Zainan Zhou, reports 90-second presentations and large scoring differences between deployed, local and design-only demos. He also says templates often beat scratch-built UIs visually, and polish beyond "an average shipped product" adds no score.
  (corrected: the JetBrains post is by Katherine Druckman, not Viktor Kiselev, whose name belongs to a different post in the page's related-articles block; the TechFlow post is dated 2023-03-07 and signed "Written by: ZainanZhou", so it is neither undated nor anonymous, and its advice is three years old)
- **Implication for /frontend:** These accounts support a one-line identity on the first screen and a before/after contrast as the signature moment (F27). They also argue for a deployed URL and a finite polish budget: stop once the page reads as a competent shipped product, and put the remaining time into proof.
- **Evidence:**
  - [How to Win a Hackathon: Notes From the Judging Table](https://blog.jetbrains.com/ai/2026/06/how-to-win-a-hackathon-notes-from-the-judging-table/) — Katherine Druckman, JetBrains, 2026-06-22, accessed 2026-09-30 — practitioner account quoting several judges.
    - "Bonnie put the upside plainly: one clear “oh, this is possible now” moment is much stronger than a tour of every feature. Show what used to be frustrating, show the new version, and make the contrast obvious."
    - "Jono’s rule: You have to be able to show something working within about 90 seconds."
  - [What Judges Actually Score: Notes From a Year of Hackathon Judging](https://dev.to/kurbaitaev/what-judges-actually-score-notes-from-a-year-of-hackathon-judging-3p4l) — Magomed Kurbaitaev, DEV, 2026-07-27, accessed 2026-09-30 — single-judge account (grade D on its own).
    - "The teams that scored well opened with a plain declarative: this is a tool that does X for Y."
    - "They are ranking it against the six they just saw while trying to remember which one had the map."
  - [ETHDenver Hackathon Judges: How to Excel in a Hackathon?](https://www.techflowpost.com/en-US/article/11473) — Zainan Zhou (signed "ZainanZhou", introduced on the page as an EIP Editor), TechFlow, 2023-03-07, accessed 2026-09-30 — single-judge account (grade D on its own).
    - "Hackathon presentations are only 90 seconds—extremely short—so they must be concise."
    - "achieving a clean, professional look comparable to an average shipped product is sufficient—beyond that, further visual polish brings no additional scoring benefit."
    - "Make smart use of existing templates. Web frontend templates can greatly boost prototyping efficiency and deployment convenience, often outperforming scratch-built projects even in visual quality."
- **Limits / false positives:** These are anecdotes with no scores or counts. The ETHDenver account dates from March 2023, so its 90-second format and its view of templates predate the 2026 judging rules cited in F21-F25.

### FD11-F27 — Orma's signature: the naive reading dashed and muted, the correct one solid and accent, everywhere the two appear together, the gap as the largest number, and an audit to keep it that way
- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED
- **Claim:** In the owner's XRPL project Orma:
  - The spec puts the naive NAV in `--muted` with a dashed 1px rule and the correct NAV in `--accent` with a solid rule, and makes the divergence the largest number on screen (72 px).
  - The design document turns the pair into two classes, applied wherever both readings appear: the NAV split, the sparkline, the list column. The CSS implements `.pair-naive` with `border-bottom: 1px dashed` and `.pair-correct` with `solid`.
  - A first animation using `stroke-dasharray` silently removed the naive line's dashes, and a `clip-path` reveal replaced it. A UI audit now checks that the naive line stays dashed and the correct one solid.
  - The tokens were renamed `--read-naive` and `--read-correct` after `shadcn init` overwrote `--muted` and `--accent`.
  - The same documents rewrite the vocabulary for the audience, since the reader is a credit analyst ("vault" becomes "facility", "oracle" becomes "calculation agent"), and ban 27 terms from rendered text.
  - The spec rules that explanations stay "Always visible — not a tooltip. Judges do not hover.", and aims for "a desk instrument that happens to be well made".
- **Implication for /frontend:** This is a reusable pattern for any project whose thesis is "the usual reading is wrong". It has five parts:
  1. Two semantic tokens and two classes, each with one meaning.
  2. A non-colour channel (the dash) as well as colour.
  3. The difference itself, printed as the largest figure.
  4. A check that fails if an animation, a theme or a component library alters the pair.
  5. The audience's vocabulary, not the protocol's.
  The owner reports the project as a win (task brief); its effect on judges was not measured.
- **Evidence:**
  - OBSERVED in the owner's files, read 2026-09-30.
    - `C:/Users/Utilisateur/Documents/Coding/XRPL_Hackathon_2026/docs/20-SPEC-FRONTEND.md:183`: "The naive figure: `--muted`, with a **dashed** 1px bottom rule. The correct figure: `--accent`, solid rule."
    - `.../docs/20-SPEC-FRONTEND.md:190`: "**`navDivergenceBps` is the largest number on the screen.**"
    - `.../docs/20-SPEC-FRONTEND.md:227`: "Always visible — not a tooltip. Judges do not hover."
    - `.../docs/20-SPEC-FRONTEND.md:444`: "with its `computed by the ledger, not by us` caption"
    - `.../docs/20-SPEC-FRONTEND.md:861`: "A judge should feel they are looking at a desk instrument that happens to be well made."
    - `.../DESIGN.md:41`: "**Signature répétée** : *la paire*. Lecture naïve = `--muted`, filet **pointillé**. Lecture correcte = `--accent`, filet **plein**. Deux classes (`.pair-naive` / `.pair-correct`) appliquées partout où les deux lectures cohabitent : NAV split, sparkline, colonne nav de la liste." (the pair, applied wherever both readings coexist)
    - `.../DESIGN.md:84-85`: "la première version traçait la sparkline avec `stroke-dasharray`, ce qui **supprimait les pointillés de la lecture naïve**." (the first version drew the sparkline with stroke-dasharray, which removed the naive reading's dashes)
    - `.../DESIGN.md:201`: the audit's `contract` section checks "lecture naïve **pointillée**, correcte **pleine** (§6)"
    - `.../DESIGN.md:659`: "Le lecteur n'est ni dev ni crypto : c'est un analyste crédit." (the reader is neither a developer nor a crypto person: a credit analyst)
    - `.../DESIGN.md:712`: "**27 termes interdits**"
    - `.../app/src/app.css:738-739`: `.pair-naive  { color: var(--read-naive);  border-bottom: 1px dashed var(--read-naive); }` and `.pair-correct{ color: var(--read-correct); border-bottom: 1px solid  var(--read-correct); }`
- **Limits / false positives:** One project, and the "win" is not verified here. DESIGN.md says "pointillé", which in French can mean dotted or dashed, while the spec and the CSS say dashed. (verification note: every cited line was re-read and matches; the DESIGN.md:41 quote runs over lines 41-43, the spec quotes at :227 and :861 continue onto the next line, and the `shadcn init` rename is at DESIGN.md:249-251. No record of the event's result was found in the repository's README or in the owner's project memory note, last modified 2026-09-24, so the "win" stays unverified.)

### FD11-F28 — Visual comparisons are built from three blocks; pairing side-by-side views with an explicit difference covers each block's weakness
- **Grade:** A · **Kind:** ASSERTED · **Verdict:** VERIFIED
- **Claim:** Gleicher et al. (2011) classify all visual comparison designs into three building blocks and their hybrids:
  - juxtaposition: the objects side by side, relying on the viewer's memory;
  - superposition: the objects overlaid, relying on the visual system;
  - explicit encoding: the computed relationship, such as a difference, relying on computation.
  They single out juxtaposition combined with explicit encoding as "particularly valuable".
- **Implication for /frontend:** For naive against correct, or before against after: show both readings side by side (juxtaposition), overlay them where they evolve over time (superposition, as in a dual-line sparkline), and print the computed gap as the headline figure (explicit encoding). Orma used all three (F27).
- **Evidence:**
  - [Visual Comparison for Information Visualization](https://graphics.cs.wisc.edu/Papers/2011/GAWJHR11/paper.pdf) — Gleicher, Albers, Walker, Jusufi, Hansen, Roberts; Information Visualization 10(4):289-309, Oct 2011 (DOI 10.1177/1473871611416549), accessed 2026-09-30 — peer-reviewed survey and taxonomy (authors' copy).
    - "The three categories can be distinguished by the principal mechanism used to make connections between objects: juxtaposition uses the viewer's memory, superposition uses the visual system and explicit encodings use computation to determine the relationships."
    - "This combination of techniques is particularly valuable because each technique can address some of the shortcomings in the other. Explicit encodings can help the user make the connections between juxtaposed views, and the juxtaposed views can give context for the encoded relationships."
- **Limits / false positives:** A taxonomy drawn from a literature survey, not an experiment on how fast people understand each design. (verification note: the authors write "We have not encountered a hybrid of all three, though it may be possible." Orma's use of all three is spread across three elements, the split, the sparkline and the headline figure, not one chart. The PDF is marked "Preprint: Copy contains subtle differences with final publisher's version".)

### FD11-F29 — Encode the naive/correct difference with a channel other than colour; the "dashed means uncertain" convention has only indirect support
- **Grade:** A · **Kind:** MEASURED · **Verdict:** CORRECTED
- **Claim:** WCAG 2.2 success criterion 1.4.1 says colour must not be the only visual means of conveying information. The Understanding document lists technique G111, "Using color and pattern", as sufficient when colour is used within an image to convey information (its "Situation B"), which covers a chart such as the sparkline. When the colour of text itself carries the meaning (its "Situation A"), the listed techniques include G14 (the information is also available in text) and G182 (additional visual cues), which is where a dashed or solid underline on a figure belongs. (corrected: G111 was presented as sufficient for 1.4.1 in general; W3C lists it only for colour within images, and the Understanding page is informative, not normative) MacEachren et al. (2012) rated how intuitive visual variables are for showing uncertainty: fuzziness, location and value came out good; arrangement, size and transparency acceptable; hue, saturation, orientation and shape unacceptable. But they tested point symbols only.
- **Implication for /frontend:** The two readings must differ in pattern (the dash) as well as colour, which also survives greyscale projection and colour-blind viewers. Treat "dashed means naive or estimated" as a convention and label it in a legend: the uncertainty study never tested lines.
- **Evidence:**
  - [Understanding SC 1.4.1: Use of Color](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html) — W3C, WCAG 2.2, accessed 2026-09-30 — informative Understanding document ("Informative explanations, not required to meet WCAG") that quotes the normative success criterion.
    - "Color is not used as the only visual means of conveying information, indicating an action, prompting a response, or distinguishing a visual element."
    - "Situation B: If color is used within an image to convey information: G111: Using color and pattern G14: Ensuring that information conveyed by color differences is also available in text" (list layout flattened)
    - (added at verification) "Situation A: If the color of particular words, backgrounds, or other content is used to indicate information: G14: ... G182: Ensuring that additional visual cues are available when text color differences are used to convey information"
  - [Visual Semiotics & Uncertainty Visualization: An Empirical Study](https://geography.wisc.edu/cartography/projects/publications/MacEachrenEtAl_2012_TVCG.pdf) — MacEachren, Roth, O'Brien, Li, Swingley, Gahegan; IEEE TVCG 18(12):2496-2505, 2012, accessed 2026-09-30 — peer-reviewed study.
    - "we find arrangement, size, and transparency to be acceptable for visualizing discrete entity uncertainty reported at the ordinal level."
    - "Resolution, as presented by MacEachren [27], is omitted because it is applicable to line symbols and images only, while the experiments reported here focus on point symbols only."
- **Limits / false positives:** "Naive" is not the same concept as "uncertain", and I found no study of dashed against solid lines for two competing readings.

### FD11-F30 — Proof works even when nobody clicks it: link the evidence
- **Grade:** B · **Kind:** ASSERTED · **Verdict:** VERIFIED
- **Claim:** The Stanford Web Credibility guidelines (Fogg 2002) summarise the lab's studies with over 4,500 people. The first guideline: make accuracy easy to verify by linking third-party evidence, which signals confidence even when nobody follows the links. Others: match the visual design to the site's purpose, and avoid errors of every kind, broken links included.
- **Implication for /frontend:** Transaction hashes, contract addresses and data sources should be short, visible and linked to explorers or primary sources. A caption saying who computed a figure ("computed by the ledger, not by us" in Orma's spec) is the textual form of the same idea. A single broken explorer link or demo URL costs credibility, and Devpost and DoraHacks both warn about broken links (F23, F25).
- **Evidence:**
  - [Stanford Guidelines for Web Credibility](https://credibility.stanford.edu/guidelines/index.html) — B.J. Fogg, Stanford Persuasive Technology Lab, May 2002, accessed 2026-09-30 — research summary.
    - "Make it easy to verify the accuracy of the information on your site. You can build web site credibility by providing third-party support (citations, references, source material) for information you present, especially if you link to this evidence. Even if people don't follow these links, you've shown confidence in your material."
    - "The visual design should match the site's purpose."
    - "Typographical errors and broken links hurt a site's credibility more than most people imagine."
- **Limits / false positives:** Guidelines that summarise studies from 1999-2002, never re-tested on crypto explorers.

### FD11-F31 — At 50 ms, trust and perceived-usability judgments of homepages are largely driven by visual appeal (added at verification)
- **Grade:** A · **Kind:** MEASURED · **Verdict:** ADDED (added at verification)
- **Claim:** Lindgaard, Dudek, Sen, Sumegi and Noonan (ACM TOCHI 18(1), 2011) ran three experiments with the Lindgaard 2006 stimuli and its 50 ms viewing time. Experiment 1 added a paradigm that disrupts processing after the stimulus disappears, to rule out continued processing as the source of the 2006 result. Experiments 2 (within-subject) and 3 (between-subject) collected visual appeal, perceived usability and trustworthiness. The abstract concludes that all three judgments "are largely driven by visual appeal", while the more cognitively demanding ones are processed differently and rely on somewhat different visual attributes. Tuch et al. (2012, Table 1) summarise study 2 as 50 homepages, 48 participants, two trials at 50 ms without a mask, and judgments of appeal, trust and usability that were consistent across trials and "driven predominantly by appeal".
- **Implication for /frontend:** A jury's first glance does more than rate looks. In this study, perceived trust and ease of use were read off the same 50 ms glimpse and tracked appeal. For a project that handles money, the first viewport's visual quality is also its first trust signal. This complements F06 (prototypicality and trust) and F09 (design look and credibility).
- **Evidence:**
  - [An exploration of relations between visual appeal, trustworthiness and perceived usability of homepages](https://dl.acm.org/doi/10.1145/1959022.1959023) — Lindgaard, Dudek, Sen, Sumegi, Noonan; ACM TOCHI 18(1), Article 1, pp. 1-30, 2011 (DOI 10.1145/1959022.1959023), accessed 2026-09-30 — peer-reviewed article; abstract only, read on the ACM DL page through Exa (a direct request returned 403) and on the ResearchGate record.
    - "Three experiments are reported. All used the stimuli and viewing time as before."
    - "The results suggest that all three types of judgments are largely driven by visual appeal, but that cognitively demanding judgments are processed in a qualitatively different manner than visual appeal, and that they rely on somewhat different visual attributes."
  - [Tuch et al. 2012 preprint, Table 1](https://research.google.com/pubs/archive/38315.pdf) — the source of F02, accessed 2026-09-30 — secondary summary in a peer-reviewed article.
    - Row "Lindgaard et al. (2011), study 2": "50 ; 48", "first and second trial: 50 ms", mask "no", "Judgments of appeal, trust and usability were highly consistent from one trial to the next in aggregate and comparisons of individual data. All three judgments were driven predominantly by appeal." (table layout flattened)
- **Limits / false positives:** The full text is closed access (Semantic Scholar reports it as CLOSED), so effect sizes and the specific visual attributes were not read. The stimuli are the 2006 set of clearly good and clearly bad homepages (F01), so the result says nothing about mid-quality pages. Passive screenshot viewing, pages from before 2006.

### FD11-F32 — Do not animate the headline, tagline or main text into place: NN/g saw scroll-triggered text animations slow users down (added at verification)
- **Grade:** B · **Kind:** ASSERTED · **Verdict:** ADDED (added at verification)
- **Claim:** In an NN/g usability study (Harley 2017), a scroll-triggered effect that animated the main text into place slowed participants down and annoyed them. NN/g's guidelines: weigh the context, since goal-focused audiences on financial and B2B sites are "easily annoyed" by such effects; use them only for secondary, supporting content, not the main bodies of text; and play them only once. Subtle animations often went unnoticed. NN/g's 2024 homepage principles (Wang, cited in F13) apply this to the first screen: avoid animating the logo, the tagline or the main headline.
- **Implication for /frontend:** This gives a jury-side reason behind the owner's tell 12 (fade-in on scroll). The first 10 seconds of a visit (F12) and of a video (F23) should not be spent waiting for the headline, the explanatory sentence or a proof figure to appear. A checker can flag an H1, explanatory sentence or first-viewport figure whose initial computed opacity is 0, or that is bound to a scroll or intersection trigger. This evidence does not cover motion on secondary or decorative elements.
- **Evidence:**
  - [Scroll-Triggered Text Animations Delay Users](https://www.nngroup.com/articles/scroll-animations/) — Aurora Harley, NN/g, 2017-04-16 (modified 2020-04-30), accessed 2026-09-30 — vendor usability-study observation, qualitative.
    - "However, in a recent usability study our participants were slowed down for a completely different reason: a visual effect that caused the main text content to animate into place only after the user had scrolled down to that area of the page."
    - "Sites that support high-stake tasks (e.g., medical or health related, financial, B2B sites) cater to audiences that are goal-focused and easily annoyed by “cute” design features that make them waste time." (spacing normalised)
    - "To mitigate the risks of scroll-triggered animations, use them for secondary, supporting content rather than for the main bodies of text."
    - "Let’s be clear: not all scroll-triggered animations are bad. Subtle ones often go unnoticed (or uncommented upon) in our studies"
  - [Homepage Design: 5 Fundamental Principles](https://www.nngroup.com/articles/homepage-design-principles/) — Huei-Hsin Wang, NN/g, 2024-03-15, accessed 2026-09-30 — practitioner guideline.
    - "Like described in our previous guideline, avoid animating crucial page elements like the logo, tagline, or main headline. Our research indicated that scroll-triggered text animations delay users."
- **Limits / false positives:** Qualitative: the article reports no timings, no sample size and one quoted participant. It concerns scroll-triggered text on content sites, not hero entrance animations on page load, though the 2024 article extends the advice to the headline and tagline.

## Derived principles for the information architecture (synthesis from the findings above, not findings)

1. **Identity first.** The first viewport states what the project is and does, and for whom, in the vocabulary of the sponsor's customers.
   - The exemplars use 2-6-word headlines (F17), but a hackathon project has no brand recognition (F09, F18), so an explanatory sentence under the headline is required (F13, F23, F25, F26).
   - Run NN/g's two copy tests on it: swap in a competitor's name, and write the opposite (F13).
2. **Pick the category, then be typical in form.**
   - Decide which category the jury will file the product under: DeFi protocol site, trading terminal, consumer savings app or institutional desk. Base the choice on /hackathon's map of the sponsor's customers.
   - Capture the first viewports of 3-5 exemplars with the `fold.py` method (F17).
   - Copy their conventions: logo top-left, nav at the top, headline position, figures row, number of CTAs. Do not copy their brand assets.
   - Put the novelty into the mechanism and the proof (F02, F06, F07, F08).
3. **Keep first-viewport complexity low.** Complexity has the larger effect at 17 ms and costs the most (F02, F03), and educated audiences prefer fewer colours and less complexity (F04). Measure it with a screenshot proxy against the exemplars' range (F05).
4. **Show the product, not a mood.**
   - A working surface, a real screenshot or a live figure beats abstract art for a project nobody knows (F15, F20, F23).
   - Uniswap's homepage is its product (F17).
   - The exemplars can afford decorative art only because their brands do the explaining (F18, F20).
5. **Put proof in the first two screenfuls, where 74% of viewing time goes (F10).**
   - Show one live figure with its source in the first viewport.
   - Shorten transaction hashes and link them to an explorer (F30).
   - Label the status of every figure: live, testnet, simulated or planned (Aave's "Simulated Rate", F20).
   - Never print a number that did not come from a real response (Orma, F27).
6. **Build the feature map from the plan.** Each feature in the spec gets:
   - one descriptive heading, for layer-cake scanning (F11);
   - one visible surface;
   - one proof;
   - one status label.
   Generate the map from /execution's task list, and fail the completion check when a feature has no surface. The reason: a first look yields one purpose, and viewers rarely find the secondary ones even with unlimited time (F14: 97% against 3% and 0%). Judges also will not dig through code (F25).
7. **Make each sponsor integration visible.** Give each sponsor technology its own section, with a screenshot or transaction proof. Partners judge asynchronously from the materials (F21, F25).
8. **Use the naive-against-correct signature where the thesis is "the usual reading is wrong".**
   - Two tokens, two classes, colour plus dash (F29).
   - The gap as the largest figure (F28, explicit encoding); both readings side by side and overlaid (F28).
   - A check that the pattern survives animations and themes (F27).
9. **Nothing that matters hides behind interaction.** Judges do not hover, and a recording cannot hover (F27, F21). Keep key text legible when the screen is recorded at 720p (F21, an inference from the upload minimum). Nothing that matters waits for an animation either: the headline, the explanatory sentence and the first figures are visible at load (F32, added at verification).
10. **Keep every claim machine-readable.** AI judges read the page and the repository (F25), so every claim must also exist as text in the README and on the page.
11. **Test the first impression.** Use an automated proxy (Playwright text and screenshot of the first viewport: headline, explanatory sentence, sponsor name and one sourced figure present) plus, where possible, a human 5-second test in Perfetti's version that asks "what does it do, and for whom?" (F14).
12. **Set a polish ceiling.** The 50 ms judgment separates extremes (F01), and one ETHDenver 2023 judge reports no score for polish beyond "an average shipped product" (F26). The goal is to stay out of the bad group, not to out-design Stripe. Spend the remaining time on proof.

## Contradictions between sources

- **What a "5-second test" is.** NN/g (Chan 2024) tests visual style only ("too short for reading copy") and says not to warn participants. Perfetti (2007) warns participants, asks what the page is for, and advises against using the test on home pages. Gronier (2016) found purpose identification no different at 5 s than with unlimited viewing. /frontend should name the variant it runs.
- **How many pages show negative aging.** NN/g (2011) writes "99% of web pages"; Liu et al. (2010) report 98.5%. Nielsen's "value proposition within 10 seconds" is his inference from the hazard curve, not a measured effect.
- **Whether first impressions settle at 50 ms.** NN/g (Fessenden 2017) says the aesthetic decision at 50 ms "rarely changes if you give people more time". Lindgaard's data show lower individual consistency at 50 ms than at 500 ms, agreement that rose between phases, and stimuli chosen as extremes. Reinecke and Gajos (2014, F04) add that appeal is "largely subjective even after a short exposure time of 500ms", which they say challenges the assumption that individual variability is small at first sight (added at verification).
- **Low against medium complexity.** Tuch (2012) finds beauty falling linearly with complexity; Reinecke (2013) finds low and medium complexity liked about equally and only high complexity penalised. Reinecke et al. themselves describe their result as corresponding to Tuch's, since neither finds a strong inverted U (added at verification).
- **Typicality against originality.** Prototypicality research favours typical designs, while ETHGlobal scores Originality and WOW Factor. Hekkert's MAYA result reconciles them: typicality and novelty help only jointly, so be typical in form and novel in substance (corrected at verification: MAYA is symmetric, and neither factor predicted preference on its own).
- **AI output and prototypicality.** Figl et al. (2025) say AI site builders produce "highly prototypical pages" and could be an advantage. The owner's experience is that AI-built hackathon frontends read as vibecoded. A plausible reconciliation, not tested: they are typical of AI-generated sites, a category juries have learned to discount, rather than of the sponsor's customers' category.
- **The owner's tells against the exemplars.** Ethena uses gradient hero text and a glass nav, Chainlink sets its body text in Inter, Aave, Lido and Stripe use purple-family gradients, and Aave and Stripe put a label above the headline (F19). (corrected at verification: Ethena renders SuisseIntl; Inter is only its declared fallback) NN/g says to avoid purely decorative graphics, yet 8 of the 10 exemplars use abstract art in the hero (F20).
- **Templates.** An ETHDenver 2023 judge (Zainan Zhou) says web templates often beat scratch-built UIs visually (F26), while the owner's tell 11 treats untouched shadcn UI as a slop signal. Both can hold: a template adapted to the category is not an untouched default.
- **Lindgaard 2006, internally.** The Study 1 text reports "The squared Pearson Product Moment correlation coefficient (r) was .97", while the Figure 2 caption gives r² = .94.
- **Miniukovich and Figl 2023.** The SSRN preprint abstract says "29% and 68%"; the published version, as quoted in other records, says "29% to 68%". The study reports 1,530 participants, while the follow-up describes it as "crowdworker evaluation of over 3000 websites" and the dataset counts 3,319 rating sessions. These are different units, not a conflict, but easy to mix up.
- **DoraHacks dates.** The organizers guide shows "Published on 2026/02/14" and lists the judges guide as 2026-05-08; the judges guide also shows 2026/02/14 and lists the organizers guide as 2026-05-08. The Hackathon AI guide shows "Published on 2026/01/22", while both judging guides list it as 2026-02-03 (added at verification).
- **Orma's pair.** DESIGN.md says "pointillé" (dotted or dashed), the spec and CSS say dashed, and the task brief says "naive-dotted". The code (`app.css:738`) is dashed.

## What could not be found, and how it was searched

- **First impressions of crypto sites or hackathon juries.** No study of first impressions or prototypicality on crypto or DeFi websites, or with hackathon juries. Searched Exa and WebSearch for prototypicality with fintech, crypto and trust, and read the works citing Miniukovich and Figl in Figl et al. 2025.
- **Time judges spend on a project's website.** No measurement of how long judges look at the website specifically, as opposed to the video, README or live demo. Searched the official judging pages of ETHGlobal, Devpost, DoraHacks and MLH and five judge posts; only planning numbers exist (F21-F25).
- **Full text of Miniukovich and Figl 2023.** ScienceDirect returned a captcha, SSRN's delivery link returned HTML, and Unpaywall lists only the publisher's copy. The per-category coefficients are unverified. (verification note: Unpaywall and Semantic Scholar mark that publisher copy as open access, hybrid, CC BY; at verification the ScienceDirect page failed through Exa (CRAWL_UNKNOWN_ERROR) and the Elsevier text API link listed by Crossref returned HTTP 400 INVALID_INPUT, so it is still unread.)
- **Lindgaard et al. 2011** (TOCHI; trust and usability judged at 50 ms). Closed access according to Semantic Scholar and Unpaywall. (updated at verification: its abstract, read on the ACM DL and ResearchGate records, and Tuch 2012's Table 1 summary are now used as F31; the full text is still closed.)
- **Reinecke 2013's image-metric code.** The URL given in the paper (iis.seas.harvard.edu/resources) returns 404. AIM is the substitute (F05).
- **Evidence that dashed lines read as "naive" or "estimated".** MacEachren 2012 tested point symbols only. No study of lines found in Exa searches.
- **NN/g's 2010 scrolling article.** Not opened; its 80% figure comes from the 2018 article.
- **Lindgaard 2006.** The typepad copy is gone (Typepad shut down on 2025-09-30), so the makinggood.ac.nz copy was used.
- **Hekkert 2003.** The full text is paywalled; only the PubMed abstract was used.
- **Event-specific judging rules** for TOKEN2049 Origins, Ledger OP3N and the BNB tokenized-stocks hack. Not researched here; that is /hackathon's job per event.

## Weak spots of this dossier

- **Extrapolation.** The academic first-impression studies use passive screenshot viewing by students or crowdworkers on company, bank, shop and university pages. Applying them to technical juries judging crypto projects is an inference.
- **The site captures.** They are one snapshot, taken from a French IP (Stripe served a localised variant) at a single desktop size. Animated or hidden content changes what is visible.
- **The tells probe.** It checks 4 of the 20 tells from computed styles in one viewport, and it records each element's declared first font family rather than the font that rendered (which is how Ethena was first miscounted under tell 4). The purple-family calls on Aave and Stripe are my visual judgement.
- **Evidence strength.** NN/g numbers are vendor research with limited methodological detail, and the judges' accounts are anecdotes (F26 is the only C finding; its ETHDenver account is from 2023). The 5-second test's validity rests on one study (n = 146, one site).
- **Quote fidelity.** Several quotes come from PDF text layers where =, <, dashes and the symbol k are broken glyphs; substitutions are marked. Typographic quotes and apostrophes were normalised in places.
- **Source copies.** The Fogg 2003 full text was read on studylib, not the ACM DL, and Orma's success with judges is the owner's report, not verified.

## Dropped at verification

None. Every cited source resolved and supported at least the core of its finding, so nothing was dropped.

## Verification notes

**Method.** Every finding was checked against its cited sources, opened in this session on 2026-09-30.
- Papers: the eight cited PDFs (Lindgaard 2006, Tuch 2012, Reinecke 2013, Reinecke and Gajos 2014, Liu 2010, Gronier 2016, Gleicher 2011, MacEachren 2012) were downloaded from the cited URLs and read through `pdftotext`. Every quote, sample size, effect size and percentage was compared with the text. The two PMC articles (Figl 2025 and the Data in Brief dataset paper) were read as HTML. The bibliographic details of eleven DOIs were checked on Crossref. The Hekkert 2003 abstract came from the cited PubMed E-utilities URL, and the SSRN abstract came through Exa after a direct request returned 403.
- Web pages: the twelve NN/g articles were read, with authors and dates checked in each page's metadata or byline. The Devpost, MLH, DoraHacks, W3C, Stanford, Perfetti, JetBrains, DEV (through its public API) and TechFlow pages were fetched with curl or Exa and searched for each quote verbatim. For ETHGlobal, that meant the ETHOnline 2026 page plus the in-person New York, Cannes, Tokyo and Lisbon 2026, San Francisco 2024 and New York 2025 pages. The Fogg 2003 studylib copy and the ETHGlobal Singapore 2024 recap were read through Exa.
- Repositories: the `aalto-ui/aim` metadata and module listings through `gh api`, and the `m2_jpeg_file_size.py` docstring through raw.githubusercontent.com.
- Local files: all eleven screenshots were viewed; `fold.json`, `tells.json`, `fold.py` and `tells.py` were read; the JPEG q70 sizes were recomputed with PIL and the hues recomputed by hand; every cited line of the Orma spec, DESIGN.md and app.css was re-read.
- Extra checks to settle doubts:
  - Ethena's stylesheets, to see whether SuisseIntl or Inter renders.
  - Aave's waitlist terms, for the meaning of "Simulated Rate".
  - The in-person ETHGlobal pages, to confirm the video is optional.
  - The Unpaywall and Semantic Scholar records for the two closed or unreachable papers.
  - The Typepad shutdown date: Ars Technica (2025-08-28) and WordPress.com both report the service ended on 2025-09-30.

**What changed, in brief.** Twelve findings were corrected.
- The two attribution errors are the most serious. The JetBrains post is by Katherine Druckman, not Viktor Kiselev. The "undated, anonymous" TechFlow post is signed by Zainan Zhou and dated 2023-03-07.
- Three corrections remove overclaims about studies:
  - Figl 2025 found a buffering interaction, not typical design outweighing the message.
  - The MAYA result is symmetric, and neither typicality nor novelty predicts preference alone.
  - Tuch 2012 finds prototypicality already at 17 ms.
- The rest fix details:
  - Lindgaard 2006: the "only between extremes" wording and the "2006 homepages".
  - The captures: the Aave mockups, Lido's label placement, and Ethena counted under tell 4 for an unrendered fallback font.
  - The rules: the scope of WCAG technique G111, the Devpost "video first" wording, ETHGlobal's in-person screening, and the Morkes and Nielsen condition count.
- Five summary bullets were rewritten to match, and the Contradictions, principles 3, 9 and 12 and the weak spots were updated.
- Two findings were added: F31 (Lindgaard 2011, from its abstract and Tuch's summary) and F32 (NN/g on scroll-triggered text animation, which bears on tell 12).

**Sources that could not be opened.**
- The full text of Miniukovich and Figl 2023. ScienceDirect failed through Exa (CRAWL_UNKNOWN_ERROR), and the Elsevier text API link from Crossref returned HTTP 400. Its per-category coefficients remain unverified.
- The full text of Lindgaard et al. 2011, which is closed access. The ACM DL page returned 403 to curl; its abstract was read through Exa and ResearchGate.
- The full text of Hekkert et al. 2003, which is paywalled; only the abstract was read.
- The ACM DL copy of Fogg et al. 2003. The studylib copy was read instead: it returned 403 to curl but opened through Exa.
- The researcher's original task brief. The claims that the owner reports Orma as a win, and that the brief says "naive-dotted", could therefore not be checked. Neither the Orma README nor the owner's project memory note records a result.

**Residual doubts.**
- The capture-based findings (F05, F17-F20) rest on one snapshot per site, taken from a French IP. I re-read the captures but did not re-capture the sites.
- The purple-family calls on Aave, Lido and Stripe (F19) remain visual judgements. Lido's glows are pink, blue-violet and peach, so "purple family" is a loose label there.
- That Aave's homepage "Simulated Rate" label is a deliberate disclosure is inferred from the waitlist terms, not stated on the homepage.
- F31 rests on an abstract and a secondary table summary. If the full text qualifies the "driven predominantly by appeal" result, F31 should be revisited.
- In quotes taken from PDF text layers and from HTML converted to text, spacing, ligatures and typographic quotes were normalised. The wording was otherwise compared verbatim.
