# Product Roadmap

## R1 (shipped) — NHL-style cap MVP
Versioned rules engine, cap dashboard with explainable calculations, contracts with per-season
schedules, isolated scenario simulator (sign/trade±retention/assignments/IR/extension/buyout),
scenario comparison, valuation v0.1 + surplus value, compliance checks, CSV + printable
reports, role-based access, audit log, seeded fictional demo.

## R2 — Cap depth
- Daily cap accounting + trade-deadline space projection
- Real LTIR pool mechanics; bonus overage carryover
- Age-accurate buyout schedules with spread years
- Waiver blocking in simulations; qualifying offers & arbitration estimates
- Apply-scenario-to-official with preview, confirmation, and full audit trail
- CSV import UI (templates, field mapping, row-level validation, approval gate)
- Shareable read-only report links; server-side PDF

## R3 — Multi-league organizations
- AHL rules + affiliate reimbursement; ECHL weekly payroll engine
- Organizational depth chart across NHL/AHL/ECHL with cascading moves
- Draft-pick inventory & pick valuation
- League-office views (league-wide compliance)

## R4 — Analytics
- Roster optimization service (Python FastAPI + OR-Tools MIP) behind a job abstraction
- Regression-based market model with backtesting on licensed data; model registry UI
- Monte Carlo roster simulations; trade-value model

## R5 — College vertical
- NCAA roster planner UI (roster limits, scholarship equivalents, allocations)
- Institutional athlete-payment budgeting; compliance exports
- NIL market-value estimator (labeled estimates, comparable athletes)
- Transfer-portal scenarios; retention modeling

## R6 — Platform
- AI front-office assistant: deterministic query layer first, LLM behind provider abstraction,
  org-scoped retrieval with citations and confirmation gates
- Public API; licensed data-provider integrations; subscription billing; mobile apps
