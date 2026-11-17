# Direction A: Settlement statement

- Anchor: customer-a (the conventions of the first customer in the pattern ledger)
- Concrete reference: a custody bank's monthly settlement statement, with one row per withdrawal.

## Token plan

| role | token | value | usage |
|---|---|---|---|
| ground | ground | #ffffff | page background |
| text | text | #14202b | body text and headings |

- Type roles: display Fixture Grotesk, body Fixture Grotesk.
- Signature element: a settlement row that prints the promised date beside the date the chain gives.

## Layout concept

Two columns: the proposition and the key figure on the left, the statement on the right.

## Rationale and trade-off

- Why this direction fits the brief: treasury teams already read statements, so the queue reads as one.
- What it costs: a statement looks quiet on stage; the figure has to carry the first view.

## Similar-prompt test

| token | this direction | generic plan | identical | change made |
|---|---|---|---|---|
| accent | #0b5fa5 | #6d28d9 | no | none needed |
