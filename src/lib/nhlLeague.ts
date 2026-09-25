/**
 * The NHL's published cap figures and season dates, used when an
 * organization is set up as a real NHL club. Every number has a source;
 * seasons whose figures are not yet announced are not created.
 *
 * Sources: NHL/NHLPA team payroll ranges (NHL.com, June 2026; agreed January
 * 2025) for upper/lower limits; 2025 CBA Memorandum of Understanding for
 * league minimum salaries; NHL stats API (/stats/rest/en/season) for dates;
 * CBA 50.5(d) for buried-contract relief (league minimum + $375,000) and
 * 50.6 for the individual maximum (20% of the upper limit).
 */
export interface NhlSeasonFacts {
  name: string;
  startDate: string;
  endDate: string;
  regularSeasonEnd: string;
  games: number;
  upperLimit: number;
  lowerLimit: number;
  minSalary: number;
  /** True when dates are the league's published dates, false when estimated. */
  datesPublished: boolean;
}

export const NHL_SEASON_FACTS: NhlSeasonFacts[] = [
  {
    name: "2025-26",
    startDate: "2025-10-07",
    endDate: "2026-06-15",
    regularSeasonEnd: "2026-04-17",
    games: 82,
    upperLimit: 95_500_000,
    lowerLimit: 70_600_000,
    minSalary: 775_000,
    datesPublished: true,
  },
  {
    name: "2026-27",
    startDate: "2026-10-06",
    endDate: "2027-06-10",
    regularSeasonEnd: "2027-04-10",
    games: 84,
    upperLimit: 104_000_000,
    lowerLimit: 76_900_000,
    minSalary: 850_000,
    datesPublished: true,
  },
  {
    name: "2027-28",
    startDate: "2027-10-05",
    endDate: "2028-06-15",
    regularSeasonEnd: "2028-04-15",
    games: 84,
    upperLimit: 113_500_000,
    lowerLimit: 83_900_000,
    minSalary: 900_000,
    datesPublished: false,
  },
];

export const NHL_RULE_SOURCE =
  "NHL/NHLPA payroll ranges (NHL.com, June 2026); 2025 CBA MOU minimum salaries; CBA 50.5(d) buried relief, 50.6 maximum salary";

export function nhlRules(f: NhlSeasonFacts) {
  return [
    { key: "cap.upper_limit", name: "Salary cap upper limit", category: "cap", value: f.upperLimit },
    { key: "cap.lower_limit", name: "Salary cap lower limit (floor)", category: "cap", value: f.lowerLimit },
    { key: "cap.buried_allowance", name: "Buried-contract cap relief allowance (above league minimum)", category: "cap", value: 375_000 },
    { key: "roster.max_active", name: "Maximum active roster size", category: "roster", value: 23 },
    { key: "roster.min_active", name: "Minimum active roster size", category: "roster", value: 20 },
    { key: "roster.min_goalies", name: "Minimum goaltenders on active roster", category: "roster", value: 2 },
    { key: "contract.max_slots", name: "Maximum standard player contracts", category: "contract", value: 50 },
    { key: "salary.min", name: "League minimum salary", category: "salary", value: f.minSalary },
    { key: "salary.max_individual_pct", name: "Maximum individual cap hit (% of upper limit)", category: "salary", value: 20 },
  ];
}
