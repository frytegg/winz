<!--
template: assets/templates/direction.md, the notes of one direction, written to <state>/directions/<A|B|C>/notes.md by
FE-03 (ARCHITECTURE.md P2). Placeholders: {{name}} is a value the designer fills; replace every one. The board shows
this file beside the direction's hero comps, so the owner reads it on the phone at H1.
-->
# Direction {{id}}: {{name}}

- Anchor: {{anchor}} (one of: a first customer's conventions, a second unrelated customer's, the protocol's own
  domain, a utilitarian register, the customers' category as the brief names it).
- Concrete reference: {{reference}}. Name one specific object from the users' world (a settlement statement, an order
  ticket, a validator queue), never a list of adjectives: adjectives describe a region, a reference describes a point
  (FD05-F05).

## Token plan

| role | token | value | usage |
|---|---|---|---|
| ground | {{ground.token}} | {{ground.value}} | {{ground.usage}} |
| surface | {{surface.token}} | {{surface.value}} | {{surface.usage}} |
| text | {{text.token}} | {{text.value}} | {{text.usage}} |
| muted text | {{muted.token}} | {{muted.value}} | {{muted.usage}} |
| accent | {{accent.token}} | {{accent.value}} | {{accent.usage}} |
| status | {{status.token}} | {{status.value}} | {{status.usage}} |

4-6 named colours with roles; tokens.json beside this file holds them with their usages.

- Type roles: display {{type.display}}, body {{type.body}}, mono {{type.mono}}; open-licensed faces only, licence
  checked (OFL.txt for a Reserved Font Name before any subset).
- Radius family: {{radius}}. Spacing rhythm: {{spacing}}.
- Motion budget: press 100-160 ms, tooltip 125-200, dropdown 150-250, modal 200-300, ease-out; static at rest
  (FD03). This direction: {{motion}}.
- Signature element: {{signature}}. One, and tied to the product's mechanism (FD15-F08, FD11-F28).

## Layout concept

{{layout}}

Alignment: {{alignment}} (left, centred or justified, and why).

```text
{{wireframe}}
```

An ASCII wireframe of the first viewport at 1440x900: where the H1, the sentence, the product surface, the sourced
figure and the primary action sit (FD15-F08).

## Principles

{{principles}}

Two to four principles that make this direction this project's and no other's.

## Hero comp

- hero.html with the brief's real copy (brief.hero.h1 and brief.hero.sentence) and the product itself visible.
- hero-desktop.png at 1440x900 and hero-mobile.png at 390x844, rendered by board.mjs.

## Rationale and trade-off

- Why this direction fits the brief: {{rationale}}
- What it costs: {{trade_off}}

Every option gets its honest case and its main trade-off, at the same length as the others; a board where only one
option is argued is a rigged vote (FD15-F19).

## Screen results

{{screen_results}}

The checker on the hero comp, the similar-prompt test below and the past-directions ledger; a direction that fails is
redrawn or dropped, never shown to the owner.

## Similar-prompt test

| token | this direction | generic plan | identical | change made |
|---|---|---|---|---|
| {{token}} | {{value}} | {{generic_value}} | {{identical}} | {{change}} |

A token identical to the plan drawn from the generic brief came from the model's prior, not from this project: change
it and say why (FD15-F08).

## Not borrowed

{{not_borrowed}}

What the anchor's sources show that this direction leaves behind: their pixels, logos, copy, imagery, licensed fonts,
exact brand hexes and section sequences.
