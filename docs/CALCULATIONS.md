# Cap Calculations Reference

All formulas implemented in `src/lib/engine/capEngine.ts`; all rule parameters come from
versioned `league_rules` rows — never constants in code. Worked examples use the seeded BHL
2025-26 parameters: upper limit $88,000,000, floor $65,000,000, minimum salary $800,000,
buried allowance $1,150,000.

## Effective cap hit

```
effectiveCapHit = round(capHit × (1 − retainedByOthersPct))
```
A $6,000,000 hit with 50% retained by the sending team charges $3,000,000.

## Total cap charge

```
totalCapCharge =
    Σ active-roster effective hits        (pro_active, pro_scratch, suspended)
  + Σ IR and LTIR effective hits          (injured_reserve, ltir)
  + Σ buried charges                      (minor, loaned)
  + Σ retained-salary obligations
  + Σ dead-cap obligations                (buyout, termination, recapture)
  − LTIR relief
capSpace = upperLimit − totalCapCharge    (negative = over the cap)
```

## Buried contracts

```
buriedThreshold = minSalary + buriedAllowance          ($800k + $1.15M = $1.95M)
buriedCharge    = max(0, effectiveCapHit − buriedThreshold)
```
A $2.75M contract in the minors charges $800,000; a $1.5M contract charges $0.

## LTIR (simplified model)

LTIR hits still count in the charge, and the team receives relief:
```
ltirRelief = min(ltirPool ?? Σ LTIR hits, Σ LTIR hits)
```
i.e. by default an LTIR placement fully offsets that player's hit. Real NHL LTIR pool
mechanics (pool set at placement time relative to that day's cap space) are on the roadmap;
the simplification is labeled in the line item.

## Regular IR

Counts against the cap in full. No relief. (Roster-count relief only: IR players don't count
toward the active-roster maximum.)

## Retained salary in trades (scenario projector)

Trading out contract C with retention r creates, for every remaining season of C:
```
obligation(retained) = round(capHit_season × r)
```
and removes C's hits. Trading in a player with retention-by-others r charges
`capHit × (1 − r)` (see effective cap hit).

## Buyout (simplified)

For each remaining season: contract removed, dead-cap obligation
`round(capHit × deadCapFraction)` added (default ⅔). Real age-dependent spread-year buyout
schedules are on the roadmap; the projector emits an info note stating the simplification.

## Compliance checks

| Check | Rule key | Severity |
|---|---|---|
| Cap charge > upper limit | `cap.upper_limit` | blocking |
| Cap charge < floor | `cap.lower_limit` | warning |
| Active roster > max | `roster.max_active` | blocking |
| Active roster < min | `roster.min_active` | warning |
| Goalies on active roster < min | `roster.min_goalies` | warning |
| Contracts > slot limit | `contract.max_slots` | blocking |
| Individual hit > pct of upper limit | `salary.max_individual_pct` | blocking |
| Base salary < league minimum | `salary.min` | warning |
| Season missing a cap rule | `cap.upper_limit` | warning |

Every violation includes the rule name, version, effective date, financial impact where
meaningful, and a suggested resolution.

## Surplus value

```
expectedSurplusValue = estimatedPerformanceValue − actualCapHit
```
Example (from the product spec): performance value $6,200,000, cap hit $4,000,000 →
surplus +$2,200,000.

## Explainability contract

Every dollar in `totalCapCharge` appears in exactly one `CapLineItem` with: label, category,
amount, human-readable formula string, the input records (contract/obligation ids), and the
rule key where a threshold applied. The dashboard renders the full table; tests assert the
line-item invariants.
