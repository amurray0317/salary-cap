# Known Limitations

Honest list of what this release does **not** do, per the "do not claim a feature works unless
it is implemented" rule.

## Cap accounting

- **Season-level accounting only.** No daily proration, no in-season accrual of cap space
  toward the trade deadline. Deadline-space projection is on the roadmap and requires daily
  accounting.
- **LTIR is simplified**: relief equals the injured player's hit (optionally capped by a pool
  input). Real pool establishment (relative to cap space on placement day) is not modeled.
- **Buyouts are simplified**: dead cap = remaining hit × fraction per remaining season; no
  age-dependent ⅓/⅔ rates and no spread years beyond the contract's original term.
- **Performance bonuses** are charged as scheduled cash; no bonus-overage carryover to the
  next season.
- Waiver eligibility is tracked as a status + games threshold rule but call-up/send-down
  simulations do not yet block on waiver-required players — they surface status only.
- No arbitration awards, qualifying-offer amounts, offer-sheet compensation, or entry-level
  slide rules yet (statuses are tracked; math is roadmap).
- Weekly-payroll and daily-cap league types exist in the schema but have no engine yet.

## Scenarios

- **Applying a scenario to official data is not implemented.** Scenarios remain overlays; the
  `applied` status exists in the enum but no action performs the mutation. This is deliberate:
  partial apply would risk corrupting official records.
- No undo/redo stack inside the builder (transactions can be disabled/removed instead).
- Multi-team trade modeling is limited to this team's side (out with retention / in with
  retention); draft-pick trades are recorded descriptively, not valued.

## Data & imports

- **No CSV import UI yet.** The `imports`/`import_errors` tables and provenance model exist;
  the mapping/validation interface is roadmap. Seeding is the current bulk-load path.
- No file storage (player documents) yet despite the schema field.
- Free agents are tracked per organization (scouting records), not as a shared league pool.

## College / NIL

- Schema-only (schools, conferences, college teams, athletes, scholarships, allocations,
  institutional payments, NIL agreements/valuations). No UI, no engine, no seed data. Nothing
  in the product claims otherwise.

## Models

- v0.1 valuation models are transparent heuristics on fictional data — not validated, and
  labeled as estimates everywhere. See docs/MODELS.md.

## Platform

- Roster optimization (OR-Tools/PuLP) not built yet; schema reserved.
- AI assistant not built yet; provider abstraction reserved via env vars.
- No user invitation flow (members are seeded or created via registration; role management UI
  is minimal read-only).
- PDF export is browser-print based; server-side PDF rendering is roadmap.
- Shareable read-only report links: `reports.share_token` exists, route not yet implemented.
- Rate limiting is not implemented (abstraction point noted in middleware roadmap).
- PGlite local mode is single-process: run one server per `.data` directory. `db:seed` refuses
  to run against `DATABASE_URL` as a guard.
- The embedded demo database ships unencrypted fictional data only.
