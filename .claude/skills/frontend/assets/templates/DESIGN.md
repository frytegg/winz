---
name: "{{name}}"
colors:
{{#each colors}}
  {{this.name}}: "{{this.value}}"
{{/each}}
typography:
{{#each typography}}
  {{this.name}}:
    fontFamily: "{{this.fontFamily}}"
    fontSize: {{this.fontSize}}
    fontWeight: {{this.fontWeight}}
    lineHeight: {{this.lineHeight}}
    letterSpacing: {{this.letterSpacing}}
{{/each}}
rounded:
{{#each radius}}
  {{this.name}}: {{this.value}}
{{/each}}
spacing:
{{#each spacing}}
  {{this.name}}: {{this.value}}
{{/each}}
components:
{{#each components}}
  {{this.name}}:
    backgroundColor: "{{this.backgroundColor}}"
    textColor: "{{this.textColor}}"
    typography: "{{this.typography}}"
    rounded: "{{this.rounded}}"
    padding: {{this.padding}}
{{/each}}
---
<!--
DESIGN.md skeleton (assets/templates/DESIGN.md). tokens.mjs renders it from <design>/tokens.json: DESIGN.md is a
generated view, never edited by hand, never a source (scripts/CONTRACTS.md 6.2). Format: Google's DESIGN.md, version
alpha (YAML front matter of tokens, then the sections in the spec's order), plus a Motion section the spec leaves open
(FD05-F03). Rendering rules:
- colors: one entry per colour token with its value in the first theme of color.themes, plus primary, the token whose
  usage is the primary action (the official linter warns when primary or typography is missing, FD05-F14).
- typography: every style of every type group, named <group>-<style>, with ONE family per fontFamily and no stack:
  the official export quotes a whole stack into one family name that does not exist (FD05-F15).
- rounded and spacing: the radius and spacing tokens; components: the button, input and card tokens derived from the
  roles when the direction defines them, as {colors.<token>} references; omit the key when there are none.
- the Overview names the concrete reference of the direction, never a list of adjectives (FD05-F05).
Placeholders: {{path}} is a value. A line holding only {{#each list}} or {{/each}} is dropped from the output and the
lines between them repeat once per item, where {{this.field}} is a field of the item and {{this}} the item itself; a
block inside one line repeats its inline text.
-->

# {{name}}

## Overview

{{meta.direction}}. {{meta.rationale}}

Sources: {{meta.sources}}

## Colors

| token | {{#each themes}}{{this.name}} | {{/each}}usage |
|---|{{#each themes}}---|{{/each}}---|
{{#each color.tokens}}
| {{this.name}} | {{#each this.values}}{{this}} | {{/each}}{{this.usage}} |
{{/each}}

Text pairs meet 4.5:1 (3:1 for large text and for UI component boundaries); the token-pair table tokens.mjs writes
is the evidence, because axe cannot see non-text contrast, gradients or image grounds (FD16).

## Typography

| style | family | size | line height | weight | letter spacing |
|---|---|---|---|---|---|
{{#each typography}}
| {{this.name}} | {{this.fontFamily}} | {{this.fontSize}} | {{this.lineHeight}} | {{this.fontWeight}} | {{this.letterSpacing}} |
{{/each}}

Families: display {{type.families.display}}, body {{type.families.body}}, mono {{type.families.mono}}. Fonts are
open-licensed and self-hosted with their licence files; faces that show numbers use tabular figures.

## Layout

| spacing token | value | usage |
|---|---|---|
{{#each spacing}}
| {{this.name}} | {{this.value}} | {{this.usage}} |
{{/each}}

## Elevation & Depth

| shadow token | value | usage |
|---|---|---|
{{#each shadow}}
| {{this.name}} | {{this.value}} | {{this.usage}} |
{{/each}}

## Shapes

| radius token | value | usage |
|---|---|---|
{{#each radius}}
| {{this.name}} | {{this.value}} | {{this.usage}} |
{{/each}}

## Components

{{#each components}}
- {{this.name}}: background {{this.backgroundColor}}, text {{this.textColor}}, type {{this.typography}}, radius {{this.rounded}}, padding {{this.padding}}
{{/each}}

## Motion

| motion token | value | usage |
|---|---|---|
{{#each motion}}
| {{this.name}} | {{this.value}} | {{this.usage}} |
{{/each}}

Motion answers a user action or a real state change and nothing else; the page is complete at rest. Ease-out curves,
transitions rather than keyframes, no bounce; press 100-160 ms, tooltip 125-200, dropdown 150-250, modal 200-300;
under reduced motion, gentler rather than off, and no content hidden at rest (FD03).

## Do's and Don'ts

{{#each dos_and_donts}}
- {{this}}
{{/each}}

Short and intentional, tied to this direction's reference; a long list of don'ts is a sign the reference is too vague
(FD05-F05).
