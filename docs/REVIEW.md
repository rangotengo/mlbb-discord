# Integration review

Reviewed the combined working tree on 28 October 2026 before committing. This includes the existing Challengermode migration and the subsequent backend, dashboard, desktop, and documentation changes.

## Findings corrected

- **Identity isolation:** Requesting an email code no longer changes enrolment ownership. Successful verification applies only to the email proven by the challenge, and imported Discord IDs no longer automatically verify a participant.
- **OTP accounting:** Failed delivery no longer consumes the successful-send allowance. New challenges invalidate previous challenges for the account/guild. Consumption also checks the digest, expiry, and attempt limit to avoid consuming a replacement challenge.
- **Dashboard integration:** The actual server now accepts the settings form's CSRF field, removes it before validating settings, and still rejects missing/incorrect tokens. Password changes correctly indicate that a restart is required.
- **Production schema:** Added frozen SQLite/PostgreSQL table definitions and a migration that creates missing tables, including verification challenges, without production schema synchronisation. Corrected date-column types for PostgreSQL.
- **Restore safety:** The live SQLite restore endpoint rejects restoration with HTTP 409. Restore while the application is stopped so the next SQL.js autosave cannot overwrite restored data.
- **Import integrity:** All-or-nothing imports now use database transactions and roll back on write failure. Schedule imports validate match ownership when provider credentials are configured.
- **Desktop credentials:** Retained secrets are decoded and re-encoded when storage modes change. Unreadable encrypted values are never treated as plaintext or silently overwritten. Linux `basic_text` is not labelled OS-backed secure storage.
- **Packaging:** Installers no longer include the local `data/` directory, avoiding accidental distribution of event databases.
- **Truthful UI/docs:** Unimplemented job/team counters report unknown rather than zero. Privacy and support descriptions now reflect available capabilities. Corrected frontend lint errors.

## Verification

- `npm test`: 169 tests passed, including backend and desktop/renderer compilation.
- `npm run lint`: passed.
- `node docs/links.test.cjs`: passed (20 files checked).
- `node docs/commands.test.cjs`: passed (27 prefix and 10 slash commands).
- `git diff --check`: passed.

Regression checks exercise the actual dashboard authentication/bootstrap/CSRF middleware, fresh production-style SQLite migrations, missing verification-table recovery, email-specific verification, failed-delivery accounting, secret storage transitions, and transactional import rollback.

## Remaining limitations

This is a reviewed implementation increment, not completion of all 33 roadmap items. [The tracker](improvement-tracker.md) records partial and unstarted work.

- Multi-user dashboard accounts, per-guild web access, durable jobs, persistent audit events, automated retention/privacy export, and several participant/product extensions remain unimplemented.
- Hosted sessions and login throttling are process-local. The SQLite duplicate-open guard is also process-local; run only one bot process per database file. Desktop single-instance handling does not prevent a separately launched server process.
- Real PostgreSQL migration execution, authenticated provider/Discord journeys, and signed packaged installers were not validated here. SQLite migration tests and PostgreSQL-compatible metadata do not replace an actual PostgreSQL upgrade rehearsal.
- Existing historical verification records are retained. Organisers should review legacy account links established through the old name-based check-in flow.
- No live accounts, local credentials, deployment, or remote push were used for this review.
