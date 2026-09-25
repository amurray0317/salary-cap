/**
 * Team game-state splits from the NHL stats REST reports (api.nhle.com):
 * power play, penalty kill, 5v5, 4v4, 3v3, empty net, shootout, faceoffs by
 * zone, and results by score state. Official league numbers, joined on the
 * NHL team id; rates are derived here and nowhere else.
 *
 * Definitions worth knowing:
 *  - "5v4 goals" in the power-play report (goals5v4) count goals during a
 *    5-on-4 penalty; the by-strength report (goalsFor5On4) counts goals by who
 *    was on the ice. They differ by a few a season (e.g. a pulled goalie
 *    during a power play). Per-60 rates here use the by-strength goals over
 *    the power-play report's 5v4 time, the same pairing as the xG rates.
 *  - PP% = power-play goals / opportunities; PK% = 1 − PP goals against /
 *    times shorthanded. "Net" versions subtract shorthanded goals the other way.
 *  - PDO = 5v5 shooting % + 5v5 save %.
 */
import { ConnectorParseError, isObject } from "@/lib/connectors/util";
import { NHL_STATS } from "@/lib/connectors/nhl";

export const TEAM_REPORTS = [
  "powerplay",
  "penaltykill",
  "powerplaytime",
  "penaltykilltime",
  "goalsforbystrength",
  "goalsagainstbystrength",
  "shootout",
  "percentages",
  "faceoffpercentages",
  "leadingtrailing",
  "scoretrailfirst",
  "goalsbyperiod",
  "realtime",
] as const;
export type TeamReport = (typeof TEAM_REPORTS)[number];

export function teamReportUrl(report: TeamReport, seasonId: string, gameTypeId: 2 | 3): string {
  if (!/^\d{8}$/.test(seasonId)) throw new ConnectorParseError("Invalid season id");
  const exp = encodeURIComponent(`seasonId=${seasonId} and gameTypeId=${gameTypeId}`);
  return `${NHL_STATS}/team/${report}?isAggregate=false&isGame=false&start=0&limit=-1&cayenneExp=${exp}`;
}
export const teamIndexUrl = () => `${NHL_STATS}/team`;

type Row = Record<string, unknown>;
const n = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const div = (a: number | null, b: number | null) => (a === null || b === null || b === 0 ? null : a / b);
/** Count per 60 minutes of `seconds`. */
const per60 = (count: number | null, seconds: number | null) => div(count, seconds === null ? null : seconds / 3600);
const sum = (...xs: Array<number | null>) => (xs.some((x) => x === null) ? null : xs.reduce<number>((a, b) => a + b!, 0));

export interface XgSplit {
  xgf: number;
  xga: number;
}

export interface TeamSituations {
  teamId: string;
  team: string;
  name: string;
  gp: number;
  record: { w: number | null; l: number | null; otl: number | null; pts: number | null };
  pp: {
    pct: number | null;
    netPct: number | null;
    opportunities: number | null;
    goals: number | null;
    shGoalsAgainst: number | null;
    toiPerGame: number | null;
    goals5v4: number | null;
    opportunities5v4: number | null;
    toi5v4: number | null;
    pct5v4: number | null;
    goals5v3: number | null;
    opportunities5v3: number | null;
    /** Goals per 60 at 5-on-4 (by-strength goals over 5v4 time). */
    gf60_5v4: number | null;
    xgf60_5v4: number | null;
  };
  pk: {
    pct: number | null;
    netPct: number | null;
    timesShorthanded: number | null;
    goalsAgainst: number | null;
    shGoalsFor: number | null;
    toiPerGame: number | null;
    goalsAgainst4v5: number | null;
    toi4v5: number | null;
    pct4v5: number | null;
    goalsAgainst3v5: number | null;
    timesShorthanded3v5: number | null;
    ga60_4v5: number | null;
    xga60_4v5: number | null;
  };
  /** PP% + PK%, the usual special-teams index (above 100% is better than average). */
  specialTeamsIndex: number | null;
  ev5: {
    gf: number | null;
    ga: number | null;
    gfPct: number | null;
    xgf: number | null;
    xga: number | null;
    xgfPct: number | null;
    toiPerGame: number | null;
    gf60: number | null;
    ga60: number | null;
    xgf60: number | null;
    xga60: number | null;
    satPct: number | null;
    satPctClose: number | null;
    satPctAhead: number | null;
    satPctBehind: number | null;
    shootingPct: number | null;
    savePct: number | null;
    pdo: number | null;
    ozStartPct: number | null;
  };
  other: {
    gf4v4: number | null;
    ga4v4: number | null;
    gf3v3: number | null;
    ga3v3: number | null;
    /** Goals scored into the opponent's empty net. */
    gfEmptyNet: number | null;
    /** Goals allowed into your own empty net. */
    gaEmptyNet: number | null;
    /** Goals scored with your goalie pulled for an extra attacker. */
    gfExtraAttacker: number | null;
    /** Goals allowed while the opponent had an extra attacker. */
    gaExtraAttacker: number | null;
    penaltyShotGoals: number | null;
  };
  shootout: {
    games: number | null;
    wins: number | null;
    losses: number | null;
    winPct: number | null;
    goals: number | null;
    shots: number | null;
    shootingPct: number | null;
    goalsAgainst: number | null;
    shotsAgainst: number | null;
    savePct: number | null;
  };
  faceoffs: {
    total: number | null;
    pct: number | null;
    ozPct: number | null;
    oz: number | null;
    nzPct: number | null;
    dzPct: number | null;
    dz: number | null;
    evPct: number | null;
    ppPct: number | null;
    shPct: number | null;
  };
  score: {
    firstGames: number | null;
    firstWinPct: number | null;
    trailFirstGames: number | null;
    trailFirstWinPct: number | null;
    winPctLead1: number | null;
    winPctLead2: number | null;
    winPctTrail1: number | null;
    winPctTrail2: number | null;
    /** Comeback wins: games won after trailing after two periods. */
    winsTrail2: number | null;
    /** Blown leads: regulation losses after leading after two periods. */
    lossLead2: number | null;
  };
  periods: { gf: Array<number | null>; ga: Array<number | null> };
  physical: { hits60: number | null; takeaways60: number | null; giveaways60: number | null; blocks60: number | null };
}

function rows(json: unknown, report: string): Row[] {
  const data = isObject(json) ? json.data : undefined;
  if (!Array.isArray(data)) throw new ConnectorParseError(`NHL team ${report}: missing data array`);
  return data.filter(isObject);
}

/** /stats/rest/en/team → team id → tri-code. */
function teamCodes(json: unknown): Map<string, string> {
  const map = new Map<string, string>();
  for (const r of rows(json, "index")) {
    if (n(r.id) !== null && typeof r.triCode === "string") map.set(String(r.id), r.triCode);
  }
  return map;
}

/**
 * The reports (keyed by name) and the team index → one row per team.
 * `xg` (optional): our model's 5v5 / 5v4 / 4v5 xG by tri-code.
 */
export function parseTeamSituations(
  reports: Record<TeamReport, unknown>,
  teamIndex: unknown,
  xg: Map<string, { ev5?: XgSplit; pp?: XgSplit; pk?: XgSplit }> = new Map(),
): TeamSituations[] {
  const codes = teamCodes(teamIndex);
  const by = Object.fromEntries(TEAM_REPORTS.map((r) => [r, new Map(rows(reports[r], r).map((row) => [String(row.teamId), row]))])) as Record<
    TeamReport,
    Map<string, Row>
  >;
  const ids = [...by.powerplay.keys()];
  if (ids.length === 0) return [];
  return ids.map((id) => {
    const get = (r: TeamReport) => by[r].get(id) ?? {};
    const pp = get("powerplay");
    const pk = get("penaltykill");
    const ppt = get("powerplaytime");
    const pkt = get("penaltykilltime");
    const gf = get("goalsforbystrength");
    const ga = get("goalsagainstbystrength");
    const so = get("shootout");
    const pc = get("percentages");
    const fo = get("faceoffpercentages");
    const lt = get("leadingtrailing");
    const sf = get("scoretrailfirst");
    const gp_ = get("goalsbyperiod");
    const rt = get("realtime");
    const team = codes.get(id) ?? String(pp.teamFullName ?? id);
    const gp = n(pp.gamesPlayed) ?? 0;
    const x = xg.get(team) ?? {};

    const toi5v5 = n(rt.timeOnIcePerGame5v5) === null ? null : n(rt.timeOnIcePerGame5v5)! * gp;
    const ev = { gf: n(gf.goalsFor5On5), ga: n(ga.goalsAgainst5On5) };
    const toi5v4 = n(ppt.timeOnIce5v4);
    const toi4v5 = n(pkt.timeOnIce4v5);
    const ppPct = n(pp.powerPlayPct);
    const pkPct = n(pk.penaltyKillPct);
    const ozFo = n(fo.offensiveZoneFaceoffs);
    const dzFo = n(fo.defensiveZoneFaceoffs);

    return {
      teamId: id,
      team,
      name: String(pp.teamFullName ?? team),
      gp,
      record: { w: n(pp.wins), l: n(pp.losses), otl: n(pp.otLosses), pts: n(pp.points) },
      pp: {
        pct: ppPct,
        netPct: n(pp.powerPlayNetPct),
        opportunities: n(pp.ppOpportunities),
        goals: n(pp.powerPlayGoalsFor),
        shGoalsAgainst: n(pp.shGoalsAgainst),
        toiPerGame: n(pp.ppTimeOnIcePerGame),
        goals5v4: n(ppt.goals5v4),
        opportunities5v4: n(ppt.opportunities5v4),
        toi5v4,
        pct5v4: n(ppt.powerPlayPct5v4),
        goals5v3: n(ppt.goals5v3),
        opportunities5v3: n(ppt.opportunities5v3),
        gf60_5v4: per60(n(gf.goalsFor5On4), toi5v4),
        xgf60_5v4: x.pp ? per60(x.pp.xgf, toi5v4) : null,
      },
      pk: {
        pct: pkPct,
        netPct: n(pk.penaltyKillNetPct),
        timesShorthanded: n(pk.timesShorthanded),
        goalsAgainst: n(pk.ppGoalsAgainst),
        shGoalsFor: n(pk.shGoalsFor),
        toiPerGame: n(pk.pkTimeOnIcePerGame),
        goalsAgainst4v5: n(pkt.goalsAgainst4v5),
        toi4v5,
        pct4v5: n(pkt.penaltyKillPct4v5),
        goalsAgainst3v5: n(pkt.goalsAgainst3v5),
        timesShorthanded3v5: n(pkt.timesShorthanded3v5),
        ga60_4v5: per60(n(ga.goalsAgainst4On5), toi4v5),
        xga60_4v5: x.pk ? per60(x.pk.xga, toi4v5) : null,
      },
      specialTeamsIndex: ppPct === null || pkPct === null ? null : ppPct + pkPct,
      ev5: {
        gf: ev.gf,
        ga: ev.ga,
        gfPct: div(ev.gf, sum(ev.gf, ev.ga)),
        xgf: x.ev5?.xgf ?? null,
        xga: x.ev5?.xga ?? null,
        xgfPct: x.ev5 ? div(x.ev5.xgf, x.ev5.xgf + x.ev5.xga) : null,
        toiPerGame: n(rt.timeOnIcePerGame5v5),
        gf60: per60(ev.gf, toi5v5),
        ga60: per60(ev.ga, toi5v5),
        xgf60: x.ev5 ? per60(x.ev5.xgf, toi5v5) : null,
        xga60: x.ev5 ? per60(x.ev5.xga, toi5v5) : null,
        satPct: n(pc.satPct),
        satPctClose: n(pc.satPctClose),
        satPctAhead: n(pc.satPctAhead),
        satPctBehind: n(pc.satPctBehind),
        shootingPct: n(pc.shootingPct5v5),
        savePct: n(pc.savePct5v5),
        pdo: n(pc.shootingPlusSavePct5v5),
        ozStartPct: n(pc.zoneStartPct5v5),
      },
      other: {
        gf4v4: n(gf.goalsFor4On4),
        ga4v4: n(ga.goalsAgainst4On4),
        gf3v3: n(gf.goalsFor3On3),
        ga3v3: n(ga.goalsAgainst3On3),
        gfEmptyNet: n(gf.goalsForEmptyNet),
        gaEmptyNet: n(ga.goalsAgainstEmptyNet),
        gfExtraAttacker: n(gf.goalsForExtraAttacker),
        gaExtraAttacker: n(ga.goalsAgainstExtraAttacker),
        penaltyShotGoals: n(gf.goalsForPenaltyShots),
      },
      shootout: {
        games: n(so.shootoutGamesPlayed),
        wins: n(so.shootoutWins),
        losses: n(so.shootoutLosses),
        winPct: n(so.shootoutWinPct),
        goals: n(so.shootoutGoals),
        shots: n(so.shootoutShots),
        shootingPct: n(so.shootoutShootingPct),
        goalsAgainst: n(so.shootoutGoalsAgainst),
        shotsAgainst: n(so.shootoutShotsAgainst),
        savePct: n(so.shootoutSavePct),
      },
      faceoffs: {
        total: n(fo.totalFaceoffs),
        pct: n(fo.faceoffWinPct),
        ozPct: n(fo.offensiveZoneFaceoffPct),
        oz: ozFo,
        nzPct: n(fo.neutralZoneFaceoffPct),
        dzPct: n(fo.defensiveZoneFaceoffPct),
        dz: dzFo,
        evPct: n(fo.evFaceoffPct),
        ppPct: n(fo.ppFaceoffPct),
        shPct: n(fo.shFaceoffPct),
      },
      score: {
        firstGames: n(sf.scoringFirstGamesPlayed),
        firstWinPct: n(sf.winPctScoringFirst),
        trailFirstGames: n(sf.trailingFirstGamesPlayed),
        trailFirstWinPct: n(sf.winPctTrailingFirst),
        winPctLead1: n(lt.winPctLeadPeriod1),
        winPctLead2: n(lt.winPctLeadPeriod2),
        winPctTrail1: n(lt.winPctTrailPeriod1),
        winPctTrail2: n(lt.winPctTrailPeriod2),
        winsTrail2: n(lt.winsTrailPeriod2),
        lossLead2: n(lt.lossLeadPeriod2),
      },
      periods: {
        gf: [n(gp_.period1GoalsFor), n(gp_.period2GoalsFor), n(gp_.period3GoalsFor), n(gp_.periodOtGoalsFor)],
        ga: [n(gp_.period1GoalsAgainst), n(gp_.period2GoalsAgainst), n(gp_.period3GoalsAgainst), n(gp_.periodOtGoalsAgainst)],
      },
      physical: {
        hits60: n(rt.hitsPer60),
        takeaways60: n(rt.takeawaysPer60),
        giveaways60: n(rt.giveawaysPer60),
        blocks60: n(rt.blockedShotsPer60),
      },
    } satisfies TeamSituations;
  });
}
