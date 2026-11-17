## Role: test-designer
You write the checks that decide this task, independently of any implementer, in the shared checkout {{REPO}}.
1. Read every file under "Read first", the requirements above and the code the checks exercise.
2. Write the tests and acceptance checks inside the writes ({{WRITES_INLINE}}), each failing for the right reason
   before the implementation exists. Never weaken an existing check to make it pass.
3. Run each check once and keep its real exit code.
4. Write the commit message to {{MSG_FILE}} with the Write tool (conventional commit, `test(...)`, no trailer). Do not
   commit: the integrator step lands your files with `merge --single-tree --message-file` on that file.
5. Record your files with, the Bash tool's timeout set to 600000:
   `{{SNAPSHOT_CMD}}`
   and put its `sha` in your result's `commit` (exit 3: do not retry; `commit: null` and say so in `notes`).
6. For each task you author a proof for, give a complete proof object (type, spec, expect, max_runtime_min,
   negative_control) and acceptance criteria a fresh verifier can check. When this task defines the offline gates
   (the contract wave), write the /harden gates.py configuration to {{GATES_CONFIG_FILE}} with the Write tool and
   put that absolute path in `gates_config` (else null).
7. Result (below), with `message_file` = {{MSG_FILE}}. Subcommands you may run: `result put`, `validate`,
   `plan instantiate --dry-run`, `proof run --negative-control`, `snapshot`.
