# Database schema, query and cross-layer constraint hygiene in a finished application
> Code G209 · slug data-layer-hygiene · verified 2026-09-23 · counts: verified 12 / corrected 10 / downgraded 0 / dropped 0

## Summary

Versions checked on 2026-09-23:
- PostgreSQL 18 docs (18.6 released 2026-08-13).
- SQLite current docs; claims also re-run locally on SQLite 3.45.3.
- MySQL 8.4 reference manual.
- Redis docs (8.x era; the page mentions 8.6 LRM policies and 8.10 BACKUP).
- SQLAlchemy 2.0.54, Alembic 1.20.0.
- Django: the 5.2 LTS docs. Django 6.1.1 is the current release on PyPI, so re-check the Django claims against 6.x before relying on them.
- Rails guides 8.1.3.1, Python 3.14.7 `sqlite3`.
- Prisma: the v7 docs, plus the v8 error reference, which is already live. npm's `latest` tag points to 8.0.0-rc.15.
- Drizzle: drizzle-orm 0.45.3 is stable and 1.0.0-rc is in progress. The Drizzle zod docs now describe the `drizzle-orm/zod` path for v1; the separate `drizzle-zod` 0.8.3 package serves stable 0.x.
- node-postgres (`pg` 8.23.0), squawk 2.66.0, schemalint 2.3.2, sqlfluff 4.3.0, PgHero 4.0.1, Atlas (migrate lint is Pro-only since v0.38).

**Main result.** The strongest evidence is about constraints that disagree across layers.

Yang et al. (ICSE 2020) studied 12 Rails apps. They found:
- 24% of application constraints are missing in the DB;
- 1000+ string fields have a DB length limit the app does not check;
- 200+ fields are required by the app but nullable by default in the DB;
- 88 fields are unique only in the app;
- 57 inclusion/exclusion rules exist only in the app;
- 133 length or numeric limits conflict between the app and the DB.

49 of the 56 problems they reported were confirmed. The same paper notes that developers catch DB constraint exceptions in only 4 cases across thousands of model saves.

Of 114 real issues:
- "What" (a constraint that does not match how the data is used) was 51%;
- "Where" (a constraint that disagrees between layers) was 21%;
- "How" (missing or unclear error messages) was 18%;
- "When" (a change between versions) was 10%.

Other studies agree:
- CFinder (ASPLOS 2023) found 210 missing constraints in 8 web apps. 75 of the 92 reported were confirmed; precision was 78% and recall 79%.
- A TOSEM 2024 study of 423 Java DB-access bugs found that 22.5% are schema bugs. Constraint violations are the largest share of those (48.4%).
- Smelly Relations (ICSE-SEIP 2018, 2,925 systems) found that index abuse is the most common schema smell and that using an ORM does not prevent smells. 77% of surveyed developers rated missing FK constraints as a smell.
- SQL query smells such as SELECT * are common, but their association with bugs is not statistically significant (Muse et al., MSR 2020, 150 Java projects). Treat them as a low priority.

**Detection** is mostly done with tools:
- database_consistency and active_record_doctor for Rails;
- catalog queries for Postgres and SQLite;
- squawk and schemalint for Postgres;
- sqlfluff and sqlcheck for SQL;
- PgHero-style statistics.

**Drift gates for CI:** `alembic check`, `makemigrations --check`, `migrate --check`, `prisma migrate diff --exit-code` (the v7 flags differ from v6) and `sqlc vet`. `drizzle-kit check` only checks that the migration history is consistent. `atlas migrate lint` needs Atlas Pro since v0.38.

**Runtime settings are documented but off by default:**
- Postgres: statement_timeout, lock_timeout, idle_in_transaction_session_timeout and transaction_timeout (new in PG17) all default to 0, which disables them.
- node-postgres sets no client timeouts by default.
- SQLite: FK enforcement is off and must be enabled on each connection. Typing is flexible, and non-INTEGER primary keys accept NULL.
- Redis has no maxmemory limit on 64-bit systems. Its volatile-* policies behave like noeviction when no key has a TTL.

**Classifying fixes is the key safety point.**
- **Apply automatically** only changes that do not alter runtime semantics: CI gates, linters, integrity-error handlers, and app validators that exactly mirror an existing DB constraint.
- **Propose as a human-approved migration:** FKs, indexes, NOT NULL, unique and CHECK constraints, server defaults, and timestamptz conversion. These can fail on existing data (Atlas MF101–MF104) or need NOT VALID/VALIDATE or CONCURRENTLY. PG18 also allows NOT VALID on not-null constraints.
- **Report only:** dropping indexes, EAV or polymorphic redesign, pagination contracts, timeouts, pool sizes, Redis persistence and MySQL strict mode.

## Findings

### G209-F01 — Compare every persisted field's constraints across DB DDL, ORM model, request validators and front-end checks; derive layers from one source of truth instead of copying numbers
- **Grade:** A · **Verdict:** CORRECTED. Changes:
  - The EMSE citation is fixed. The authors are Florez, Moreno, Zhang, Wei and Marcus, in EMSE 2022, DOI 10.1007/s10664-022-10175-w. It now counts only as indirect support: it measures duplicated constraint code inside Java systems, not drift between app and DB.
  - The drizzle-zod note is updated for drizzle-orm v1: the docs now show `drizzle-orm/zod`.
  - The SQLModel evidence is upgraded to the maintainer's statement.
- **Rationale:** Yang et al. (12 Rails apps) found:
  - 24% of application constraints are missing in the DB;
  - 1000+ string fields have a DB length limit the app does not check;
  - 200+ fields are required by the app but nullable by default in the DB;
  - 88 fields are unique only in the app;
  - 57 inclusion/exclusion rules exist only in the app;
  - 133 length or numeric limits conflict between the app and the DB.

  49 of the 56 reported problems were confirmed. The paper says a value that passes every check except the DB's "often leads to a web-page crash".

  Redmine example: the HTML used `.+`, the model allowed 60 characters, and the column was varchar(30). A title a little under 60 characters "crashed with all the filled content lost".

  CFinder independently found 210 missing constraints in 8 web apps (75 of 92 reported were confirmed). The EMSE Java study found that "almost half" of data constraints have several enforcing statements that are code clones. This is indirect support for deriving the layers from one source.
- **Evidence:**
  - [Managing data constraints in database-backed web applications](https://hyperloop-rails.github.io/278.pdf) — Yang, Sethi, Yan, Cheung, Lu, ICSE 2020 (DOI 10.1145/3377811.3380375) — peer_reviewed — Table 1: "24% of application constraints are missing in DB"; "1000+ string fields have length constraints in DB but not in app."; "200+ fields forbidden to be null in app. but null by default in DB"; "88 fields required to be unique in app. but not so in DB"; "133 conflicting length/numericality constraints between app. and DB"; "reported 56 ... received 49 confirmation" — verified in the PDF text.
  - [Protecting Data Integrity of Web Applications with Database Constraints Inferred from Application Code](https://api.semanticscholar.org/graph/v1/paper/DOI:10.1145/3575693.3575699?fields=title,abstract,authors,year,openAccessPdf) — Huang, Shen, Zhong, Zhou, ASPLOS 2023 — peer_reviewed — "our tool identifies 210 previously unknown missing constraints. We have reported 92 of them ... so far 75 are confirmed" (precision 78%, recall 79%) — abstract verified.
  - [An empirical study of data constraint implementations in Java](https://arxiv.org/abs/2107.04720) — Florez, Moreno, Zhang, Wei, Marcus, Empirical Software Engineering 2022 — peer_reviewed — "almost half of these data constraints have multiple enforcing statements, which are code clones of different types" — abstract verified. The venue was confirmed via Crossref. This is indirect support: 187 constraints in 8 Java systems, with no DB-versus-app comparison.
  - [database_consistency README](https://github.com/djezzzl/database_consistency) — djezzzl — tool docs — "help you avoid various issues due to inconsistencies and inefficiencies between a database schema and application models"; checkers include LengthConstraintChecker, NullConstraintChecker, MissingUniqueIndexChecker, ForeignKeyChecker and CaseSensitiveUniqueValidationChecker — verified.
  - [Drizzle ORM: zod](https://orm.drizzle.team/docs/zod) — Drizzle Team, 2026 — official_docs — createInsertSchema "Defines the shape of data to be inserted into the database - can be used to validate API requests"; `pg.varchar({ length: ... })` maps to `z.string().max(length)` — verified. The page now installs `drizzle-orm@rc` and imports from `drizzle-orm/zod`. The standalone `drizzle-zod` 0.8.3 (npm, not deprecated) serves stable drizzle-orm 0.45.x.
  - [SQLModel issue #52](https://github.com/fastapi/sqlmodel/issues/52) — fastapi/sqlmodel, 2021–2025 — practitioner_forum + maintainer — maintainer tiangolo (2022-11-11): "The model with `table=True` can't do validation on instantiation, because SQLAlchemy needs to be able so assign values after instantiation" — verified via the GitHub API comments.
- **Detect:**
  - Rails: run `bundle exec database_consistency`, plus the active_record_doctor detectors `incorrect_length_validation`, `missing_non_null_constraint`, `missing_presence_validation` and `missing_unique_indexes`.
  - Postgres: dump the columns with `SELECT table_name,column_name,is_nullable,character_maximum_length,column_default FROM information_schema.columns WHERE table_schema NOT IN ('pg_catalog','information_schema');` and the constraints with `SELECT conrelid::regclass, conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE contype IN ('c','u','f');`.
  - Diff those against validators found by grep:
    - pydantic: `max_length=|constr[(]|Optional[[]`;
    - zod: `[.]max[(]|[.]min[(]|[.]optional[(]|[.]nullable[(]`;
    - OpenAPI: `maxLength|required:`;
    - HTML: `maxlength=|pattern=|required`.
  - Drizzle: diff the hand-written zod schemas against `createInsertSchema(table)`.
  - SQLModel: flag code that expects validation on `table=True` models.
- **Tools:** database_consistency, active_record_doctor, drizzle-zod / `drizzle-orm/zod`, psql catalog queries, ripgrep.
- **Applies to:** Any DB-backed web app or API (Postgres, MySQL, SQLite): Rails, Django, SQLAlchemy/SQLModel+pydantic, Prisma/Drizzle+zod, OpenAPI-first services.
- **When not to apply / counterpoints:**
  - Some app checks are UX policy (password strength) and need no DB twin.
  - The PostgreSQL wiki advises against *arbitrary* varchar(n), so "aligning" may mean relaxing the DB rather than copying lengths.
  - The empirical base is Rails (Yang) and web/e-commerce apps (CFinder). No equivalent measurement exists for Python or TypeScript stacks.
- **Fix risk:** medium

### G209-F02 — Back every uniqueness or "at most one" invariant with a DB UNIQUE constraint or (partial) unique index, and catch 23505 on the write path
- **Grade:** A · **Verdict:** VERIFIED
- **Rationale:** Rails states that the uniqueness validator does not create a DB constraint, so two connections can insert duplicates. active_record_doctor and thoughtbot say the same. Yang found 88 fields unique only in the app. They also found 19 fields that are unique case-insensitively but used case-sensitively by the app, which Yang classes as a "What" problem. PostgreSQL documents that rows containing NULL can be stored as duplicates despite a unique constraint, unless the constraint uses NULLS NOT DISTINCT. This finding is the static-review side of T29 (ACIDRain).
- **Evidence:**
  - [Active Record Validations](https://guides.rubyonrails.org/active_record_validations.html) — Ruby on Rails guides 8.1.3.1, 2026 — official_docs — the validator "does not create a uniqueness constraint in the database, so a scenario can occur whereby two different database connections create two records with the same value ... you must create a unique index on that column in your database" — verified.
  - [The Perils of Uniqueness Validations](https://thoughtbot.com/blog/the-perils-of-uniqueness-validations) — Derek Prior, thoughtbot, 2013 (updated 2025-01-10) — engineering_blog — "The second save operation will generate an ActiveRecord::RecordNotUnique exception"; has_one also needs a unique index — verified.
  - [active_record_doctor README](https://github.com/gregnavis/active_record_doctor) — Greg Navis — tool docs — missing_unique_indexes: "validating uniqueness in the model without an index can lead to duplicates" — verified.
  - [PostgreSQL 18: Constraints](https://www.postgresql.org/docs/current/ddl-constraints.html) — PGDG, 2026 — official_docs — "even in the presence of a unique constraint it is possible to store duplicate rows that contain a null value ... This behavior can be changed by adding the clause NULLS NOT DISTINCT" — verified.
  - [Yang et al. ICSE 2020](https://hyperloop-rails.github.io/278.pdf) — peer_reviewed — "88 fields required to be unique in app. but not so in DB"; "19 incorrect case-sensitivity constraints identified" — verified.
- **Detect:**
  - grep for `validates .*uniqueness|validates_uniqueness_of|UniqueValidator`.
  - grep for Prisma `findFirst[(]` followed by `create[(]`, and Django `[.]exists[(][)]` followed by `[.]create[(]`.
  - Postgres: list unique indexes with `SELECT indexrelid::regclass FROM pg_index WHERE indisunique AND indrelid='tbl'::regclass;`, then count existing duplicates with `SELECT col, count(*) FROM tbl GROUP BY col HAVING count(*)>1;`.
  - Rails tools: active_record_doctor missing_unique_indexes; database_consistency MissingUniqueIndexChecker, UniqueIndexChecker and CaseSensitiveUniqueValidationChecker.
  - Add an integration test that fires two concurrent inserts.
- **Tools:** active_record_doctor, database_consistency, psql, ripgrep.
- **Applies to:** Emails, usernames, idempotency keys, one-per-user rows, order and trade IDs (Postgres, MySQL, SQLite).
- **When not to apply / counterpoints:**
  - On sharded MySQL/Vitess, a per-shard unique index cannot enforce global uniqueness.
  - Soft-delete tables need a partial index (`WHERE deleted_at IS NULL`).
  - Case-insensitive uniqueness needs a `lower()` or citext index.
  - Adding the index fails if duplicates already exist (see F22).
- **Fix risk:** high

### G209-F13 — List every invariant in save(), validators, signals and callbacks, then find the bulk and low-level write paths that bypass them
- **Grade:** A · **Verdict:** CORRECTED. Changes:
  - The Django update() quote is now verbatim.
  - "More than 20 methods" is corrected to 20 entries: 19 methods plus `save(validate: false)`.
- **Rationale:**
  - Django's `update()` works "at the SQL level and, thus, does not call any save() methods on your models, nor does it emit the pre_save or post_save signals".
  - With `bulk_create`, "The model's save() method will not be called, and the pre_save and post_save signals will not be sent".
  - `full_clean()` is not called by `save()`.
  - Rails lists 20 validation-skipping entries.

  So an invariant that lives only in these hooks can be broken by an ordinary bulk operation or an admin script.
- **Evidence:**
  - [Django 5.2 QuerySet API reference](https://docs.djangoproject.com/en/5.2/ref/models/querysets/) — DSF — official_docs — update() "does an update at the SQL level and, thus, does not call any save() methods on your models, nor does it emit the pre_save or post_save signals"; bulk_create: "The model's save() method will not be called, and the pre_save and post_save signals will not be sent." — verified. Django 6.1 is current; 5.2 is the LTS.
  - [Django 5.2 Model instance reference](https://docs.djangoproject.com/en/5.2/ref/models/instances/) — DSF — official_docs — "Note that full_clean() will not be called automatically when you call your model's save() method." — verified.
  - [Django 5.2 Database access optimization](https://docs.djangoproject.com/en/5.2/topics/db/optimization/) — DSF — official_docs — "these bulk update methods cannot call the save() or delete() methods of individual instances, which means that any custom behavior you have added for these methods will not be executed" — verified.
  - [Active Record Validations](https://guides.rubyonrails.org/active_record_validations.html) — Rails 8.1 — official_docs — skip list: decrement!, decrement_counter, increment!, increment_counter, insert, insert!, insert_all, insert_all!, toggle!, touch, touch_all, update_all, update_attribute, update_attribute!, update_column, update_columns, update_counters, upsert, upsert_all, save(validate: false) — verified (20 entries).
  - [SQLModel issue #52](https://github.com/fastapi/sqlmodel/issues/52) — maintainer comment — `table=True` models do not validate on instantiation — verified.
- **Detect:**
  - First find the models that carry invariants:
    - Django: `def save[(]|def clean[(]|@receiver[(](pre|post)_save`;
    - Rails: `validates|before_save|after_commit`.
  - Then grep for bulk paths on the same models:
    - `[.]update[(]` on querysets, `bulk_create[(]|bulk_update[(]`;
    - `update_all|update_columns?|insert_all|upsert_all|validate: false`;
    - raw UPDATE or INSERT passed to `execute[(]`.
  - Check whether each invariant has a DB counterpart in pg_constraint (F01).
- **Tools:** ripgrep, psql.
- **Applies to:** Django, Rails, SQLAlchemy (Core bulk operations skip ORM events), SQLModel, any ORM with lifecycle hooks.
- **When not to apply / counterpoints:** Bulk paths exist for performance. Switching them to per-row saves changes cost and fires side effects such as emails and signals. The preferred fix is a DB constraint, which is a migration.
- **Fix risk:** high

### G209-F04 — In PostgreSQL and SQLite, make each FK's referencing columns the leading columns of some index (MySQL/InnoDB creates it automatically, and so does Django by default)
- **Grade:** A · **Verdict:** VERIFIED
- **Rationale:**
  - PostgreSQL: deleting or updating a parent row "will require a scan of the referencing table", and an FK "does not automatically create an index".
  - SQLite: without the index, deletes are "forced to do a linear scan of the entire child table".
  - Cybertec measured a DELETE at 154.030 ms without the index versus 0.751 ms with it, and a JOIN at 360.982 ms versus 0.147 ms.
  - GitLab reports production incidents from missing FK indexes.
- **Evidence:**
  - [PostgreSQL 18: Constraints](https://www.postgresql.org/docs/current/ddl-constraints.html) — PGDG — official_docs — "a DELETE of a row from the referenced table or an UPDATE of a referenced column will require a scan of the referencing table ... it is often a good idea to index the referencing columns too ... the declaration of a foreign key constraint does not automatically create an index on the referencing columns" — verified.
  - [SQLite Foreign Key Support](https://www.sqlite.org/foreignkeys.html) — SQLite — official_docs — "Indices are not required for child key columns but they are almost always beneficial"; "forced to do a linear scan of the entire child table" — verified.
  - [Index your foreign key](https://www.cybertec-postgresql.com/en/index-your-foreign-key/) — Laurenz Albe, CYBERTEC, Oct 2018 — engineering_blog — DELETE 154.030 ms vs 0.751 ms; JOIN 360.982 ms vs 0.147 ms; publishes a query for missing FK indexes; "create all missing indexes, wait a couple of days and then get rid of the indexes that were never used" — verified.
  - [GitLab: Foreign keys and associations](https://docs.gitlab.com/development/database/foreign_keys/) — GitLab, 2026 — official_docs (engineering handbook) — "Without an index on the foreign key, it forces PostgreSQL to do a full table scan every time a record is deleted from the referenced table. In the past this has led to incidents where deleting projects and namespaces times out." — verified.
  - [MySQL 8.4: FOREIGN KEY Constraints](https://dev.mysql.com/doc/refman/8.4/en/create-table-foreign-keys.html) — Oracle — official_docs — "Such an index is created on the referencing table automatically if it does not exist." — verified.
  - [Django 5.2 model field reference](https://docs.djangoproject.com/en/5.2/ref/models/fields/) — DSF — official_docs — "A database index is automatically created on the ForeignKey. You can disable this by setting db_index to False." — verified.
  - [schemalint built-in rules](https://github.com/kristiandupont/schemalint/blob/main/src/rules/README.md) — Kristian Dupont — tool docs — rule `index-referencing-column` — verified in src/rules/README.md. The top-level README does not list it. The repo is active (pushed 2026-09-15) and supports Postgres only.
- **Detect:**
  - Postgres (a query written for this dossier; it was not executed during verification, and Cybertec's published query is the vetted alternative):

    ```sql
    SELECT c.conrelid::regclass AS tbl, c.conname
    FROM pg_constraint c
    WHERE c.contype = 'f'
      AND NOT EXISTS (
        SELECT 1 FROM pg_index i
        WHERE i.indrelid = c.conrelid
          AND (string_to_array(i.indkey::text, ' ')::int2[])[1:cardinality(c.conkey)] @> c.conkey
      );
    ```

  - SQLite: compare `PRAGMA foreign_key_list(t)` with `PRAGMA index_list(t)` and `PRAGMA index_info(idx)`. The sqlite3 CLI's `.lint OPTIONS` command "Report[s] potential schema issues"; check `.help lint` for the fkey-indexes option.
  - Tools: schemalint index-referencing-column; active_record_doctor unindexed_foreign_keys; database_consistency MissingIndexChecker; the Prisma validation warning under relationMode="prisma".
- **Tools:** psql, sqlite3 CLI, schemalint, active_record_doctor, database_consistency, prisma validate.
- **Applies to:** PostgreSQL and SQLite (not needed on MySQL/InnoDB). Especially parent tables that get deleted, cascades, and join-heavy endpoints.
- **When not to apply / counterpoints:**
  - Django allows skipping the index "if you are creating a foreign key for consistency rather than joins".
  - Cybertec says small tables, and relations never used for joins or parent-key changes, can skip it.
  - Every index adds write cost.
- **Fix risk:** low

### G209-F08 — SQLite: enable `PRAGMA foreign_keys=ON` on every connection, outside any transaction; audit with foreign_key_check (not integrity_check); add NOT NULL to non-INTEGER PKs; prefer STRICT tables for new tables
- **Grade:** A · **Verdict:** VERIFIED. The behaviour was also reproduced locally on SQLite 3.45.3:
  - `foreign_keys` defaults to 0;
  - setting it inside BEGIN is a no-op;
  - two NULLs were stored in a TEXT PRIMARY KEY;
  - 'wxyz' was stored as TEXT in an INTEGER column;
  - a STRICT table raised IntegrityError.
- **Rationale:** Enforcement is off by default and must be enabled on each connection. The pragma is a no-op inside a transaction. Types are advisory. Because of an "historical oversight", PRIMARY KEY columns can hold NULL (except INTEGER PRIMARY KEY). STRICT tables (3.37.0+) reject values that cannot be converted without loss.
- **Evidence:**
  - [Quirks, Caveats, and Gotchas In SQLite](https://www.sqlite.org/quirks.html) — SQLite — official_docs — "Datatypes are advisory rather than mandatory"; "foreign key constraint enforcement is turned off by default"; "Due to an historical oversight, the column values of a PRIMARY KEY are allowed to be NULL"; the workaround is NOT NULL on each PK column; "WITHOUT ROWID and STRICT tables work correctly" — verified.
  - [SQLite PRAGMA statements](https://www.sqlite.org/pragma.html) — SQLite — official_docs — "This pragma is a no-op within a transaction"; "applications should set the foreign key enforcement flag as required by the application and not depend on the default setting"; "PRAGMA integrity_check does not find FOREIGN KEY errors" — verified.
  - [SQLite STRICT Tables](https://www.sqlite.org/stricttables.html) — SQLite — official_docs — introduced in 3.37.0 (2021-11-27); a value that cannot be converted without loss raises SQLITE_CONSTRAINT_DATATYPE; older versions "report an error" on a database with STRICT tables — verified.
  - [SQLite Foreign Key Support](https://www.sqlite.org/foreignkeys.html) — SQLite — official_docs — "disabled by default (for backwards compatibility), so must be enabled separately for each database connection" — verified.
  - [Python sqlite3](https://docs.python.org/3/library/sqlite3.html) — PSF, 3.14.7 — official_docs — `setconfig()` and `SQLITE_DBCONFIG_ENABLE_FKEY` were "Added in version 3.12" — verified.
- **Detect:**
  - grep the connection factories for `foreign_keys`: `sqlite3.connect[(]`, `new Database[(]`, `create_engine[(].sqlite`, and `drizzle[(]` over better-sqlite3 or libsql.
  - From the app's own connection, run `PRAGMA foreign_keys;`, `PRAGMA foreign_key_check;` and `PRAGMA integrity_check;`.
  - List non-STRICT tables with `SELECT name FROM sqlite_schema WHERE type='table' AND sql NOT LIKE '%STRICT%';`.
  - Find mixed types with `SELECT typeof(col), count(*) FROM t GROUP BY 1;`.
- **Tools:** sqlite3 CLI, ripgrep.
- **Applies to:** SQLite in apps, bots, CLIs and desktop tools: better-sqlite3, Python sqlite3, SQLAlchemy, Django, Drizzle, Prisma.
- **When not to apply / counterpoints:**
  - SQLite calls flexible typing "a feature, not a bug".
  - STRICT tables cannot be opened by SQLite older than 3.37, and converting a table means recreating it.
  - Turning on enforcement also activates dormant ON DELETE CASCADE/SET NULL actions. This is a reasoned implication of the docs, not a quoted statement.
- **Fix risk:** high

### G209-F09 — SQLite with concurrent writers: WAL (not on network filesystems), a busy_timeout, BEGIN IMMEDIATE for write transactions, short transactions, and synchronous=NORMAL only with its durability trade-off understood
- **Grade:** A · **Verdict:** CORRECTED. The claimed conflict between Litestream and SQLite is softened. SQLite itself says synchronous=NORMAL "provides the best balance between performance and safety for most applications running in WAL mode". The only durability lost is across power loss or an OS crash; commits survive application crashes.
- **Rationale:**
  - WAL lets readers and writers proceed concurrently, and the WAL setting persists across connections.
  - WAL "does not work over a network filesystem".
  - Readers that always overlap can stop checkpoints, so "the WAL file will grow without bound".
  - Django (5.1+) exposes `transaction_mode: "IMMEDIATE"` so that transactions wait for the timeout before raising "Database is locked".
  - Fractaled Mind's Rails load test returned 500s from SQLITE_BUSY at 4 concurrent requests under default deferred transactions. Switching to IMMEDIATE removed nearly all errors; a GVL-releasing busy handler then flattened p99.99 at about 0.5 s.
- **Evidence:**
  - [SQLite Write-Ahead Logging](https://www.sqlite.org/wal.html) — SQLite — official_docs — "readers do not block writers and a writer does not block readers"; "WAL does not work over a network filesystem"; auto-checkpoint at "1000 pages"; "the WAL file will grow without bound" — verified.
  - [SQLite PRAGMA synchronous / journal_mode](https://www.sqlite.org/pragma.html) — SQLite — official_docs — "A transaction committed in WAL mode with synchronous=NORMAL might roll back following a power loss or system crash. Transactions are durable across application crashes regardless of the synchronous setting"; "The synchronous=NORMAL setting provides the best balance between performance and safety for most applications running in WAL mode"; "The WAL journaling mode is persistent" — verified.
  - [Django 5.2 databases: SQLite notes](https://docs.djangoproject.com/en/5.2/ref/databases/) — DSF — official_docs — "New in Django 5.1 ... The default is DEFERRED"; "To make sure your transactions wait until timeout before raising 'Database is Locked', change the transaction mode to IMMEDIATE"; `init_command` for PRAGMAs (new in 5.1) — verified.
  - [SQLite on Rails: The how and why of optimal performance](https://fractaledmind.com/2024/04/15/sqlite-on-rails-the-how-and-why-of-optimal-performance/) — Stephen Margheim, 2024-04-15 — engineering_blog — "a percentage of our requests are returning 500 error code responses" at 4 concurrent requests; long-tail latency "flatlines at around half a second" — verified.
  - [Litestream: Tips & Caveats](https://litestream.io/tips/) — Litestream — tool docs — "PRAGMA busy_timeout = 5000;"; recommends synchronous NORMAL: "This is safe as the WAL file is append only"; "Litestream only works with the SQLite WAL journaling mode" — verified.
  - [Python sqlite3](https://docs.python.org/3/library/sqlite3.html) — PSF, 3.14.7 — official_docs — the connect timeout defaults to five seconds. `autocommit=False` is "the recommended value", while LEGACY_TRANSACTION_CONTROL remains "the default"; in legacy mode, "a transaction is implicitly opened" before INSERT/UPDATE/DELETE/REPLACE — verified.
- **Detect:**
  - From the app's own connection, run `PRAGMA journal_mode; PRAGMA busy_timeout; PRAGMA synchronous;`.
  - grep the logs for `database is locked|SQLITE_BUSY`.
  - Django: check DATABASES OPTIONS for `transaction_mode`.
  - Python sqlite3: check that `autocommit` and `timeout=` are set explicitly.
  - Check whether the DB file sits on NFS or SMB.
  - Watch the size of the `-wal` file.
- **Tools:** sqlite3 CLI, ripgrep, log search.
- **Applies to:** Multi-writer SQLite: web apps, Python and Node bots, job runners, Litestream deployments.
- **When not to apply / counterpoints:**
  - Use synchronous=FULL for data where losing the last commits on power loss matters, such as order or fund state.
  - BEGIN IMMEDIATE serializes writers earlier.
  - Backups must include the `-wal` and `-shm` files or use the backup API.
- **Fix risk:** medium

### G209-F10 — Give application DB roles finite Postgres timeouts, set per role or database rather than in postgresql.conf, plus client-side connection and query timeouts
- **Grade:** A · **Verdict:** CORRECTED. Changes:
  - transaction_timeout exists since **PostgreSQL 17**; it is absent from the PG16 docs.
  - The "not recommended in postgresql.conf" note appears on statement_timeout, lock_timeout and transaction_timeout, but **not** on idle_in_transaction_session_timeout.
  - Brandur's numbers come from a **controlled reproduction** (que-degradation-test, about 50 jobs/s), not from the production incident itself. The source type is changed to engineering_blog.
- **Rationale:** All four Postgres timeouts default to 0, which disables them. An idle open transaction "prevents vacuuming away recently-dead tuples" and holds locks. node-postgres sets no client timeouts by default. Brandur's reproduction showed:
  - one long-lived transaction pushed the job-lock time from under 0.01 s to "15x that level at times of 0.1 s and above";
  - the queue reached 60k jobs in an hour;
  - nearly 100,000 dead rows piled up.
- **Evidence:**
  - [PostgreSQL 18: Client Connection Defaults](https://www.postgresql.org/docs/current/runtime-config-client.html) — PGDG — official_docs — "A value of zero (the default) disables the timeout"; "Setting statement_timeout in postgresql.conf is not recommended because it would affect all sessions" (same note for transaction_timeout and lock_timeout); idle_in_transaction: "an open transaction prevents vacuuming away recently-dead tuples ... can contribute to table bloat" — verified. transaction_timeout is present in the /docs/17 page and absent from /docs/16.
  - [node-postgres Client API](https://node-postgres.com/apis/client) — brianc — official_docs — statement_timeout, query_timeout, idle_in_transaction_session_timeout and connectionTimeoutMillis: "default is no timeout" — verified.
  - [Control Runaway Postgres Queries With Statement Timeout](https://www.crunchydata.com/blog/control-runaway-postgres-queries-with-statement-timeout) — Craig Kerstiens, Crunchy Data, 2020-06-10 — engineering_blog — `ALTER DATABASE mydatabase SET statement_timeout = '60s';` "a sane default is 30 or 60 seconds" — verified.
  - [Postgres Job Queues & Failure By MVCC](https://brandur.org/postgres-queues) — Brandur Leach, 2015-05-18 — engineering_blog (incident plus reproduction) — "this lock time escalates quickly until it's 15x that level at times of 0.1 s and above"; "One hour into a long-lived transaction, we're at 60k jobs"; "approaching an incredible 100,000 dead rows"; also notes statement_timeout "is insufficient in itself" — verified.
  - [PostgreSQL 18: Error codes](https://www.postgresql.org/docs/current/errcodes-appendix.html) — PGDG — official_docs — 57014 query_canceled, 55P03 lock_not_available, 25P03 idle_in_transaction_session_timeout, 25P04 transaction_timeout — verified.
- **Detect:**
  - As the app role, run `SHOW statement_timeout; SHOW idle_in_transaction_session_timeout; SHOW lock_timeout;` (plus `SHOW transaction_timeout;` on PG17+).
  - Per-role settings: `SELECT r.rolname, s.setconfig FROM pg_db_role_setting s LEFT JOIN pg_roles r ON r.oid=s.setrole;`.
  - Idle-in-transaction sessions: `SELECT pid, state, now()-xact_start AS xact_age, left(query,80) FROM pg_stat_activity WHERE state LIKE 'idle in transaction%' ORDER BY xact_age DESC;`.
  - grep the client config for `statement_timeout|query_timeout|connectionTimeoutMillis|connect_timeout`.
  - Migrations: squawk `require-lock-timeout`, `require-statement-timeout` and `require-timeout-settings`.
- **Tools:** psql, squawk, ripgrep.
- **Applies to:** PostgreSQL with any driver (node-postgres, psycopg, asyncpg, Prisma, Drizzle, SQLAlchemy, Django).
- **When not to apply / counterpoints:**
  - Batch jobs, reports and migrations need their own roles or per-session overrides.
  - PG warns against idle_session_timeout through connection-pooling middleware.
  - Values such as 30–60 s are practitioner defaults, not measured. Choosing values is report-only (F22).
- **Fix risk:** medium

### G209-F14 — When a table has more than one writer, defaults and generated values that correctness depends on must live in the DB
- **Grade:** A · **Verdict:** VERIFIED
- **Rationale:** SQLAlchemy separates Python-side defaults from server defaults that are part of the DDL. Prisma's `@updatedAt`, `cuid()` and `uuid()` are implemented by the ORM and are "not 'visible' in the underlying database schema". Django's `db_default` "will be used when inserting rows outside of the ORM". Yang found 200+ fields that the app requires but that are nullable by default in the DB.
- **Evidence:**
  - [SQLAlchemy 2.0 Column INSERT/UPDATE Defaults](https://docs.sqlalchemy.org/en/20/core/defaults.html) — SQLAlchemy 2.0.54 — official_docs — "Column.default and Column.onupdate are invoked explicitly by SQLAlchemy when an INSERT or UPDATE statement occurs ... This is different than a 'server side' default, which is part of the table's DDL definition" — verified.
  - [Prisma schema reference](https://www.prisma.io/docs/orm/reference/prisma-schema-reference) — Prisma v7 docs — official_docs — `@updatedAt`: "Implemented at Prisma ORM level"; `cuid()` and `uuid()`: "Implemented by Prisma ORM and therefore not 'visible' in the underlying database schema" — verified.
  - [Django 5.2 model field reference (db_default)](https://docs.djangoproject.com/en/5.2/ref/models/fields/) — DSF — official_docs — "db_default will still be set at the database level and will be used when inserting rows outside of the ORM"; "Database defaults cannot reference other fields or models." — verified.
- **Detect:**
  - Find NOT NULL columns with no DB default: `SELECT table_name, column_name FROM information_schema.columns WHERE is_nullable='NO' AND column_default IS NULL AND table_schema='public';`, then exclude identity columns.
  - SQLAlchemy: `default=` without `server_default=`.
  - Django: `default=` without `db_default=` on timestamp and status fields.
  - Prisma: `@updatedAt|@default[(](uuid|cuid|nanoid)`.
  - Drizzle: `[.][$]defaultFn[(]|[.][$]onUpdate`.
  - Then check whether any non-ORM writer exists: `rg -n 'INSERT INTO|UPDATE .* SET' scripts/ migrations/ sql/`.
- **Tools:** psql, ripgrep.
- **Applies to:** Shared DBs, ETL, admin scripts, bots with separate ingestion and execution processes.
- **When not to apply / counterpoints:**
  - Single-writer apps, and IDs generated in the app on purpose (e.g. UUIDv7 for idempotency), are fine.
  - DB defaults cannot reference other fields.
  - A DB default that differs from the ORM default creates two truths.
- **Fix risk:** medium

### G209-F15 — Add CI gates that fail on model/migration drift, unapplied or inconsistent migrations, and DDL or query lint errors (safe to add automatically)
- **Grade:** A · **Verdict:** VERIFIED. One note added: Prisma 8 is in RC, so the migrate-diff flags may change again.
- **Rationale:**
  - `alembic check` (since 1.9.0) succeeds only when autogenerate "would produce only empty migrations".
  - Django's `makemigrations --check` and `migrate --check` exit non-zero on drift or on unapplied migrations.
  - `prisma migrate diff --exit-code` returns 0 for empty, 1 for an error and 2 for a non-empty diff.
  - `sqlc vet`'s sqlc/db-prepare rule prepares every query against a live DB.
  - Autogenerate "can not detect" table or column renames (they appear as a drop plus an add) or anonymously named constraints.
- **Evidence:**
  - [Alembic Auto Generating Migrations](https://alembic.sqlalchemy.org/en/latest/autogenerate.html) — Alembic 1.20.0 — official_docs — "When alembic check returns a success code, this is an indication that the alembic revision --autogenerate command would produce only empty migrations"; "Added in version 1.9.0"; under "Autogenerate can not detect": column renames "are detected as a column add/drop pair", "Anonymously named constraints", and Enum types on backends without native ENUM — verified.
  - [django-admin and manage.py (5.2)](https://docs.djangoproject.com/en/5.2/ref/django-admin/) — DSF — official_docs — makemigrations --check: "Makes makemigrations exit with a non-zero status when model changes without migrations are detected. Implies --dry-run."; migrate --check: "... when unapplied migrations are detected" — verified.
  - [Prisma CLI reference](https://www.prisma.io/docs/orm/reference/prisma-cli-reference) — Prisma v7 docs — official_docs — `--exit-code`: "(Empty: 0, Error: 1, Not empty: 2)"; "The --from-url, --to-url, --from-schema-datasource, --to-schema-datasource, and --shadow-database-url options have been removed"; v7 uses `--from-config-datasource` / `--to-config-datasource` — verified.
  - [drizzle-kit check](https://orm.drizzle.team/docs/drizzle-kit-check) — Drizzle Team — official_docs — "lets you check consistency of your generated SQL migrations history"; nothing about DB drift — verified.
  - [sqlc vet](https://docs.sqlc.dev/en/latest/howto/vet.html) — sqlc — official_docs — sqlc/db-prepare will "attempt to prepare each of your queries against the connected database and report any failures"; CEL can access `query.cmd`, `query.sql` and `postgresql.explain` (Seq Scan example) — verified.
  - [Atlas migrate lint](https://atlasgo.io/versioned/lint) — Ariga — official_docs — "Starting with v0.38, the atlas migrate lint command is available only to Atlas Pro users" — verified.
- **Detect:** CI commands:
  - `alembic check`
  - `python manage.py makemigrations --check --dry-run && python manage.py migrate --check`
  - Prisma v7: `prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --exit-code`. Flags differ between v6 and v7 and may change in v8. Also diff against the config datasource to catch manual hotfixes.
  - `drizzle-kit check`, plus a suggested extra step (not a Drizzle feature): `drizzle-kit generate && git diff --exit-code <out-dir>`.
  - `squawk migrations/*.sql`
  - `sqlc vet`
  - `atlas migrate lint` (Pro only)
- **Tools:** alembic, django manage.py, prisma, drizzle-kit, squawk, sqlc, atlas.
- **Applies to:** Every project with versioned migrations.
- **When not to apply / counterpoints:**
  - A green gate does not prove equivalence: renames, anonymous constraints, some Enum types, triggers and manual prod hotfixes escape model-to-migration diffs.
  - drizzle-kit check does not detect drift from the DB.
  - Atlas linting is paywalled, and squawk covers Postgres only.
- **Fix risk:** low

### G209-F19 — MySQL/MariaDB: verify strict SQL mode in the global and session settings the app actually uses; flag `sql_mode=''` and `FOREIGN_KEY_CHECKS=0`, and audit what they wrote
- **Grade:** A · **Verdict:** VERIFIED
- **Rationale:**
  - Without strict mode, "MySQL inserts adjusted values for invalid or missing values and produces warnings". The manual's own example inserts 'abc' into an INT column and gets only a warning (1366).
  - The 8.4 default includes STRICT_TRANS_TABLES, but a session can override it.
  - Rows written while FK checks were off are not re-checked when the checks are turned back on.
  - Django also "highly recommends activating a strict mode for MySQL".
- **Evidence:**
  - [MySQL 8.4 Server SQL Modes](https://dev.mysql.com/doc/refman/8.4/en/sql-mode.html) — Oracle — official_docs — "If strict mode is not in effect, MySQL inserts adjusted values for invalid or missing values and produces warnings"; the default includes ONLY_FULL_GROUP_BY, STRICT_TRANS_TABLES, NO_ZERO_IN_DATE, NO_ZERO_DATE, ERROR_FOR_DIVISION_BY_ZERO and NO_ENGINE_SUBSTITUTION — verified.
  - [MySQL 8.4 FOREIGN KEY Constraints](https://dev.mysql.com/doc/refman/8.4/en/create-table-foreign-keys.html) — Oracle — official_docs — "rows added to a table while foreign_key_checks is disabled are not checked for consistency when foreign_key_checks is re-enabled" — verified.
  - [Django 5.2 databases: MySQL sql_mode](https://docs.djangoproject.com/en/5.2/ref/databases/) — DSF — official_docs — "Django highly recommends activating a strict mode for MySQL to prevent data loss" — verified (added evidence).
- **Detect:**
  - From the app's connection, run `SELECT @@GLOBAL.sql_mode, @@SESSION.sql_mode;`.
  - grep for `sql_mode|init_command|SET +FOREIGN_KEY_CHECKS *= *0|SET +sql_mode *= *''`.
  - After an import that disabled checks, run the orphan queries (F03) and range/type audits.
- **Tools:** mysql client, ripgrep.
- **Applies to:** MySQL and MariaDB backends: Laravel, Rails, Django, Prisma or Drizzle on MySQL, PlanetScale.
- **When not to apply / counterpoints:** Legacy apps may depend on lenient coercion. Turning on strict mode is a behaviour change, so it is report-only (F22).
- **Fix risk:** high

### G209-F20 — Redis: decide per keyspace whether it is a cache or a system of record, and check the persistence and eviction config fits that role
- **Grade:** A · **Verdict:** VERIFIED. Note: Redis 8.6 added the `*-lrm` policies.
- **Rationale:**
  - With RDB only, "you should be prepared to lose the latest minutes of data".
  - AOF with everysec "may lose 1 second of data".
  - Redis suggests using both "if you want a degree of data safety comparable to what PostgreSQL can provide".
  - maxmemory 0 is the 64-bit default.
  - "The volatile-xxx policies behave like noeviction if no keys have an associated expiration"; under noeviction, writes return errors.
  - Redis itself suggests "running two separate Redis instances" for cache and persistent keys.
- **Evidence:**
  - [Redis persistence](https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/) — Redis — official_docs — "RDB is NOT good if you need to minimize the chance of data loss"; "you may lose 1 second of data if there is a disaster"; "The general indication you should use both persistence methods is if you want a degree of data safety comparable to what PostgreSQL can provide you" — verified.
  - [Redis key eviction](https://redis.io/docs/latest/develop/reference/eviction/) — Redis — official_docs — "Set maxmemory to zero ... This is the default behavior for 64-bit systems"; "The volatile-xxx policies behave like noeviction if no keys have an associated expiration"; "you should consider running two separate Redis instances" — verified.
  - [Redis TTL](https://redis.io/docs/latest/commands/ttl/) — Redis — official_docs — "-1 if the key exists but has no associated expire" — verified.
  - [redis-cli](https://redis.io/docs/latest/develop/tools/cli/) — Redis — official_docs — `--scan` does not block the server, "which does happen when you use a command like KEYS *"; `--bigkeys`, `--memkeys` and `--keystats` are documented — verified.
- **Detect:**
  - Run `CONFIG GET appendonly|appendfsync|save|maxmemory|maxmemory-policy`, plus `INFO persistence`, `INFO memory` and `INFO stats` (evicted_keys, expired_keys).
  - Count cache keys with no TTL: `redis-cli --scan --pattern 'cache:*' | head -1000 | xargs -n1 redis-cli TTL | grep -c '^-1$'`.
  - Check sizes with `redis-cli --keystats`.
  - grep the code for SET without `EX|PX` on cache prefixes, and for `KEYS ` in application code.
- **Tools:** redis-cli, ripgrep.
- **Applies to:** Redis or Valkey used as a cache, queue, rate limiter, session store, or bot state store.
- **When not to apply / counterpoints:** Some keys are meant to be permanent, so adding a TTL would lose data. Persistence and eviction are ops decisions, so they are report-only.
- **Fix risk:** high

### G209-F12 — One Session per request, job or task, owned by the caller; never share a Session or AsyncSession across threads or tasks; forbid implicit lazy loads in async SQLAlchemy
- **Grade:** A · **Verdict:** VERIFIED
- **Rationale:**
  - SQLAlchemy: "keep the lifecycle of the session (and usually the transaction) separate and external".
  - Its concurrency model is "Session per thread, AsyncSession per task", and a single AsyncSession "is not safe for use in multiple, concurrent tasks".
  - MissingGreenlet "is nearly always due to the use of lazy loading".
  - The docs list selectinload, `lazy="raise"`, `expire_on_commit=False`, AsyncAttrs and write-only collections as options.
  - TOSEM 2024: API bugs are the most frequent Hibernate issue (72/186, 38.7%). Among 92 API bugs: inconsistent entity state 16 (17.4%), proxy misuse 6 (6.5%), transaction misuse 4 (4.3%), including a missing `@Transactional`.
- **Evidence:**
  - [SQLAlchemy 2.0 asyncio](https://docs.sqlalchemy.org/en/20/orm/extensions/asyncio.html) — SQLAlchemy 2.0.54 — official_docs — "A single instance of AsyncSession is not safe for use in multiple, concurrent tasks"; "relationships can be declared with lazy="raise"" — verified.
  - [SQLAlchemy errors: MissingGreenlet](https://docs.sqlalchemy.org/en/20/errors.html#error-xd2s) — SQLAlchemy — official_docs — "nearly always due to the use of lazy loading, which is not directly supported under asyncio" — verified.
  - [SQLAlchemy Session Basics](https://docs.sqlalchemy.org/en/20/orm/session_basics.html) — SQLAlchemy — official_docs — "Keep the lifecycle of the session (and usually the transaction) separate and external"; "Session per thread, AsyncSession per task" — verified.
  - [An Empirical Study on the Characteristics of Database Access Bugs in Java Applications](https://arxiv.org/html/2405.15008) — Wei Liu, Shouvick Mondal, Tse-Hsun (Peter) Chen, TOSEM 33 (2024), DOI 10.1145/3672449 — peer_reviewed — "API bug (72/186, 38.7%) is the most frequent issue when using Hibernate"; "(16/92, 17.4%)"; "(6/92, 6.5%)"; "(4/92, 4.3%)"; "missing annotation @Transactional" — verified.
- **Detect:**
  - grep for `asyncio.gather[(]` inside functions that share one `session`.
  - grep for `relationship[(]` without `lazy=` in async code.
  - grep for `async_sessionmaker[(]` without `expire_on_commit=False`.
  - grep for `Session[(][)]|SessionLocal[(][)]` inside repository or service functions.
  - In tests, add a global `raiseload('*')`.
  - JVM logs: `LazyInitializationException`, `detached entity passed to persist`.
  - Runtime: sessions left idle in transaction (F10).
- **Tools:** ripgrep, pytest, psql.
- **Applies to:** SQLAlchemy/SQLModel (sync and async), FastAPI, async Python bots, Hibernate/JPA. The same idea applies to Prisma and Drizzle transactions.
- **When not to apply / counterpoints:** `lazy='raise'` fails fast on untested paths, and eager loading can over-fetch. Change these only where tests cover the path. AsyncAttrs is an equally valid option.
- **Fix risk:** medium

### G209-F03 — Every reference column carries an enforced FK with an explicit ON DELETE, unless a reason not to is documented; flag relations that are only emulated
- **Grade:** B · **Verdict:** CORRECTED. Changes:
  - The GitLab counterpoint is fixed. GitLab's "loose foreign keys" exist for **cross-database references after database decomposition**, where standard PG FKs cannot work, with asynchronous cleanup. They are not a general performance opt-out.
  - SQLCheck's "No Foreign Key" count is added.
  - The Smelly Relations definition is added: "Missing constraints" means missing *FK* constraints.
- **Rationale:**
  - Smelly Relations: 77% of surveyed developers mark missing FK constraints as a smell, and "the use of an orm framework doesn't immune the application from database smells".
  - SQLCheck flagged "No Foreign Key" 1,389 times in 1,406 GitHub repos.
  - Prisma's emulated relations "do not apply to raw queries".
  - GitLab requires DB FKs with ON DELETE.
  - TOSEM 2024 notes that Hibernate lacks built-in FK and unique constraints, and that constraint violations are 48.4% of schema bugs.
  - MySQL does not re-check rows inserted while FK checks were off.
- **Evidence:**
  - [Smelly Relations: Measuring and Understanding Database Schema Quality](https://zenodo.org/records/1998088) — Sharma, Fragkoulis, Rizou, Bruntink, Spinellis, ICSE-SEIP 2018 — peer_reviewed — "some practices, such as meaningless name (83%) and missing constraints (77%), are clearly marked as database smells"; MC is defined as "constraints for a foreign key are missing from a schema definition"; "the use of an orm framework doesn't immune the application from database smells"; 2,925 systems and 393k+ SQL statements — verified in the preprint PDF.
  - [Prisma relation mode](https://www.prisma.io/docs/orm/prisma-schema/data-model/relations/relation-mode) — Prisma — official_docs — "Prisma ORM will not use foreign keys in your database"; "Emulation of relations is only available for Prisma Client queries and does not apply to raw queries"; a validation warning recommends @@index — verified.
  - [GitLab: Foreign keys and associations](https://docs.gitlab.com/development/database/foreign_keys/) — GitLab — official_docs — "Every foreign key must define an ON DELETE clause, and in 99% of the cases this should be set to CASCADE"; "Don't define options such as dependent: :destroy or dependent: :delete" — verified.
  - [GitLab: Loose foreign keys](https://docs.gitlab.com/development/database/loose_foreign_keys/) — GitLab — official_docs — "Ensuring data consistency between two databases is not possible with standard PostgreSQL foreign keys"; "Our preferred approach to this problem is eventual consistency" — verified (substituted to fix the counterpoint).
  - [An Empirical Study on the Characteristics of Database Access Bugs in Java Applications](https://arxiv.org/html/2405.15008) — Liu, Mondal, Chen, TOSEM 2024 — peer_reviewed — "95 (22.5%)" schema bugs; "violation of database constraint is the most common root cause (46/95, 48.4%)"; "Hibernate does not provide corresponding built-in constraints for other database constraints such as foreign key ..., primary key, or unique constraint" — verified.
  - [MySQL 8.4: FOREIGN KEY Constraints](https://dev.mysql.com/doc/refman/8.4/en/create-table-foreign-keys.html) — Oracle — official_docs — "rows added to a table while foreign_key_checks is disabled are not checked for consistency when foreign_key_checks is re-enabled" — verified.
  - [sqlcheck README](https://github.com/jarulraj/sqlcheck) — Arulraj et al. — tool docs — anti-patterns "Foreign Key Does Not Exist" and "Entity-Attribute-Value Pattern" — verified. The repo's last commit was 2024-02; it is not archived but is dormant.
  - [SQLCheck (SIGMOD 2020)](https://arxiv.org/abs/2004.10232) — Dintyala, Narechania, Arulraj — peer_reviewed — Table 3: "No Foreign Key 0 1389" (dbdeo vs sqlcheck, GitHub repos) — verified in the PDF.
- **Detect:**
  - Postgres: list `*_id` columns with no FK:

    ```sql
    SELECT c.table_name, c.column_name
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.column_name ~ '_id$'
      AND NOT EXISTS (
        SELECT 1
        FROM information_schema.key_column_usage k
        JOIN information_schema.table_constraints tc
          ON tc.constraint_name = k.constraint_name
         AND tc.constraint_schema = k.constraint_schema
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND k.table_name = c.table_name
          AND k.column_name = c.column_name
      );
    ```

    This was not executed during verification.
  - Count orphans before any fix: `SELECT count(*) FROM child c LEFT JOIN parent p ON p.id=c.parent_id WHERE c.parent_id IS NOT NULL AND p.id IS NULL;`.
  - SQLite: `PRAGMA foreign_key_check;`.
  - MySQL: `information_schema.KEY_COLUMN_USAGE WHERE REFERENCED_TABLE_NAME IS NOT NULL`.
  - grep for `relationMode *= *"prisma"`, `db_constraint *= *False`, `FOREIGN_KEY_CHECKS *= *0`, `polymorphic: true` and `GenericForeignKey[(]`.
  - Tools: active_record_doctor missing_foreign_keys; database_consistency ForeignKeyChecker; sqlcheck.
- **Tools:** psql, sqlite3, active_record_doctor, database_consistency, sqlcheck, ripgrep.
- **Applies to:** Relational stores holding references (Postgres, SQLite, MySQL/InnoDB).
- **When not to apply / counterpoints:**
  - PlanetScale: "MySQL foreign keys introduce increased locking for data and metadata changes"; FKs complicate refactoring and sharding.
  - gh-ost: "Foreign key constraints are not supported. They may be supported in the future, to some extent."
  - Cross-database references cannot use FKs (GitLab's loose foreign keys).
  - The `*_id` naming heuristic gives false positives on external IDs such as exchange order IDs or stripe_customer_id.
- **Fix risk:** high

### G209-F21 — Every write path that can violate a unique, FK, NOT NULL, CHECK or length constraint catches the integrity error and maps it to a specific 409 or 422, not a 500
- **Grade:** B · **Verdict:** VERIFIED. Supporting data added from the same paper: developers caught DB constraint exceptions "in only 4 cases across thousands of model object saves".
- **Rationale:**
  - Yang classed 18% of 114 constraint issues as "How": unclear or missing error messages.
  - Their failures included "web-page crashes, silent failures".
  - In Rails, a DB check failure raises ActiveRecord::StatementInvalid, which developers "almost never catch".
  - TOSEM 2024: constraint violations are 48.4% of schema bugs.
  - The thoughtbot and Rails guidance depends on rescuing RecordNotUnique once a unique index exists.
- **Evidence:**
  - [Yang et al. ICSE 2020](https://hyperloop-rails.github.io/278.pdf) — peer_reviewed — "How 18% of 114 studied issues"; "web-page crashes, silent failures, software-upgrade failures, poor user experience"; "developers almost never catch such exceptions (it is caught in only 4 cases across thousands of model object saves across the 12 applications we studied)" — verified.
  - [PostgreSQL 18 Error Codes](https://www.postgresql.org/docs/current/errcodes-appendix.html) — PGDG — official_docs — 23502 not_null_violation, 23503 foreign_key_violation, 23505 unique_violation, 23514 check_violation, 25P02 in_failed_sql_transaction — verified.
  - [TOSEM 2024](https://arxiv.org/html/2405.15008) — Liu, Mondal, Chen — peer_reviewed — "(46/95, 48.4%)" — verified.
  - [The Perils of Uniqueness Validations](https://thoughtbot.com/blog/the-perils-of-uniqueness-validations) — Derek Prior, thoughtbot — engineering_blog — "rescue and handle that exception in the controller action or use rescue_from" — verified.
  - [Prisma error reference](https://www.prisma.io/docs/orm/reference/error-reference) — Prisma (v8 docs) — official_docs — "Every user-facing Prisma ORM error is a structured envelope identified by a dotted NAMESPACE.SUBCODE code"; the old P-codes were renamed — verified. This confirms that Prisma error-code matching is version-specific.
- **Detect:**
  - For each insert or update in request handlers and bot command handlers, look for one of:
    - `except IntegrityError` (SQLAlchemy, Django);
    - `rescue ActiveRecord::RecordNotUnique|InvalidForeignKey|NotNullViolation`;
    - a driver check such as `code === '23505'`;
    - the Prisma known-request error for the installed major version (P2002-style codes in v6/v7, dotted codes in v8).
  - grep for generic handlers that turn every DB error into a 500.
  - Tests: insert a duplicate or an orphan and assert a 4xx with a message.
- **Tools:** ripgrep, pytest/vitest integration tests.
- **Applies to:** All API and web layers over relational DBs, plus bots that write orders or positions.
- **When not to apply / counterpoints:**
  - Over-specific mapping can leak constraint names to clients, so map to field-level messages.
  - In Postgres, an error aborts the enclosing transaction (25P02), so continuing needs savepoints.
- **Fix risk:** low

### G209-F22 — Classify every data-layer fix: (a) safe to apply automatically, (b) propose as a migration for human approval, (c) report only
- **Grade:** B · **Verdict:** VERIFIED. One addition: PG18's ALTER TABLE allows `NOT VALID` on not-null constraints, which gives a NOT NULL path that does not need the CHECK constraint.
- **Rationale:**
  - Atlas marks as "Data-dependent changes (changes that might fail)":
    - MF101 "Add unique index to existing column";
    - MF102 "Modifying non-unique index to unique";
    - MF103 "Adding a non-nullable column to an existing table";
    - MF104 "Modifying a nullable column to non-nullable".
  - It marks drops as destructive (DS102, DS103) and renames as backward incompatible (BC101, BC102).
  - Postgres gives safer paths:
    - NOT VALID skips the "potentially-lengthy scan";
    - VALIDATE CONSTRAINT takes only a SHARE UPDATE EXCLUSIVE lock;
    - SET NOT NULL skips its scan if a valid CHECK proves there are no NULLs;
    - CREATE INDEX CONCURRENTLY cannot run inside a transaction block, and if it fails it leaves an "invalid" index that "will still consume update overhead".
  - Yang: 49% of versions contain constraint changes, over 25% of changes tighten constraints on existing fields, and "When" problems (10%) caused upgrade failures. Example: Diaspora users with short passwords were locked out.
- **Evidence:**
  - [Atlas migration analyzers](https://atlasgo.io/lint/analyzers) — Ariga — official_docs — MF101–MF104, DS101–DS103 and BC101–BC104 labels as quoted above — verified. The analyzers run through `atlas migrate lint`, which is Pro-only since v0.38.
  - [PostgreSQL 18: ALTER TABLE](https://www.postgresql.org/docs/current/sql-altertable.html) — PGDG — official_docs — "if the NOT VALID option is used, this potentially-lengthy scan is skipped"; NOT VALID "is currently only allowed for foreign-key, CHECK, and not-null constraints"; VALIDATE CONSTRAINT "acquires a SHARE UPDATE EXCLUSIVE lock"; SET NOT NULL skips the scan "if a valid CHECK constraint exists ... which proves no NULL can exist" — verified.
  - [PostgreSQL 18: CREATE INDEX](https://www.postgresql.org/docs/current/sql-createindex.html) — PGDG — official_docs — "a regular CREATE INDEX command can be performed within a transaction block, but CREATE INDEX CONCURRENTLY cannot"; a failure leaves an "invalid" index that "will still consume update overhead" — verified.
  - [Yang et al. ICSE 2020](https://hyperloop-rails.github.io/278.pdf) — peer_reviewed — "49% of versions contain constraint changes"; ">25% of changes tighten constraints on existing data fields"; "When 10% of 114 studied issues"; Diaspora users "can no longer log in and are shown with the unhelpful 'Please use the required format' error" — verified.
  - [SQLite PRAGMA foreign_key_check](https://www.sqlite.org/pragma.html) — SQLite — official_docs — "returns one row output for each foreign key violation" — verified.
- **Detect:**
  - For each proposed change, ask: does it change results, errors or durability for any input that already exists or already succeeds today? If yes, it belongs in (b) or (c).
  - Pre-flight queries for (b): duplicates (F02), orphans (F03), `SELECT count(*) FROM t WHERE col IS NULL` before NOT NULL, and `PRAGMA foreign_key_check` before enabling SQLite FKs.
  - Lint the generated migrations with squawk (`adding-foreign-key-constraint`, `constraint-missing-not-valid`, `require-concurrent-index-creation`, `adding-not-nullable-field`) or with Atlas Pro.
- **Tools:** squawk, atlas, psql, sqlite3.
- **Applies to:** The hardening pass itself, across all stacks.
- **When not to apply / counterpoints:**
  - On small solo databases with no concurrent traffic, CONCURRENTLY and NOT VALID are unnecessary ceremony, but failures on existing data still apply.
  - App-side validators change error codes that clients may parse.
- **Fix risk:** low

### G209-F05 — Report unused, duplicate and redundant indexes from runtime statistics over a known window on every node; never drop them automatically; propose partial indexes for mostly-NULL columns
- **Grade:** B · **Verdict:** CORRECTED. Changes:
  - The PG wiki quote is fixed. The wiki says indexes "should be removed if they are not being used for either queries or constraint enforcement". It does not say constraint-backing indexes "show zero scans".
  - The wiki page date is corrected to "last edited June 2021".
  - PgHero's unused and duplicate index features are now confirmed from its CHANGELOG (v4.0.1).
  - The claim about replicas is reworded (see the practitioner voice section).
- **Rationale:**
  - Smelly Relations: "more than 77% detected instances of index abuse smell belong to the third variant of the smell (i.e., unused indexes)". Static detection of those "produce[s] false-positive instances" when queries are parameterized.
  - Haki Benita shrank a 769MB index on a nullable FK (more than 99% NULL) to under 5MB as a partial index. The overall cleanup freed more than 70GB "without dropping a single index".
  - Usage counters are per node and reset over time, so the counting window and every replica matter. This is a reasoned implication; Haki notes that stats resets define the window and that freed space is released on each replica too.
- **Evidence:**
  - [Smelly Relations preprint](https://zenodo.org/records/1998088) — Sharma et al., ICSE-SEIP 2018 — peer_reviewed — quote as above — verified in the PDF.
  - [PostgreSQL wiki: Index Maintenance](https://wiki.postgresql.org/wiki/Index_Maintenance) — community wiki, last edited 2021-06-09 — community docs — duplicate-index query (`GROUP BY key HAVING count(*) > 1` over indrelid, indclass, indkey, indexprs, indpred); "they should be removed if they are not being used for either queries or constraint enforcement (such as making sure a value is unique)" — verified.
  - [The Unexpected Find That Freed 20GB of Unused Index Space](https://hakibenita.com/postgresql-unused-index-size) — Haki Benita, 2021-02-01 — engineering_blog — "769MB in size, with more than 99% null values. The partial index ... was less than 5MB"; "freeing more than 70GB ... without dropping a single index or deleting any data"; the unused-index query finds indexes unused "since the last time the statistics were reset" — verified.
  - [PgHero](https://github.com/ankane/pghero) plus its [CHANGELOG](https://github.com/ankane/pghero/blob/master/CHANGELOG.md) — Andrew Kane — tool docs — "A performance dashboard for Postgres", "Battle-tested at Instacart"; the changelog mentions `unused_index_megabytes`, "Improved duplicate index logic" and an "unused index marker" — verified (v4.0.1).
- **Detect:**
  - Candidate unused indexes, largest first:

    ```sql
    SELECT s.relname, s.indexrelname, s.idx_scan,
           pg_size_pretty(pg_relation_size(s.indexrelid))
    FROM pg_stat_user_indexes s
    JOIN pg_index i ON i.indexrelid = s.indexrelid
    WHERE s.idx_scan = 0 AND NOT i.indisunique AND NOT i.indisprimary
    ORDER BY pg_relation_size(s.indexrelid) DESC;
    ```

    Run it on the primary and on each replica. Get the counting window from `SELECT stats_reset FROM pg_stat_database WHERE datname=current_database();`.
  - Duplicates: the wiki's duplicate-index query.
  - Also PgHero; active_record_doctor extraneous_indexes; database_consistency RedundantIndexChecker and RedundantUniqueIndexChecker.
  - Partial-index candidates: compare `count(*) FILTER (WHERE col IS NULL)::float/count(*)` with the index size.
- **Tools:** psql, PgHero, active_record_doctor, database_consistency.
- **Applies to:** Postgres primarily. MySQL has `sys.schema_unused_indexes`. SQLite has no usage stats, so report only.
- **When not to apply / counterpoints:** Some indexes are used only by monthly jobs, by replicas, or for constraint enforcement. A short statistics window gives false "unused" results. Dropping an index is a plan change.
- **Fix risk:** medium

### G209-F11 — Size connection pools from DB capacity, not client concurrency; set a finite acquisition timeout; always release; keep no session state behind a transaction-mode pooler
- **Grade:** B · **Verdict:** CORRECTED. The PlanetScale incident is re-described accurately:
  - It concerned the Vitess vttablet **transaction pool**, a server-side cap on concurrent transactions. That cap was raised to 10,000 "because it made the errors stop" after a migration from Cloud SQL's thread pool (~1,000).
  - The trigger was a batch transaction that held row locks for 15 minutes.
  - Errors peaked at 1,400 a minute, and throughput fell "to a tenth of what the workload requested".
  - With a cap back near 1,000 slots, a later burst ran at about 60k QPS with no errors.

  So it supports "let less happen at once" (admission control). It is not direct evidence about client pool sizes. The PG wiki page (2014) is also dated: it notes that 9.2 benchmarks suggested the formula "will need adjustment".
- **Rationale:**
  - HikariCP: shrinking the pool cut response times "from ~100ms to ~2ms", and "You want a small pool, saturated with threads waiting for connections".
  - The starting formula is ((core_count * 2) + effective_spindle_count). It targets *active* connections and predates SSDs.
  - node-postgres: an unreleased client makes later calls "timeout with an error or hang indefinitely" (connectionTimeoutMillis defaults to 0).
  - Session state such as `default_transaction_read_only` leaks through PgBouncer-style pools ("poisoned" pools).
  - asyncpg's prepared-statement cache breaks under PgBouncer in transaction or statement mode.
- **Evidence:**
  - [About Pool Sizing](https://github.com/brettwooldridge/HikariCP/wiki/About-Pool-Sizing) — Brett Wooldridge, HikariCP wiki (undated, long-standing) — engineering_blog — "from ~100ms to ~2ms -- over 50x improvement"; "connections = ((core_count * 2) + effective_spindle_count)"; the SSD effect is not well analysed — verified.
  - [PostgreSQL wiki: Number Of Database Connections](https://wiki.postgresql.org/wiki/Number_Of_Database_Connections) — community wiki, last edited 2014-03-14 — community docs — "the number of active connections should be somewhere near ((core_count * 2) + effective_spindle_count)"; "Benchmarks of WIP for version 9.2 suggest that this formula will need adjustment" — verified.
  - [node-postgres Pool API](https://node-postgres.com/apis/pool) — brianc — official_docs — max "By default this is set to 10"; connectionTimeoutMillis "By default this is 0 which means no timeout"; "will timeout with an error or hang indefinitely" — verified.
  - [SQLAlchemy 2.0 Connection Pooling](https://docs.sqlalchemy.org/en/20/core/pooling.html) — SQLAlchemy 2.0.54 — official_docs — `QueuePool(pool_size=5, max_overflow=10, timeout=30.0)`; reset on return calls rollback() "to release locks and transaction resources"; `pool_pre_ping` — verified.
  - [Concurrency vs. Throughput](https://planetscale.com/blog/concurrency-vs-throughput-vitess-mysql) — Liz van Dijk, PlanetScale, 2026-08-07 — incident_report — "The pool was increased to ten thousand, a number chosen not by sizing but because it made the errors stop"; "errors climbed to 1,400 a minute and throughput fell to a tenth of what the workload requested"; "Sometimes the fastest thing you can do for a busy system is to simply let less happen at once." — verified (see correction).
  - [Poisoned Postgres connection pools](https://planetscale.com/blog/postgres-poisoned-connection-pools) — Josh Brown, PlanetScale, 2026-08-18 — incident_report — "When a previous client leaves the pool in a undesired state ... leaving that pool 'poisoned' with stale state"; error 25006 "cannot execute INSERT in a read-only transaction"; quick fix `DISCARD ALL` — verified.
  - [asyncpg FAQ](https://magicstack.github.io/asyncpg/current/faq.html) — MagicStack — official_docs — pgbouncer in "transaction" or "statement" mode does not support prepared statements; the fixes are `statement_cache_size=0`, the asyncpg pool, or `pool_mode = session` — verified.
  - [Prisma connection pool](https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/databases-connections/connection-pool) — Prisma v7 docs — official_docs — the v6 default is `num_cpus::get_physical() * 2 + 1` and pool_timeout 10s. In v7, "connection pooling defaults (and configuration) now come from the driver itself". Serverless: "each function manages an instance of PrismaClient and its own connection pool" — verified.
  - [Django 5.2 databases: transaction pooling](https://docs.djangoproject.com/en/5.2/ref/databases/) — DSF — official_docs — "disable server-side cursors for a connection in DATABASES by setting DISABLE_SERVER_SIDE_CURSORS to True" under transaction pooling — verified (added evidence).
- **Detect:**
  - grep the pool config for `max:|pool_size|max_overflow|connection_limit|pool_timeout|connectionTimeoutMillis`.
  - Multiply by the number of workers or replicas, then compare with `SHOW max_connections;` and `SELECT count(*), state FROM pg_stat_activity GROUP BY state;`.
  - Find `pool.connect[(]` calls with no `release[(]` in a finally block.
  - Session state: `SET (SESSION )?` outside `SET LOCAL`, `pg_advisory_lock`, `DECLARE .* CURSOR`.
  - Behind PgBouncer: Django's `DISABLE_SERVER_SIDE_CURSORS` and asyncpg's `statement_cache_size=0`.
- **Tools:** psql, ripgrep.
- **Applies to:** Any pooled DB client. Critical for serverless, multi-worker servers and bots with many async tasks.
- **When not to apply / counterpoints:** The formula is a starting point for load testing, not a rule. Lobsters practitioners disagree on whether PgBouncer is needed at all. Pool sizes are report-only (F22).
- **Fix risk:** medium

### G209-F16 — Every list query reachable from user input has a server-enforced max page size; deep lists use keyset pagination; avoid exact COUNT(*) on large tables; batch jobs stream
- **Grade:** B · **Verdict:** VERIFIED
- **Rationale:**
  - GitLab: page 50,000 × 20 rows reads 1,000,000 rows and takes 5.5 s. The page-1 query executes in 2.145 ms. GitLab says "keyset pagination is preferred" and "Avoid presenting total counts, prefer limit counts" (count to 1001 and show "1000+").
  - Winand: OFFSET still fetches and sorts the skipped rows, and it duplicates or skips rows when rows are inserted between page fetches.
  - Django: QuerySet caching "can cause a large amount of memory to be used ... iterator() may help".
- **Evidence:**
  - [GitLab Pagination guidelines](https://docs.gitlab.com/development/database/pagination_guidelines/) — GitLab — official_docs — "the database reads 1_000_000 rows to return 20 rows, with a very high execution time (5.5 seconds)"; "Execution Time: 2.145 ms"; "As a long-term solution, keyset pagination is preferred"; "Avoid presenting total counts, prefer limit counts" — verified.
  - [We need tool support for keyset pagination](https://use-the-index-luke.com/no-offset) — Markus Winand, 2014 (updated 2023) — engineering_blog — "the database must still fetch these rows from the disk and bring them in order before it can send the following ones" — verified.
  - [Django 5.2 Database access optimization](https://docs.djangoproject.com/en/5.2/topics/db/optimization/) — DSF — official_docs — "the caching behavior of the QuerySet can cause a large amount of memory to be used. In this case, iterator() may help." — verified.
  - [GitLab Query performance guidelines](https://docs.gitlab.com/development/database/query_performance/) — GitLab — official_docs — general queries 100ms, "This is not a hard limit"; background migrations 1s — verified.
- **Detect:**
  - In handlers and resolvers, grep for:
    - `[.]all[(][)]` with no slicing;
    - `findMany[(]` with no `take`;
    - Drizzle `select[(][)][.]from[(]` with no `.limit[(]`;
    - raw `SELECT` with no `LIMIT`;
    - `OFFSET` built from request parameters;
    - `count[(][)]` in list endpoints.
  - Django batch jobs: `.iterator(chunk_size=...)`.
  - sqlc vet rule: `query.cmd == "many" && !query.sql.contains("LIMIT")`.
- **Tools:** ripgrep, sqlc vet, EXPLAIN ANALYZE.
- **Applies to:** HTTP and GraphQL list endpoints, admin exports, bot history queries, analytics jobs.
- **When not to apply / counterpoints:**
  - Small bounded tables need no pagination.
  - Keyset pagination cannot jump to an arbitrary page.
  - Server-side cursors (used by iterator() on Postgres) must be disabled under PgBouncer transaction mode.
  - Caps and keyset pagination change the API contract, so they are report-only.
- **Fix risk:** medium

### G209-F06 — Store instants as timestamptz (or aware UTC); flag `timestamp without time zone` columns and the ORM defaults that create them; the exception is future civil times (store local time plus the IANA zone)
- **Grade:** B · **Verdict:** CORRECTED. Changes:
  - The Skeet quote is fixed. The "rule files" wording comes from his 2022 reply in the comments: "any computations you performed with earlier rule files are no longer valid". It is not in the post body.
  - SQLCheck's "Missing Timezone" count (12) is clarified: it comes from the analysis of 31 Kaggle databases, not code repositories.
  - The PG wiki's own exception is added (see counterpoints).
- **Rationale:**
  - The PG wiki: "timestamptz records a single moment in time"; timestamp "just stores a date and time you give it". It also says not to store UTC in `timestamp`, because "there is no way for the database to know that UTC is the intended timezone".
  - squawk (`prefer-timestamptz`) and schemalint (`prefer-timestamptz-to-timestamp`) encode the rule.
  - The ORM defaults are tz-less: Prisma DateTime maps to timestamp(3), SQLAlchemy DateTime has `timezone=False`, and Drizzle `timestamp()` creates plain `timestamp`.
  - Django's default USE_TZ changed from False to True in 5.0.
- **Evidence:**
  - [PostgreSQL wiki: Don't Do This](https://wiki.postgresql.org/wiki/Don%27t_Do_This) — community wiki, last edited 2024-11-21 — community docs — quotes as above — verified.
  - [Prisma schema reference](https://www.prisma.io/docs/orm/reference/prisma-schema-reference) — Prisma v7 docs — official_docs — DateTime default mapping on PostgreSQL: "timestamp(3)"; native types `@db.Timestamp(x)` and `@db.Timestamptz(x)` — verified.
  - [SQLAlchemy 2.0 type basics](https://docs.sqlalchemy.org/en/20/core/type_basics.html) — SQLAlchemy — official_docs — `DateTime.__init__(timezone: bool = False)`; "Indicates that the datetime type should enable timezone support, if available on the base date/time-holding type only" — verified.
  - [Drizzle PostgreSQL column types](https://orm.drizzle.team/docs/column-types/pg) — Drizzle Team — official_docs — `timestamp()` generates `timestamp`; `{ withTimezone: true }` generates `timestamp with time zone` — verified.
  - [Django 5.2 Time zones](https://docs.djangoproject.com/en/5.2/topics/i18n/timezones/) plus the [5.0 release notes](https://docs.djangoproject.com/en/5.2/releases/5.0/) — DSF — official_docs — "The default value of the USE_TZ setting is changed from False to True"; the naive-datetime RuntimeWarning can be turned into an error with `warnings.filterwarnings` — verified.
  - [Squawk rules](https://squawkhq.com/docs/rules) — Squawk — tool docs — `prefer-timestamptz` — verified.
  - [schemalint built-in rules](https://github.com/kristiandupont/schemalint/blob/main/src/rules/README.md) — tool docs — `prefer-timestamptz-to-timestamp` — verified.
  - [Storing UTC is not a silver bullet](https://codeblog.jonskeet.uk/2019/03/27/storing-utc-is-not-a-silver-bullet/) — Jon Skeet, 2019 — engineering_blog — the KindConf "9am in Amsterdam" example; preserve local time plus zone ID and re-derive UTC when tz data changes — verified (quote corrected).
  - [SQLCheck (SIGMOD 2020)](https://arxiv.org/abs/2004.10232) — Dintyala, Narechania, Arulraj — peer_reviewed — the data anti-pattern "Missing Timezone: Date-time fields stored without timezone", 12 instances in the Kaggle-database column of Table 3 — verified in the PDF.
- **Detect:**
  - `SELECT table_name, column_name FROM information_schema.columns WHERE data_type='timestamp without time zone' AND table_schema NOT IN ('pg_catalog','information_schema');`
  - `squawk migrations/*.sql` and schemalint.
  - Prisma: `DateTime` fields without `@db.Timestamptz`.
  - SQLAlchemy: `DateTime[(][)]`.
  - Drizzle: `timestamp[(]` without `withTimezone: true`.
  - Django: `USE_TZ *= *False`.
  - Python: `datetime.utcnow[(]|datetime.now[(][)]`.
- **Tools:** squawk, schemalint, psql, ripgrep.
- **Applies to:** Postgres type choice. SQLite has no datetime type, so there the rule is to store ISO-8601 UTC or epoch values consistently. Applies to any ORM that generates DDL.
- **When not to apply / counterpoints:**
  - Future civil times need local time plus a zone (Skeet).
  - The PG wiki says timestamp "might be suitable" when "dealing with timestamps in an abstract way, or just saving and retrieving them from an app, where you aren't going to be doing arithmetic with them".
  - Converting an existing column rewrites the table and reinterprets values in the session TimeZone, so someone must know which zone the old values meant.
- **Fix risk:** high

### G209-F07 — Postgres type and query traps: NOT IN over a nullable subquery → NOT EXISTS; BETWEEN on timestamps → half-open range; char(n) → text; money → numeric plus currency; serial → identity; int4 PKs on growing tables → bigint; arbitrary varchar(n) → text
- **Grade:** B · **Verdict:** CORRECTED. Changes:
  - int4→bigint is **not** on the PG wiki page. It comes from squawk's `prefer-bigint-over-int` only.
  - The wiki's actual varchar advice is "Don't use varchar(n) *by default*". It also says "If what you really need is a text field with an length limit then varchar(n) is great", and that a CHECK constraint can express richer rules. So "text + CHECK" is one option for real limits, not the wiki's mandate.
  - The wiki's date is corrected to 2024.
- **Rationale:**
  - NOT IN "behaves in unexpected ways if there is a null present".
  - With BETWEEN on timestamps, "as soon as you get an entry exactly on midnight, you'll end up double-counting it".
  - char(n) "silently pads them with spaces".
  - The money type "doesn't handle fractions of a cent".
  - serial has "weird behaviors that make schema, dependency, and permission management unnecessarily cumbersome".
  - squawk and schemalint encode most of these.
- **Evidence:**
  - [PostgreSQL wiki: Don't Do This](https://wiki.postgresql.org/wiki/Don%27t_Do_This) — community wiki, last edited 2024-11-21 — community docs — "select * from foo where col not in (1,null); -- always returns 0 rows"; "if you pick an arbitrary length and choose varchar(20) for a surname field you're risking production errors in the future"; "For new applications, identity columns should be used instead" — verified.
  - [Squawk rules](https://squawkhq.com/docs/rules) — Squawk — tool docs — `ban-char-field`, `prefer-identity`, `prefer-bigint-over-int`, `prefer-bigint-over-smallint`, `prefer-text-field`, `prefer-timestamptz` — verified.
  - [schemalint built-in rules](https://github.com/kristiandupont/schemalint/blob/main/src/rules/README.md) — tool docs — `prefer-identity-to-serial`, `prefer-text-to-varchar`, `prefer-jsonb-to-json` — verified.
  - [Lobsters: Don't Do This](https://lobste.rs/s/m4f2ke/don_t_do_this) — lobste.rs, 2019-04-30 — practitioner_forum — "I wonder if there could be a place for a tool that does database query and schema linting"; "I'm glad I saw this article first before shooting myself in the foot" (about BETWEEN on registration dates) — verified.
- **Detect:**
  - Run squawk on migration SQL and schemalint on the live schema.
  - `SELECT table_name,column_name,data_type FROM information_schema.columns WHERE data_type IN ('character','money');`
  - Sequence headroom: `SELECT schemaname, sequencename, last_value, max_value FROM pg_sequences;`.
  - grep for `NOT IN *[(] *SELECT` (then check whether the subquery column is nullable) and for `BETWEEN` on timestamp columns.
- **Tools:** squawk, schemalint, sqlfluff, psql, ripgrep.
- **Applies to:** PostgreSQL schemas and hand-written SQL. The NOT IN/NULL semantics apply to all SQL databases.
- **When not to apply / counterpoints:**
  - The wiki is community guidance.
  - varchar(n) is legitimate when the limit is a real business rule, and F01 alignment may need it.
  - Moving from serial to identity, and widening to bigint, only matter for tables that grow.
  - NOT IN rewrites are report-only.
- **Fix risk:** medium

### G209-F18 — Report polymorphic associations and EAV tables as design debt the DB cannot enforce; never redesign them in a hardening pass
- **Grade:** B · **Verdict:** VERIFIED. Two notes:
  - The Heap JSONB measurement is from 2016. PG14+ `CREATE STATISTICS` on a single expression now gives planner statistics on extracted JSONB fields, which partly mitigates the problem.
  - The "Heap moved from EAV" story in the practitioner voice is removed as unsupported.
- **Rationale:**
  - GitLab: "always use separate tables instead of polymorphic associations", because of "being unable to enforce data consistency on the database level using foreign keys".
  - Karwin's catalog covers EAV and Polymorphic Associations.
  - Smelly Relations includes "MD: Metadata as data" (EAV).
  - sqlcheck detects EAV.
  - The usual JSONB replacement has its own cost: Heap measured about 584 s versus 300 ms because of missing statistics.
- **Evidence:**
  - [GitLab: Polymorphic associations](https://docs.gitlab.com/development/database/polymorphic_associations/) — GitLab — official_docs — quotes as above — verified.
  - [SQL Antipatterns, Volume 1](https://pragprog.com/titles/bksap1/sql-antipatterns-volume-1/) — Bill Karwin, Pragmatic Bookshelf, Oct 2022 — book, confirmed via the publisher page — the ToC includes "Entity-Attribute-Value", "Polymorphic Associations", "Keyless Entry" and "Metadata Tribbles" — verified.
  - [Smelly Relations](https://zenodo.org/records/1998088) — Sharma et al., 2018 — peer_reviewed — "a catalog of 13 database schema smells", including "MD: Metadata as data ... eav (Entity-Attribute-Value) pattern" — verified.
  - [When To Avoid JSONB In A PostgreSQL Schema](https://www.heap.io/blog/when-to-avoid-jsonb-in-a-postgresql-schema) — Dan Robinson, Heap, 2016-09-01 — engineering_blog — "PostgreSQL doesn't know how to keep statistics on the values of fields within JSONB columns"; 584 s vs 300 ms; 164 MB vs 79 MB; extracting 45 common fields saved about 30% of disk — verified.
  - [PostgreSQL 18: CREATE STATISTICS](https://www.postgresql.org/docs/current/sql-createstatistics.html) — PGDG — official_docs — "univariate statistics for a single expression ... providing benefits similar to an expression index" (absent from the PG13 docs) — verified (added as a counterpoint).
- **Detect:**
  - Polymorphic pairs:

    ```sql
    SELECT a.table_name, a.column_name
    FROM information_schema.columns a
    JOIN information_schema.columns b
      ON a.table_name = b.table_name
     AND b.column_name = regexp_replace(a.column_name, '_type$', '_id')
    WHERE a.column_name ~ '_type$';
    ```

  - grep for `polymorphic: true|GenericForeignKey[(]|commentable_type|taggable_type`.
  - EAV: tables whose columns are (key|name|attribute) plus value plus an entity FK; also sqlcheck.
- **Tools:** psql, sqlcheck, ripgrep.
- **Applies to:** Any relational schema, especially Rails and Django apps with tagging, comments, audit tables or settings tables.
- **When not to apply / counterpoints:** There are legitimate uses (audit logs, generic attachments). JSONB is often the pragmatic middle ground. A redesign is a migration project, not a hardening edit.
- **Fix risk:** high

### G209-F17 — Flag SELECT * in hand-written SQL as a low-priority maintainability and performance item, not an integrity issue
- **Grade:** B · **Verdict:** CORRECTED. Scope details added:
  - Muse et al. studied 150 **Java** projects (Android DB API, JDBC, JPA, Hibernate).
  - The 70% and 15% unused-column figures come from manually inspecting 98 smells in 10 projects.
  - In SQLCheck, "Implicit Columns" (INSERT without a column list, 26,488 instances) was more frequent than "Column Wildcard Usage" (12,313 of 63,058).
- **Rationale:**
  - Muse: Implicit Columns is the most prevalent SQL smell, with a median prevalence of 1.67%.
  - Of the inspected smelly queries, at least 70% fetched 3 or more unused columns and 15% fetched 9 or more.
  - SQL smells "(e.g., Implicit Columns, Fear of the Unknown) do not have statistically significant association with software bugs".
  - 80.5% of affected files kept the smell in every snapshot.
  - sqlfluff AM04: the column "number or ordering ... changes if the upstream table's schema changes".
- **Evidence:**
  - [On the Prevalence, Impact, and Evolution of SQL Code Smells in Data-Intensive Systems](https://arxiv.org/abs/2201.02215) — Muse, Rahman, Nagy, Cleve, Khomh, Antoniol, MSR 2020 (DOI 10.1145/3379597.3387467) — peer_reviewed — "median prevalence of 1.67%"; "at least 70% of these smelly SQL queries retrieved three or more columns that were unused and 15% retrieved nine or more"; "do not have statistically significant association with software bugs"; "80.5% of source code files with Implicit Columns smell contained this smell in all snapshots" — verified in the PDF.
  - [SQLCheck](https://arxiv.org/abs/2004.10232) — Dintyala, Narechania, Arulraj, SIGMOD 2020 — peer_reviewed — 1406 repositories, "around 174 thousand" statements; Column Wildcard Usage 12313, total 63058; "48% fewer false positives and 20% fewer false negatives than dbdeo" — verified in the PDF.
  - [SQLFluff rules (AM04)](https://docs.sqlfluff.com/en/stable/reference/rules.html) — SQLFluff (4.3.0 current) — tool docs — "Query produces an unknown number of result columns"; "the number or ordering of columns changes if the upstream table's schema changes" — verified.
  - [SQL Antipatterns, Volume 1](https://pragprog.com/titles/bksap1/sql-antipatterns-volume-1/) — Bill Karwin, 2022 — book, confirmed via the publisher page — chapters "Implicit Columns" and "Fear of the Unknown" — verified.
- **Detect:**
  - `sqlfluff lint --dialect postgres --rules AM04 sql/`
  - `sqlcheck -f queries.sql`
  - grep for `SELECT +[*]|SELECT +[a-z_]+[.][*]`.
  - ORMs: wide JSON or blob columns fetched in hot paths without only(), values(), load_only() or a projection.
- **Tools:** sqlfluff, sqlcheck (dormant since 2024), ripgrep.
- **Applies to:** Hand-written SQL: sqlc, sqlx, raw drivers, views, dbt.
- **When not to apply / counterpoints:**
  - Weak link to bugs, so do this after F01–F04.
  - SELECT * is fine in EXISTS subqueries and ad-hoc queries.
  - Replacing * can silently drop fields from generic serializers, and breaks code that reads columns by position.
- **Fix risk:** medium

## Practitioner voice
- [Yang et al.: Redmine and Diaspora cases](https://hyperloop-rails.github.io/278.pdf) — Redmine's three layers disagreed on the wiki title (HTML `.+`, model max 60, DB varchar(30)). A title a little under 60 characters crashed the page "with all the filled content lost". In Diaspora, a tighter password rule locked out users with short passwords behind "Please use the required format".
- [thoughtbot: The Perils of Uniqueness Validations](https://thoughtbot.com/blog/the-perils-of-uniqueness-validations) — Rails uniqueness validation is SELECT-then-INSERT and races. The fix is a unique index plus rescuing RecordNotUnique; has_one needs a unique index too.
- [GitLab: Foreign keys](https://docs.gitlab.com/development/database/foreign_keys/) — Missing FK indexes "led to incidents where deleting projects and namespaces times out". GitLab requires an index for every FK and ON DELETE (CASCADE in 99% of cases), and forbids `dependent: :destroy`.
- [Cybertec: Index your foreign key](https://www.cybertec-postgresql.com/en/index-your-foreign-key/) — DELETE on the parent took 154 ms without the index and 0.75 ms with it; a join took 361 ms versus 0.15 ms. Advice: create the missing indexes, wait, then drop the unused ones.
- [Haki Benita: 20GB of unused index space](https://hakibenita.com/postgresql-unused-index-size) — A 769MB index on a mostly-NULL FK became under 5MB as a partial index. More than 70GB was freed without dropping any index. The unused-index check depends on when the stats were last reset, and space freed on the primary is also freed on each replica.
- [Brandur: Postgres Job Queues & Failure By MVCC](https://brandur.org/postgres-queues) — At Heroku, an analytics transaction on a follower stalled the job queue until it was killed. A controlled reproduction then showed lock times reaching about 15x normal, 60k queued jobs after an hour and nearly 100k dead rows. Lessons: kill old transactions, and statement_timeout alone is insufficient.
- [PlanetScale: Concurrency vs. Throughput](https://planetscale.com/blog/concurrency-vs-throughput-vitess-mysql) — 2026 incident. A 15-minute batch transaction, plus a Vitess transaction-pool cap raised to 10,000 "because it made the errors stop", gave 1,400 errors a minute and a tenth of the requested throughput. Restoring a cap near 1,000 later handled about 60k QPS with no errors.
- [PlanetScale: Poisoned Postgres connection pools](https://planetscale.com/blog/postgres-poisoned-connection-pools) — 2026. `default_transaction_read_only` leaked through a pooler and later writes failed with 25006. The quick fix is `DISCARD ALL`; prevention is avoiding session-level SET.
- [Lobsters: Does anyone run Postgres without PgBouncer?](https://lobste.rs/s/xic1nn/does_anyone_run_postgres_without) — 2026, split views:
  - "eventually hit a wall that running pgbouncer in transaction mode took care of";
  - "The largest application we run needs 30 connections";
  - a provider employee: "The biggest single cause of database tickets by far is customers using the pg bouncer connection for workloads that are not suitable for it". Their examples: search_path scripts, Prisma, pg_dump, "literally anything that uses set";
  - one team removed PgBouncer "after a production incident in which it was holding some transactions open for hours".
- [Lobsters: Concurrency vs. Throughput](https://lobste.rs/s/pe58bh/concurrency_vs_throughput_why_more) — user snej: "Funny that reads time out after 90 seconds, but a transaction can stay open for fifteen minutes without being canceled". Timeouts are often set inconsistently.
- [Fractaled Mind: SQLite on Rails](https://fractaledmind.com/2024/04/15/sqlite-on-rails-the-how-and-why-of-optimal-performance/) — With default deferred transactions, 4 concurrent requests already produced 500s from SQLITE_BUSY: a busy timeout cannot help when the lock upgrade fails mid-transaction. IMMEDIATE transactions removed nearly all errors, and a GVL-releasing busy handler flattened long-tail latency at about 0.5 s.
- [Heap: When To Avoid JSONB](https://www.heap.io/blog/when-to-avoid-jsonb-in-a-postgresql-schema) — Heap stores customer properties in JSONB. A query was about 2,000x slower (584 s vs 300 ms) because the planner has no JSONB statistics. Extracting 45 common fields saved about 30% of disk. (The earlier gist's "moved from EAV" story is not in the source and was removed.)
- [Jon Skeet: Storing UTC is not a silver bullet](https://codeblog.jonskeet.uk/2019/03/27/storing-utc-is-not-a-silver-bullet/) — Future local times go wrong when tz rules change. Store local time plus zone ID and treat UTC as derived.
- [PlanetScale: Operating without foreign key constraints](https://planetscale.com/docs/learn/operating-without-foreign-key-constraints) — "MySQL foreign keys introduce increased locking for data and metadata changes"; FKs complicate refactoring and sharding. PlanetScale can enable FKs but still does not recommend them.
- [gh-ost requirements and limitations](https://github.com/github/gh-ost/blob/master/doc/requirements-and-limitations.md) — "Foreign key constraints are not supported. They may be supported in the future, to some extent."
- [SQLModel issue #52](https://github.com/fastapi/sqlmodel/issues/52) — Users were surprised that `table=True` models skip validation. The maintainer says table models "can't do validation on instantiation" and points to separate data models (the multiple-models tutorial). Community workarounds (`validate_assignment=True`) have their own pitfalls.
- [Lobsters: Don't Do This](https://lobste.rs/s/m4f2ke/don_t_do_this) — A reader asked for "a tool that does database query and schema linting"; another nearly used BETWEEN for date filters. squawk and schemalint now encode many of these rules.

## Contradictions and open questions

**Contradictions**
- **Foreign keys.**
  - For: GitLab requires DB FKs with ON DELETE. Yang (ICSE'20), CFinder (ASPLOS'23) and SQLCheck (1,389 "No Foreign Key") show that missing DB constraints cause real bugs.
  - Against: PlanetScale discourages FKs, and gh-ost does not support them (MySQL locking, online schema change, sharding). GitLab itself uses loose FKs where references cross databases.
  - Both hold in their own contexts, so the pass reports rather than imposes.
- **varchar(n).** The PG wiki says don't use it *by default*, but "varchar(n) is great" when the limit is real. Yang shows that conflicting app/DB lengths crash pages, and drizzle-zod derives `z.max()` from varchar lengths. So "relax the DB" and "align the DB" are competing fixes, and the choice depends on whether the limit is a business rule.
- **SELECT \*.** Karwin, sqlfluff AM04 and SQLCheck flag it (12,313 wildcard instances). Muse et al. found no statistically significant association with bugs, in 150 Java projects. The evidence supports a low priority, not zero.
- **Timestamps.** The PG wiki, squawk and schemalint say timestamptz. Skeet shows that storing UTC is wrong for future civil times. The wiki itself allows `timestamp` for values used abstractly, with no arithmetic.
- **SQLite synchronous=NORMAL.** This is less a contradiction than it first looked. Both Litestream and SQLite recommend NORMAL in WAL mode ("best balance ... for most applications"). SQLite adds that it "does lose durability" across power loss or an OS crash, not across application crashes. Use FULL for fund or order state where the last commit must survive power loss.
- **Unused indexes.** Static tools (DbDeo) report many, but more than 77% of their index-abuse findings were the unused-index variant, which is prone to false positives. Only runtime stats over a known window on all nodes are trustworthy, and indexes that enforce constraints must be kept regardless.
- **Cascades.** GitLab wants DB-level ON DELETE CASCADE and forbids Rails `dependent: :destroy`. Prisma relationMode="prisma" and many ORMs emulate cascades in app code, which raw SQL and bulk deletes bypass.
- **Pool sizing.** HikariCP and the PG wiki formula say small pools. PlanetScale's 2026 incident supports server-side admission caps: raising the Vitess transaction-pool cap made things worse. Some Lobsters practitioners run fine at 30 connections without a pooler; others "hit a wall". The formula dates from 2014 and the spinning-disk era.
- **Django null on strings.** The docs say avoid null=True on CharField, but a CharField with both unique=True and blank=True needs null=True to avoid unique violations on blank values. A blanket rule would break that case (verified in the 5.2 field reference).

**Open questions**
- No empirical study measures cross-layer constraint drift in Python or TypeScript stacks (pydantic/FastAPI, zod/tRPC, Prisma/Drizzle, OpenAPI). Yang covers 12 Rails apps, CFinder 8 web apps, and the EMSE study Java constraint clones only.
- No open-source equivalent of database_consistency or active_record_doctor was found for SQLAlchemy, Prisma or Drizzle, so the skill may need its own diff script.
- Hacker News and Reddit were not reached (the researcher hit HN 429s and a Reddit block, and the verifier's search budget ran out). Practitioner voice therefore rests on Lobsters, engineering blogs and incident write-ups.
- Prisma is mid-transition: v7 is documented, v8 is in RC with a new dotted error namespace, and pool defaults moved to driver adapters in v7. Prisma detection patterns must be version-gated.
- `atlas migrate lint` is Pro-only since v0.38, and squawk covers Postgres only. The best free DDL linter for MySQL and SQLite is still open.
- Good timeout and pool values for bot or trading workloads are unmeasured; 30–60 s and cores*2+spindles are heuristics.
- The Smelly Relations and SQLCheck prevalence numbers come from regex extraction of embedded SQL (2018–2020). No 2024–2026 replication on ORM-heavy codebases was found.
- SQLite has no documented migration playbook for converting existing tables to STRICT, or for turning on foreign_keys when ON DELETE CASCADE clauses have been dormant for years.
- The detection SQL written for this dossier (F03, F04, F05, F18) was not executed against a live Postgres during verification. Only the SQLite claims were reproduced locally.

## Dropped findings
None. All 22 findings survived. Ten were corrected in place; the details are in each finding's verdict line.
