<!--
template: assets/templates/brief.md, the human view of brief.json (scripts/CONTRACTS.md 6.4), rendered by brief.mjs
(FE-00). Placeholders: {{path}} is the value at that path of brief.json; a line holding only {{#each list}} or
{{/each}} is dropped from the output and the lines between them repeat once per item, where {{this.field}} is a field
of the item and {{this}} the item itself. An empty value renders as "missing". Every value stands next to its source
path; a field without a source is listed under "Missing inputs", never guessed.
-->
# Frontend brief: {{project.name}}

Name status: {{project.name_status}} (source: {{project.source}})

## The two sentences

- What is broken: {{sentences.broken}}
- What we did: {{sentences.did}}
- Source: {{sentences.source}}

## First view

- H1: {{hero.h1}}
- Sentence: {{hero.sentence}}
- Source: {{hero.source}}

The first viewport shows exactly these words (coverage.hero and firstview.contract compare them), with the product
itself and one sourced figure.

## The gap

- {{gap.text}}
- Who loses: {{gap.who_loses}}
- How much: {{gap.how_much}}
- Source: {{gap.source}}

## Sponsors

| id | name | strategy | source |
|---|---|---|---|
{{#each sponsors}}
| {{this.id}} | {{this.name}} | {{this.strategy}} | {{this.source}} |
{{/each}}

## Customers

| name | category | official URL | where the URL came from | owner confirmed |
|---|---|---|---|---|
{{#each customers}}
| {{this.name}} | {{this.category}} | {{this.url}} | {{this.url_source}} | {{this.owner_confirmed}} |
{{/each}}

A URL is a proposal until the owner confirms it in FE-01: none of the workspaces surveyed recorded one (FD13-F06).
Customers are named in plain text only; their pages give conventions and measured relationships, never expression.

## Use case

{{use_case.text}}

Source: {{use_case.source}}

## Features

| id | group | title | status | route | proof | source |
|---|---|---|---|---|---|---|
{{#each features}}
| {{this.id}} | {{this.group}} | {{this.title}} | {{this.status}} | {{this.route}} | {{this.proof}} | {{this.source}} |
{{/each}}

Every feature gets a surface marked data-feature with its status label and its proof.

## Claims

- Ledger: {{claims.path}}
- Claim ids the UI may render: {{claims.ids}}

A number with no verified ledger row renders as "not yet verified", never as a figure.

## Never-show

| class | until (UTC) | source |
|---|---|---|
{{#each never_show}}
| {{this.class}} | {{this.until_utc}} | {{this.source}} |
{{/each}}

The patterns stay in brief.json and the never-show file; this view does not repeat them. An entry past its until date
is inactive. Nothing is deployed or published before the never-show scan of the rendered text passes.

## Judge's path

{{#each judge_path.beats}}
1. {{this}}
{{/each}}

Source: {{judge_path.source}}

## Missing inputs

| field | action | why |
|---|---|---|
{{#each missing}}
| {{this.field}} | {{this.action}} | {{this.why}} |
{{/each}}

In mode A each row is a manual task in /execution's plan; in mode B, a question to the owner.
