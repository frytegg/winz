<!--
template: assets/templates/pattern-ledger.md, the human view of pattern-ledger.json (scripts/CONTRACTS.md 6.5), written
by extract.mjs (FE-02). Placeholders: {{path}} is the value at that path of pattern-ledger.json; a line holding only
{{#each list}} or {{/each}} is dropped from the output and the lines between them repeat once per item, where
{{this.field}} is a field of the item and {{this}} the item itself.
-->
# Pattern ledger

Ideas, not expression. This ledger carries conventions, measured relationships, domain conventions and measured facts
drawn from the reference pages, each pattern from at least two unrelated references unless it is a single fact
(ARCHITECTURE.md P1). It never carries pixels, logos, names beyond plain text, copy, imagery, licensed font files,
exact brand hexes or one site's full section sequence (FD09 policy rows 4-6, 12, 16, 17 and 19).

## References

| id | customer | url | page | captured at (UTC) | viewports | receipt | purged |
|---|---|---|---|---|---|---|---|
{{#each references}}
| {{this.id}} | {{this.customer}} | {{this.url}} | {{this.page}} | {{this.captured_at}} | {{this.viewports}} | {{this.receipt}} | {{this.purged}} |
{{/each}}

Captures were made through capture-gate.mjs (robots.txt honoured, no workaround after a block), kept outside any git
work tree with a SHA-256 manifest, and purged once this ledger was written; "purged" points at the deletion receipt.

## Patterns

| id | kind | statement | values | from | not borrowed |
|---|---|---|---|---|---|
{{#each patterns}}
| {{this.id}} | {{this.kind}} | {{this.statement}} | {{this.values}} | {{this.from}} | {{this.not_borrowed}} |
{{/each}}

Kinds: convention (nav, number of calls to action, figures row, density, section order types), relationship
(type-scale ratio, spacing rhythm, radius family, neutral ramp depth, accent count, light or dark ground), domain (how
amounts, addresses and transactions are shown), fact (one measured value).

## Excluded

{{#each excluded}}
- {{this}}
{{/each}}

What was observed and deliberately not carried, with the reason.
