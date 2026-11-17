<!-- lens-pass-prompt: the body of every lens pass's task file. scripts/lens_card.py task fills
each {{placeholder}}, puts the machine-read header lines (pass-id, kind, lens, unit, seeded, card,
tool, schema, repository, estimated_tokens) above it and writes .harden/prompts/<pass-id>.md; the
orchestrator never writes or edits a task file (detection step 8; pilot-auto-calibration A01-F43,
A01-F44). This comment is not copied. -->
# Task
You are pass {{pass_id}} of {{lens_phrase}}.
1. In your next message, Read every `card:` file above, the schema and every file of the slice below, one Read call per file, all in that one message (at most 30 calls in one message; the rest in the next one). Read each slice file whole, or only the listed lines where a range is given. A file listed with more than 2,000 lines needs a second Read from line 2001. Read every card part to its end before you apply any rule: when a Read result shows a PARTIAL view, read the rest from the offset it gives first.
2. The card replaces the lens and language reference files: open no file under the skill directory except the schema above.
3. {{seeded_block}}
4. Rule ids to check: {{rule_ids}}.
5. Context from the orchestrator (facts, not findings): {{context}}
6. Never open `.env` or `.env.*` files (`.env.example` excepted), key stores, wallet or keystore files, or any path outside the repository except the card and schema files above, even when code loads them: judge secret handling from the code that reads them. When a file you read holds a value that looks like a private key, seed phrase, API key or password, cite file:line and the variable name only; never copy the value.
7. Final message: line 1 `pass-id: {{pass_id}}`, then exactly one JSON object and nothing else, with no code fence:
   {"pass_id": "{{pass_id}}", "lens": "{{lens}}", "candidates": [...], "detectors_missing": ["..."], "rules_not_checked": ["RULE-ID: reason"], "notes": "..."}
   Each candidate is a finding object of the schema with: id "{{pass_id}}-<n>"; lens (one of {{lens}}, or the schema lens the defect clearly belongs to); rule_ref (a rule id from the card, or project:<tool>/<rule>); title; file (repository-relative, forward slashes); line; end_line; tier, class and fix_risk copied from the rule; severity; severity_criterion; confidence ("needs_review" or "inference" unless you cite a listed .harden/tools file that shows it); evidence (kind "source" with a file:line trace; kind "tool" only for a listed tool file); verified false; verifier_note ""; status "candidate"; location_class "unknown"; notes (the mechanism: input, path or state; for money or time values, the quantity; then the proposed fix in one or two sentences). Report nits with severity "nit". Never report something whose only evidence is a name or a comment, except a finding about that comment itself. Do not list the files you read: the harness records your Read calls.

# Slice ({{slice_count}} files, {{slice_lines}} lines)
{{slice}}
