<!--
template: assets/templates/critique-checklist.md, the binary checklist critique.mjs derives from brief.json for each
critique round (ARCHITECTURE.md section 6) and puts in the critic task file. Each item is answered yes, no or n/a for
one version, and each "no" names a mark id. Binary items, not Likert scales, and pairwise comparison, not absolute
scores, are what measurably helps model judges (FD17-F07, F08). Placeholders: {{path}} is a value of brief.json; a
line holding only {{#each list}} or {{/each}} is dropped from the output and the lines between them repeat once per
item, where {{this.field}} is a field of the item.
Items measure what the page shows; the catalogue of tells (references/11-tells.md) stays with the checker and the
critics, never in a builder's brief.
-->
# Critique checklist: {{project.name}}

Proposition the first view must carry: "{{hero.h1}}" and "{{hero.sentence}}".

## First view (desktop 1440x900, phone 390x844)

| id | item | how it is checked | source |
|---|---|---|---|
| FV1 | The H1 reads exactly "{{hero.h1}}" (about 2-6 words). | mark of data-hero="h1"; text compared by firstview.contract | FD13-F07, FD11 |
| FV2 | One sentence under it names the user, the action and the object: "{{hero.sentence}}". | mark of data-hero="sentence" | FD11, FD15-F16 |
| FV3 | The product itself is visible, ideally its core action running on labelled data, not an illustration of it. | mark of data-surface="product" | FD15-F07 |
| FV4 | One figure is visible with its source or ledger id and its as-of time. | data-metric with data-ledger or data-source and data-as-of | FD13-F10 |
| FV5 | The sponsor is named in text; no third-party logo outside the sponsor allowlist. | text and image marks | FD09 rows 7-8, FD21 |
| FV6 | Nothing a judge needs sits behind hover, a carousel or a scroll-triggered reveal. | marks visible at rest | FD15-F09, FD20 |

## Features (one block per feature of the brief)

| id | item | how it is checked | source |
|---|---|---|---|
{{#each features}}
| F-{{this.id}}.a | A heading names "{{this.title}}" in the user's words. | heading mark inside data-feature="{{this.id}}" | FD17-F07 |
| F-{{this.id}}.b | A concrete artifact is shown: a live widget, a transaction, code or a product capture; an icon does not count. | marks inside the feature root | FD17-F08 |
| F-{{this.id}}.c | Its status label reads {{this.status}} (live, testnet, simulated or planned). | data-status mark | FD13-F09 |
| F-{{this.id}}.d | Its proof is visible: a ledger id, a transaction link or a live value with its as-of time. | data-proof, data-ledger or data-source marks | FD13-F10, FD18 |
{{/each}}

## Hierarchy and economy

| id | item | how it is checked | source |
|---|---|---|---|
| H1 | Blurred, the three most prominent elements are, in order, the headline, the product and the primary action. | blurred tiles at 5, 10 and 20 px | FD17-F18 |
| H2 | One primary action per view; secondary actions look secondary. | button marks | FD15-F20 |
| E1 | Every section maps to a feature or to the problem-and-fix story; no section repeats another. | section marks against the feature list | FD17-F17 |

## Layout and typography

| id | item | how it is checked | source |
|---|---|---|---|
| L1 | Elements that should align share an edge; no near-miss alignment (3-6 px apart). | edges from the marks file | FD17-F20 |
| L2 | Repeated siblings keep equal gaps; section paddings come from a few spacing tokens. | gaps from the marks file | FD17-F21 |
| L3 | Nothing overflows, clips or overlaps at 390 px and 320 px. | render.overflow and render.clipping | FD17-F23 |
| T1 | Body text is at least 16 px, 45-90 characters per line, line height at least 1.5. | type metrics from the marks file | FD17-F22 |
| T2 | No heading ends with a one-word line. | line boxes from the marks file | FD17-F22 |
| T3 | Figures that are compared line up (tabular figures). | type metrics | FD16 |

## Contrast, copy, states and motion

| id | item | how it is checked | source |
|---|---|---|---|
| C1 | Secondary text (captions, small print under buttons, navigation on dark) reads clearly. | contrast values from the marks file | FD17-F17, F23 |
| C2 | Controls and their boundaries stand out from the ground (3:1). | token-pair table, a11y.contrast | FD16, FD17-F24 |
| W1 | Buttons say what happens, in sentence case, and one action keeps one name through the flow. | button text | FD15-F16 |
| W2 | No invented number, praise word or placeholder text is visible. | coverage.metrics, coverage.placeholders | FD10, FD13-F10 |
| S1 | Loading, empty and error states say what is happening and what to do. | state marks | FD18 |
| S2 | A transaction shows its progress and its network; amounts and addresses follow the domain conventions. | transaction marks | FD18 |
| M1 | The page is complete at rest; motion only answers a user action or a real state change. | motion.hidden-at-rest, motion.inventory | FD03, FD15-F09 |
