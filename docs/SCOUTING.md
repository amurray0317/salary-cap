# Amateur Scouting Module (NCAA D-I Men's Hockey)

Architecture extension for the amateur-scouting vertical, following every existing
RosterIQ convention: pure versioned engines, org-scoped data, capability-tier
permissions, reused import pipeline, reused audit log.

## Principles

- **Decision support, never replacement.** Statistically inferred roles, trends, and
  fit scores are versioned estimates shown WITH confidence, explanations, and
  contradicting evidence. Scout-assigned roles are stored separately and treated as
  authoritative wherever both exist (e.g. the fit engine).
- **No fabricated data.** NCAA time-on-ice is unavailable; `prospect_seasons.toi_seconds`
  is nullable, per-60 rates are only computed when it exists, and every derived stat
  reports its missing inputs instead of imputing them.
- **Weights are data.** Role-scoring weights live in `role_metric_weights`
  (per archetype, per metric, versioned, effective-dated) — never in components.

## Architecture

```
src/lib/scouting/          pure engines
  archetypes.ts            34-archetype catalog + seed weights (runtime reads DB)
  stats.ts                 derived stats, position-relative percentiles, age adjustment
  trends.ts                riq-trend-v0.1 — YoY / split-half / last-5/10 classifiers
  roleScoring.ts           riq-role-v0.1 — transparent weighted percentile scoring
  fit.ts                   riq-fit-v0.1 — explainable need↔prospect fit
src/server/services/scoutingService.ts   input assembly + persistence (setDbForTesting-testable)
src/server/actions/scoutingActions.ts    zod-validated, audited mutations
src/app/(app)/scouting/*                 12 pages under a shared sub-nav layout
```

The fit engine's opportunity-path component reads **live RosterIQ contract data**
(active contracts at the needed position; expirations within the need's timeline).

## Permissions

Scouting capabilities ride the existing cumulative tier model (`src/lib/auth/roles.ts`):
view (tier 0, incl. read-only executives) → report/edit prospects/watchlists (tier 1:
regional + crossover scouts) → manage draft boards (tier 3: assistant director,
analysts) → assign scouts + manage needs (tier 4: director, GM) → manage models
(tier 5: org admin). New roles: `scouting_director`, `scouting_asst_director`,
`crossover_scout`.

## Model cards (v0.1 — transparent heuristics, not validated models)

| Model | Method | Confidence handling |
|---|---|---|
| riq-trend-v0.1 | Threshold rules on YoY PPG (±), shot volume, PP share, sample size, age; decline outranks PP-share growth so shrinking totals can't masquerade as role expansion | `insufficient_sample` below 10 GP; small-sample spike below 15 GP |
| riq-role-v0.1 | Position-relative percentiles (peer pool = same org, same season, same position group, ≥5 GP) × normalized DB weights; rescaled over covered weight | Confidence = covered weight × pool factor, capped at 0.90; missing metrics listed, never imputed; core metrics ≤25th pct flagged as contradicting evidence |
| riq-fit-v0.1 | Weighted components: position .20, role .25, handedness .10, timeline .15, opportunity .15 (live contracts), risk .15 | Null components excluded and warned; partial coverage flagged |

## Assumptions & data limitations

1. Season-level NCAA stats; no schedule-strength/conference-strength adjustment yet
   (conference-relative percentiles are roadmap — the pool mechanism supports it).
2. Age adjustment is a ±8%/year heuristic around age 21, clamped ±30%, labeled estimate.
3. `physicality` percentile proxies PIM/game (no tracking data); labeled as such in
   the weight table and inherently weak for skill evaluation.
4. Goalie statistical inference is intentionally low-signal without save data;
   goalie archetypes lean on games-share and scout input.
5. Prospect pools are org-scoped: percentiles reflect the prospects an organization
   tracks, not all of college hockey. Import more prospects for better pools.
6. Comparables are same-age NCAA statistical neighbors within the org pool;
   professional-outcome comparables require licensed historical data (roadmap).
7. Draft-status and rights data are user-entered/imported and provenance-tracked;
   no scraping.
8. Reserved schema (projection models/versions, tracking metrics, video links,
   documents, scout/consensus rankings, viewings) ships without UI in this slice.

## CSV import

Two new gated import types reuse the full pipeline (templates → mapping →
row-level validation → preview → approval): `ncaa_players` (school must match an
existing school record) and `ncaa_season_stats` (prospect must exist; ambiguous
names rejected; >4 PPG rejected as implausible; blank TOI stays blank).
