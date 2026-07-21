/**
 * Amateur Scouting seed: fictional NCAA conferences, schools, 300+ prospects,
 * multi-season statistics, game logs, role archetypes + versioned weights,
 * persisted role scores, scouting reports, watchlists, draft + CFA boards,
 * organizational needs, fit scores, comparables, and assignments.
 *
 * All people and programs are fictional. TOI is intentionally left null —
 * the engine never fabricates time-on-ice data.
 */
import { eq } from "drizzle-orm";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import * as schema from "../src/db/schema";
import { ARCHETYPE_SEEDS, ROLE_MODEL_VERSION, FIT_MODEL_VERSION } from "../src/lib/scouting/archetypes";
import { buildPercentiles, type SeasonLine } from "../src/lib/scouting/stats";
import { scoreAllArchetypes, type WeightRow } from "../src/lib/scouting/roleScoring";
import { computeSeasonTrends } from "../src/lib/scouting/trends";
import { DEFAULT_FIT_WEIGHTS, FIT_COMPONENT_KEYS, FIT_COMPONENT_LABELS } from "../src/lib/scouting/fit";
import { setDbForTesting } from "../src/db/client";
import { runFitForNeed } from "../src/server/services/fitService";

type Db = PgliteDatabase<typeof schema>;

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260719);
const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)]!;
const randInt = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));

const CONFERENCES = ["Great Basin", "Northern Lakes", "Atlantic Ridge", "Prairie Eight", "Summit Coast", "Frontier Collegiate"];
const SCHOOL_WORDS_A = ["Pinecrest", "Larkspur", "Granite Falls", "Silver Birch", "Weston Bay", "Cold Harbor", "Maple Ridge", "Iron Lake", "North Meridian", "Bluewater", "Cascade Valley", "Elk Point", "Stone Bridge", "Foxfield", "Riverbend", "Aurora Heights", "Timberline", "Kestrel", "Highmark", "Drumlin"];
const SCHOOL_WORDS_B = ["University", "State University", "College", "Institute", "Tech"];
const FIRST = ["Aiden","Beckett","Cole","Dawson","Easton","Finn","Grayson","Hudson","Ilya","Jasper","Kellen","Landon","Mason","Nico","Owen","Parker","Quinn","Rowan","Sawyer","Tate","Urban","Vince","Wyatt","Xander","Yale","Zach","Anders","Brooks","Callum","Deacon","Ellis","Ford","Gideon","Holden","Ivor","Jonas","Kade","Lars","Miles","Nils"];
const LAST = ["Abbott","Barlow","Calder","Dempsey","Eastman","Fairbanks","Gallant","Harmon","Ingram","Jennings","Keating","Lachance","Marsden","Northrup","Overton","Pruitt","Quimby","Ralston","Sandoval","Thatcher","Underhill","Vasser","Whitfield","Yardley","Zimmer","Ashdown","Birchall","Copeland","Delacroix","Ellery","Fenwick","Garrick","Holloway","Ives","Jasperse","Kingsley","Lockwood","Merrick","Norwood","Ostrom"];
const NATIONS = ["United States","Canada","Sweden","Finland","Czechia","Slovakia"];
const SEASONS = ["2023-24", "2024-25", "2025-26"] as const;
const CLASS_ORDER = ["freshman", "sophomore", "junior", "senior", "graduate"] as const;

const usedNames = new Set<string>();
function fictionalName(): string {
  for (let i = 0; i < 300; i++) {
    const n = `${pick(FIRST)} ${pick(LAST)}`;
    if (!usedNames.has(n)) {
      usedNames.add(n);
      return n;
    }
  }
  const fb = `${pick(FIRST)} ${pick(LAST)} ${usedNames.size}`;
  usedNames.add(fb);
  return fb;
}

export interface ScoutingSeedContext {
  auroraOrgId: string;
  ironportOrgId: string;
  gmUserId: string;
  analystUserId: string;
  rightsHolderNames: string[];
}

export async function seedScouting(db: Db, ctx: ScoutingSeedContext): Promise<{ prospects: number }> {
  /* ---- conferences & schools (global reference data) ---- */
  const conferenceRows = await db
    .insert(schema.conferences)
    .values(
      CONFERENCES.map((name) => ({
        name: `${name} Conference`,
        abbreviation: name.split(/\s+/).map((w) => w[0]).join("").toUpperCase() + "C",
        level: "division_1",
      })),
    )
    .returning();
  const STATES = ["MN", "MI", "NY", "MA", "ND", "WI", "CO", "OH", "PA", "VT"];
  const schoolRows = await db
    .insert(schema.schools)
    .values(
      SCHOOL_WORDS_A.map((a, i) => {
        const suffix = SCHOOL_WORDS_B[i % SCHOOL_WORDS_B.length]!;
        return {
          name: `${a} ${suffix}`,
          shortName: a,
          abbreviation: `${a} ${suffix}`.split(/\s+/).map((w) => w[0]).join("").toUpperCase(),
          conferenceId: conferenceRows[i % conferenceRows.length]!.id,
          city: a.split(" ")[0]!,
          state: STATES[i % STATES.length]!,
          country: "United States",
          division: "division_1",
          isActive: true,
        };
      }),
    )
    .returning();

  /* ---- role archetypes + versioned weights ---- */
  const archetypeRows = await db
    .insert(schema.roleArchetypes)
    .values(
      ARCHETYPE_SEEDS.map((a) => ({
        key: a.key,
        label: a.label,
        positionGroup: a.positionGroup,
        description: a.description,
      })),
    )
    .returning();
  const archetypeByKey = new Map(archetypeRows.map((a) => [a.key, a]));
  const weightValues = ARCHETYPE_SEEDS.flatMap((a) =>
    Object.entries(a.weights).map(([metric, weight]) => ({
      archetypeId: archetypeByKey.get(a.key)!.id,
      metric,
      weight,
      modelVersion: ROLE_MODEL_VERSION,
      effectiveDate: "2025-09-01",
      isActive: true,
    })),
  );
  await db.insert(schema.roleMetricWeights).values(weightValues);

  /* ---- prospects ---- */
  interface SeededProspect {
    row: typeof schema.amateurProspects.$inferSelect;
    tier: number; // 0 (elite) .. 3 (depth)
    seasons: Array<typeof schema.prospectSeasons.$inferSelect>;
  }
  const seeded: SeededProspect[] = [];

  const positions: Array<{ pos: string; group: "F" | "D" | "G"; count: number }> = [
    { pos: "C", group: "F", count: 70 },
    { pos: "LW", group: "F", count: 55 },
    { pos: "RW", group: "F", count: 55 },
    { pos: "D", group: "D", count: 90 },
    { pos: "G", group: "G", count: 30 },
  ];

  for (const { pos, group, count } of positions) {
    for (let i = 0; i < count; i++) {
      const tier = i < count * 0.1 ? 0 : i < count * 0.35 ? 1 : i < count * 0.75 ? 2 : 3;
      const classIdx = randInt(0, 3); // freshman..senior for current season
      const age = 18 + classIdx + (rand() < 0.25 ? 1 : 0);
      const dobYear = 2025 - age;
      const drafted = rand() < (tier === 0 ? 0.7 : tier === 1 ? 0.45 : 0.2);
      const classYear = CLASS_ORDER[classIdx]!;
      const cfa =
        !drafted && (classYear === "senior" || classYear === "graduate")
          ? "eligible"
          : !drafted && classYear === "junior"
            ? "watch"
            : "not_eligible";
      const school = schoolRows[randInt(0, schoolRows.length - 1)]!;
      const [prospect] = await db
        .insert(schema.amateurProspects)
        .values({
          organizationId: ctx.auroraOrgId,
          fullName: fictionalName(),
          dateOfBirth: `${dobYear}-${String(randInt(1, 12)).padStart(2, "0")}-${String(randInt(1, 28)).padStart(2, "0")}`,
          position: pos,
          positionGroup: group,
          shootsCatches: rand() < 0.62 ? "L" : "R",
          heightCm: randInt(173, 200),
          weightKg: randInt(74, 102),
          nationality: pick(NATIONS),
          schoolId: school.id,
          classYear,
          draftYear: drafted ? 2020 + randInt(3, 5) : null,
          draftRound: drafted ? randInt(1, 7) : null,
          draftOverall: drafted ? randInt(1, 224) : null,
          nhlDraftStatus: drafted ? "drafted" : "undrafted",
          nhlRightsHolder: drafted ? pick(ctx.rightsHolderNames) : null,
          collegeFreeAgentStatus: cfa,
          agentName: cfa === "eligible" ? `${pick(FIRST)} ${pick(LAST)} (agent)` : null,
          provenance: "user_entered",
        })
        .returning();
      if (!prospect) throw new Error("prospect insert failed");

      // Seasons: current class year implies how many prior seasons exist.
      const seasonsPlayed = Math.min(classIdx + 1, 3);
      const baseQuality = [1.1, 0.85, 0.55, 0.35][tier]!; // PPG-ish scale for F
      const growth = 0.75 + rand() * 0.5; // some grow, some regress
      const seasonRows: Array<typeof schema.prospectSeasons.$inferSelect> = [];
      for (let s = 0; s < seasonsPlayed; s++) {
        const seasonName = SEASONS[SEASONS.length - seasonsPlayed + s]!;
        const seasonClass = CLASS_ORDER[classIdx - (seasonsPlayed - 1 - s)]!;
        const gp = randInt(24, 38);
        const posFactor = group === "D" ? 0.45 : group === "G" ? 0.05 : 1;
        const quality = baseQuality * posFactor * (1 + (growth - 1) * (s / Math.max(1, seasonsPlayed - 1)));
        const points = Math.max(0, Math.round(gp * quality * (0.85 + rand() * 0.3)));
        const goals = Math.round(points * (group === "D" ? 0.25 : 0.42));
        const assists = points - goals;
        const shots = Math.max(goals * 2, Math.round(gp * (group === "D" ? 1.6 : 2.6) * (0.7 + rand() * 0.6)));
        const ppShare = rand() < 0.3 ? 0.4 : 0.2;
        const isCenter = pos === "C";
        const [seasonRow] = await db
          .insert(schema.prospectSeasons)
          .values({
            prospectId: prospect.id,
            seasonName,
            classYear: seasonClass,
            schoolId: school.id,
            gamesPlayed: gp,
            goals,
            assists,
            shots,
            penaltyMinutes: randInt(4, 60),
            plusMinus: randInt(-15, 20),
            powerPlayGoals: Math.round(goals * ppShare),
            powerPlayAssists: Math.round(assists * ppShare),
            shortHandedGoals: rand() < 0.15 ? randInt(1, 3) : 0,
            faceoffWins: isCenter ? randInt(150, 450) : 0,
            faceoffAttempts: isCenter ? randInt(400, 900) : 0,
            timeOnIceSeconds: null, // NCAA TOI unavailable — never fabricated
            teamGoalsFor: randInt(85, 145),
            provenance: "user_entered",
          })
          .returning();
        if (seasonRow) seasonRows.push(seasonRow);
      }
      seeded.push({ row: prospect, tier, seasons: seasonRows });
    }
  }

  /* ---- game logs for the current season (top-2-tier prospects) ---- */
  const logProspects = seeded.filter((p) => p.tier <= 1).slice(0, 80);
  for (const p of logProspects) {
    const current = p.seasons.find((s) => s.seasonName === "2025-26");
    if (!current || current.gamesPlayed === 0) continue;
    const games = Math.min(current.gamesPlayed, randInt(14, 24));
    const perGame = (current.goals + current.assists) / current.gamesPlayed;
    const logs = Array.from({ length: games }, (_, g) => {
      const hot = g >= games - 6 && rand() < 0.5 ? 1 : 0;
      const pts = Math.max(0, Math.round(perGame + (rand() - 0.5) * 1.6 + hot * 0.5));
      const goals = Math.min(pts, rand() < 0.45 ? 1 : 0);
      return {
        prospectId: p.row.id,
        seasonName: "2025-26",
        gameDate: `2025-${String(10 + Math.floor(g / 9)).padStart(2, "0")}-${String((g % 27) + 1).padStart(2, "0")}`,
        opponent: pick(schoolRows).name,
        homeAway: g % 2 === 0 ? "H" : "A",
        goals,
        assists: pts - goals,
        shots: randInt(0, 7),
        powerPlayPoints: Math.min(pts, rand() < 0.3 ? 1 : 0),
        penaltyMinutes: rand() < 0.2 ? 2 : 0,
        provenance: "user_entered" as const,
      };
    });
    await db.insert(schema.prospectGameLogs).values(logs);
  }

  /* ---- role scores + trends (persisted with model versions) ---- */
  const toLine = (p: SeededProspect, s: typeof schema.prospectSeasons.$inferSelect): SeasonLine => ({
    prospectId: p.row.id,
    seasonName: s.seasonName,
    position: p.row.position,
    positionGroup: p.row.positionGroup,
    age: p.row.dateOfBirth ? Number(s.seasonName.slice(0, 4)) - Number(p.row.dateOfBirth.slice(0, 4)) : null,
    gamesPlayed: s.gamesPlayed,
    goals: s.goals,
    assists: s.assists,
    shots: s.shots,
    penaltyMinutes: s.penaltyMinutes,
    powerPlayGoals: s.powerPlayGoals,
    powerPlayAssists: s.powerPlayAssists,
    shortHandedGoals: s.shortHandedGoals,
    faceoffWins: s.faceoffWins,
    faceoffAttempts: s.faceoffAttempts,
    timeOnIceSeconds: s.timeOnIceSeconds,
    teamGoalsFor: s.teamGoalsFor,
    teamGamesPlayed: null,
  });

  const currentLines = seeded
    .map((p) => {
      const s = p.seasons.find((x) => x.seasonName === "2025-26");
      return s ? toLine(p, s) : null;
    })
    .filter((x): x is SeasonLine => x !== null);

  const weightRows: WeightRow[] = weightValues.map((w) => {
    const arch = archetypeRows.find((a) => a.id === w.archetypeId)!;
    return {
      archetypeKey: arch.key,
      archetypeLabel: arch.label,
      positionGroup: arch.positionGroup,
      metric: w.metric,
      weight: w.weight,
      modelVersion: w.modelVersion,
    };
  });

  const scoreTargets = seeded.filter((p) => p.seasons.some((s) => s.seasonName === "2025-26"));
  const topByScore: Array<{ prospect: SeededProspect; bestScore: number; bestKey: string }> = [];
  for (const p of scoreTargets) {
    const s = p.seasons.find((x) => x.seasonName === "2025-26")!;
    const percentiles = buildPercentiles(toLine(p, s), currentLines);
    const scores = scoreAllArchetypes(p.row.positionGroup, weightRows, percentiles);
    const toPersist = scores.filter((sc) => sc.score !== null).slice(0, 4);
    if (toPersist.length > 0) {
      await db.insert(schema.prospectRoleScores).values(
        toPersist.map((sc) => ({
          prospectId: p.row.id,
          archetypeId: archetypeByKey.get(sc.archetypeKey)!.id,
          seasonName: "2025-26",
          modelVersion: ROLE_MODEL_VERSION,
          score: sc.score!,
          confidence: sc.confidence,
          explanation: {
            contributions: sc.contributions,
            missingInputs: sc.missingInputs,
            contradictions: sc.contradictions,
            poolSize: sc.poolSize,
          },
        })),
      );
      topByScore.push({ prospect: p, bestScore: toPersist[0]!.score!, bestKey: toPersist[0]!.archetypeKey });
    }
    // Persist year-over-year trends for multi-season prospects.
    if (p.seasons.length >= 2) {
      const trends = computeSeasonTrends(p.seasons.map((s2) => toLine(p, s2)));
      const latest = trends[trends.length - 1];
      if (latest?.classification) {
        await db.insert(schema.prospectTrends).values({
          prospectId: p.row.id,
          kind: latest.kind,
          classification: latest.classification,
          detail: latest.detail,
          modelVersion: latest.modelVersion,
        });
      }
    }
  }
  topByScore.sort((a, b) => b.bestScore - a.bestScore);

  /* ---- scout-assigned roles for a handful of top prospects ---- */
  for (const t of topByScore.slice(0, 12)) {
    await db
      .update(schema.amateurProspects)
      .set({ scoutAssignedRoleKey: t.bestKey, projectedProRoleKey: t.bestKey })
      .where(eq(schema.amateurProspects.id, t.prospect.row.id));
  }

  /* ---- scouting reports ---- */
  const gradeSections = ["hockey_sense", "skating", "puck_skills", "compete", "offensive_play", "defensive_play", "transition", "special_teams", "physical_profile"];
  for (const t of topByScore.slice(0, 12)) {
    const grades: Record<string, number> = {};
    for (const s of gradeSections) grades[s] = randInt(45, 70); // 20–80 scale
    await db.insert(schema.scoutingReports).values({
      organizationId: ctx.auroraOrgId,
      prospectId: t.prospect.row.id,
      scoutId: rand() < 0.5 ? ctx.gmUserId : ctx.analystUserId,
      viewingType: pick(["live", "video", "crossover"] as const),
      gameDate: `2025-${String(randInt(10, 12)).padStart(2, "0")}-${String(randInt(1, 28)).padStart(2, "0")}`,
      opponent: pick(schoolRows).name,
      venue: rand() < 0.5 ? "Home" : "Away",
      gradingScale: "20-80",
      grades,
      strengths: "Pace, puck retrievals, and offensive instincts stood out in this fictional viewing.",
      concerns: "Defensive-zone consistency and strength on the wall need development.",
      developmentPriorities: "Add strength; simplify exits under pressure.",
      nhlProjection: "Middle-six forward / top-four defenseman (fictional projection)",
      professionalFloor: "AHL contributor",
      professionalCeiling: "NHL regular",
      developmentTimeline: "2-3 years",
      risk: pick(["low", "medium", "medium", "high"] as const),
      recommendation: "Continue tracking; cross-check requested.",
      confidence: 0.5 + rand() * 0.35,
      status: "submitted",
    });
  }

  /* ---- watchlists ---- */
  const [watchA] = await db
    .insert(schema.prospectWatchlists)
    .values({ organizationId: ctx.auroraOrgId, name: "Priority follows", description: "Top statistical + scout-flagged prospects", createdBy: ctx.gmUserId })
    .returning();
  const [watchB] = await db
    .insert(schema.prospectWatchlists)
    .values({ organizationId: ctx.auroraOrgId, name: "College free agents", description: "Undrafted seniors worth signing calls", createdBy: ctx.analystUserId })
    .returning();
  if (watchA) {
    await db.insert(schema.prospectWatchlistMembers).values(
      topByScore.slice(0, 10).map((t, i) => ({
        watchlistId: watchA.id,
        prospectId: t.prospect.row.id,
        addedBy: ctx.gmUserId,
        priority: i < 3 ? 1 : i < 7 ? 2 : 3,
        reason: i < 3 ? "Top statistical profile at position" : "Strong role-score trajectory",
        followUpDate: i < 5 ? "2026-01-15" : null,
      })),
    );
  }
  const cfas = seeded.filter((p) => p.row.collegeFreeAgentStatus === "eligible");
  if (watchB && cfas.length > 0) {
    await db.insert(schema.prospectWatchlistMembers).values(
      cfas.slice(0, 8).map((p, i) => ({
        watchlistId: watchB.id,
        prospectId: p.row.id,
        addedBy: ctx.analystUserId,
        priority: i < 2 ? 2 : 3,
        reason: "Undrafted senior; signing call candidate",
        followUpDate: "2026-03-01",
      })),
    );
  }

  /* ---- draft board + CFA board ---- */
  const [board] = await db
    .insert(schema.draftBoards)
    .values({ organizationId: ctx.auroraOrgId, name: "2026 Draft Board", boardType: "draft", draftYear: 2026, createdBy: ctx.gmUserId })
    .returning();
  if (board) {
    const draftable = topByScore.filter((t) => t.prospect.row.nhlDraftStatus === "undrafted").slice(0, 32);
    await db.insert(schema.draftBoardEntries).values(
      draftable.map((t, i) => ({
        boardId: board.id,
        prospectId: t.prospect.row.id,
        overallRank: i + 1,
        modelRank: i + 1,
        scoutRank: Math.max(1, i + 1 + randInt(-4, 4)),
        risk: pick(["low", "medium", "high"] as const),
        recommendation: i < 10 ? "Target" : "Monitor",
      })),
    );
  }
  const [cfaBoard] = await db
    .insert(schema.draftBoards)
    .values({ organizationId: ctx.auroraOrgId, name: "College Free-Agent Board", boardType: "college_free_agent", createdBy: ctx.gmUserId })
    .returning();
  if (cfaBoard && cfas.length > 0) {
    await db.insert(schema.draftBoardEntries).values(
      cfas.slice(0, 12).map((p, i) => ({
        boardId: cfaBoard.id,
        prospectId: p.row.id,
        overallRank: i + 1,
        recommendation: i < 4 ? "Priority signing call" : "Monitor",
      })),
    );
  }

  /* ---- fit model configuration (weights live in the database) ---- */
  const [fitModel] = await db
    .insert(schema.fitModels)
    .values({
      key: "org_fit",
      label: "Organizational fit",
      description: "Weighted, explainable prospect-to-need fit; every component reports inputs, weights, and contributions.",
    })
    .returning();
  const [fitVersion] = await db
    .insert(schema.fitModelVersions)
    .values({ modelId: fitModel!.id, version: FIT_MODEL_VERSION, effectiveDate: "2026-07-01", notes: "Initial 14-component model." })
    .returning();
  await db.insert(schema.fitComponentDefinitions).values(
    FIT_COMPONENT_KEYS.map((key, i) => ({ key, label: FIT_COMPONENT_LABELS[key], sortOrder: i })),
  );
  await db.insert(schema.fitComponentWeights).values(
    FIT_COMPONENT_KEYS.map((key) => ({
      modelVersionId: fitVersion!.id,
      componentKey: key,
      weight: DEFAULT_FIT_WEIGHTS[key],
    })),
  );

  /* ---- organizational needs (full Phase-2 field set) ---- */
  const needRows = await db
    .insert(schema.organizationalNeeds)
    .values([
      {
        organizationId: ctx.auroraOrgId,
        name: "Right-shot transition defenseman",
        description: "Blue-line breakout help for the 2028-29 window.",
        position: "D",
        handedness: "R",
        targetRoleKey: "puck_moving_d",
        targetScoutRoleKey: "transition_d",
        priority: 1,
        timelineYears: 3,
        earliestArrivalYears: 2,
        latestArrivalYears: 4,
        targetArrivalSeason: "2028-29",
        preferredAcquisition: "draft",
        maxRiskTolerance: "medium",
        sizePreference: "prefers_mobility",
        nhlRosterNeed: false,
        ahlOpportunity: true,
        notes: "First-pass quality outweighs point totals; skating and sense minimums apply.",
        createdBy: ctx.gmUserId,
      },
      {
        organizationId: ctx.auroraOrgId,
        name: "Two-way center depth",
        description: "Center depth behind the current top six.",
        position: "C",
        targetRoleKey: "two_way_center",
        priority: 2,
        timelineYears: 3,
        earliestArrivalYears: 1,
        latestArrivalYears: 4,
        preferredAcquisition: "any",
        maxRiskTolerance: "medium",
        createdBy: ctx.gmUserId,
      },
      {
        organizationId: ctx.auroraOrgId,
        name: "Developmental goaltender",
        description: "Pipeline goaltender; tools over results.",
        position: "G",
        targetRoleKey: "developmental_goalie",
        priority: 3,
        timelineYears: 4,
        earliestArrivalYears: 2,
        latestArrivalYears: 6,
        preferredAcquisition: "draft",
        maxRiskTolerance: "high",
        createdBy: ctx.gmUserId,
      },
      {
        organizationId: ctx.auroraOrgId,
        name: "NHL-ready scoring winger",
        description: "Immediate middle-six scoring; power-play upside preferred.",
        position: "F",
        secondaryPosition: "RW",
        targetRoleKey: "shooting_winger",
        priority: 2,
        timelineYears: 0,
        earliestArrivalYears: 0,
        latestArrivalYears: 1,
        preferredAcquisition: "college_fa",
        maxRiskTolerance: "low",
        specialTeamsRequirement: "pp",
        nhlRosterNeed: true,
        ahlOpportunity: false,
        createdBy: ctx.gmUserId,
      },
      {
        organizationId: ctx.auroraOrgId,
        name: "Penalty-kill depth forward",
        description: "Missing-data showcase: PK usage is not tracked in NCAA data, so this need surfaces proxy warnings.",
        position: "F",
        targetRoleKey: "pk_specialist_forward",
        priority: 4,
        timelineYears: 1,
        earliestArrivalYears: 0,
        latestArrivalYears: 2,
        preferredAcquisition: "college_fa",
        maxRiskTolerance: "medium",
        specialTeamsRequirement: "pk",
        nhlRosterNeed: false,
        ahlOpportunity: true,
        createdBy: ctx.analystUserId,
      },
    ])
    .returning();

  // Grade minimums for the headline defenseman need.
  await db.insert(schema.organizationalNeedRequirements).values([
    { needId: needRows[0]!.id, requirementType: "min_grade", key: "skating", minValue: 55 },
    { needId: needRows[0]!.id, requirementType: "min_grade", key: "hockey_sense", minValue: 55 },
    { needId: needRows[3]!.id, requirementType: "min_grade", key: "puck_skills", minValue: 60 },
  ]);

  /* ---- fit runs via the real service (runs, scores, components, snapshots, links) ---- */
  setDbForTesting(db as never);
  for (const need of needRows) {
    await runFitForNeed(need.id, ctx.auroraOrgId, ctx.gmUserId);
  }

  /* ---- comparables (NCAA same-age statistical) ---- */
  for (const t of topByScore.slice(0, 30)) {
    const s = t.prospect.seasons.find((x) => x.seasonName === "2025-26")!;
    const myPpg = s.gamesPlayed > 0 ? (s.goals + s.assists) / s.gamesPlayed : 0;
    const myAge = t.prospect.row.dateOfBirth ? 2025 - Number(t.prospect.row.dateOfBirth.slice(0, 4)) : 20;
    const peers = seeded
      .filter((p) => p.row.id !== t.prospect.row.id && p.row.positionGroup === t.prospect.row.positionGroup)
      .map((p) => {
        const ps = p.seasons.find((x) => x.seasonName === "2025-26");
        if (!ps || ps.gamesPlayed === 0) return null;
        const ppg = (ps.goals + ps.assists) / ps.gamesPlayed;
        const age = p.row.dateOfBirth ? 2025 - Number(p.row.dateOfBirth.slice(0, 4)) : 20;
        const distance = Math.abs(ppg - myPpg) * 3 + Math.abs(age - myAge);
        return { p, ppg, age, distance };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 3);
    for (const peer of peers) {
      await db.insert(schema.prospectComparables).values({
        prospectId: t.prospect.row.id,
        comparableProspectId: peer.p.row.id,
        comparableName: peer.p.row.fullName,
        comparisonType: "ncaa_same_age",
        similarity: Number(Math.max(0.4, 1 - peer.distance / 6).toFixed(2)),
        sharedTraits: [`${t.prospect.row.positionGroup} position group`, `Similar age (${peer.age} vs ${myAge})`, `Similar scoring rate (${peer.ppg.toFixed(2)} vs ${myPpg.toFixed(2)} PPG)`],
        differences: peer.p.row.shootsCatches !== t.prospect.row.shootsCatches ? ["Opposite handedness"] : [],
        dataPeriod: "2025-26",
        modelVersion: ROLE_MODEL_VERSION,
      });
    }
  }

  /* ---- assignments ---- */
  await db.insert(schema.scoutingAssignments).values([
    { organizationId: ctx.auroraOrgId, scoutId: ctx.analystUserId, prospectId: topByScore[0]?.prospect.row.id ?? null, assignmentType: "player", dueDate: "2026-08-15", status: "open", notes: "Live viewing + full report.", createdBy: ctx.gmUserId },
    { organizationId: ctx.auroraOrgId, scoutId: ctx.analystUserId, prospectId: topByScore[1]?.prospect.row.id ?? null, assignmentType: "cross_check", dueDate: "2026-08-30", status: "open", notes: "Cross-check regional report.", createdBy: ctx.gmUserId },
    { organizationId: ctx.auroraOrgId, scoutId: ctx.gmUserId, region: "Northern Lakes Conference", assignmentType: "region", status: "in_progress", notes: "Conference sweep before the holiday tournament.", createdBy: ctx.gmUserId },
    { organizationId: ctx.auroraOrgId, scoutId: null, schoolId: schoolRows[0]!.id, assignmentType: "school", status: "open", notes: "Unassigned school coverage.", createdBy: ctx.gmUserId },
  ]);

  /* ---- isolation fixtures: a few prospects for the rival org ---- */
  for (let i = 0; i < 5; i++) {
    await db.insert(schema.amateurProspects).values({
      organizationId: ctx.ironportOrgId,
      fullName: fictionalName(),
      position: pick(["C", "D"] as const),
      positionGroup: "F",
      schoolId: schoolRows[i]!.id,
      classYear: "sophomore",
      provenance: "user_entered",
    });
  }

  return { prospects: seeded.length + 5 };
}
