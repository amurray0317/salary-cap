# League coverage tracker

Goal: player stats and standings for every league staff care about, updated
daily, from **free sources only**. Elite Prospects is not a source: its data
is licensed (paid API) and scraping it is against its terms. If an EP API key
is ever available, the official-API connector (`src/lib/connectors/eliteprospects.ts`)
turns on with `EP_API_KEY`.

## How leagues get covered

Leagues publish stats through a small number of stats platforms. One
integration per **platform** covers every league on it, so the work is
"platforms", not "300 leagues". Each platform is added only after:

1. its terms of use allow this use (personal, non-commercial, rate-limited),
2. a real response is recorded as a test fixture,
3. it runs through the gated import pipeline (preview → approval → provenance).

Daily refresh runs on GitHub Actions (free), like the nightly xG job.

**Minors.** U14–U18 players are minors: store only what the league publishes
publicly (name, team, position, stats). No photos, contact details or
anything beyond the published stat line.

## Why tiers

Draft-year league of the 2,139 skaters drafted 2016–2026 (NHL data): 67
leagues in total. The top 10 leagues supplied 78.6% of picks, the top 20
92.5%, the top 30 96.8%. Tier 1 is those leagues plus the IIHF events scouts
weight most. The prospect model gains the most from Tier 1.

Status: ✅ live · ⏳ planned (blocked = the source cannot be reached from the build environment yet) · ❔ source not yet identified

## Tier 1 — where NHL draft picks come from

| League | Level | Picks 2016–26 | Source | Status |
|---|---|---|---|---|
| NHL | Pro | — | NHL API | ✅ stats, standings, draft, rankings, game logs |
| OHL | CHL | 347 | HockeyTech (lscluster.hockeytech.com; to verify) | ⏳ blocked by environment network policy |
| WHL | CHL | 301 | HockeyTech (to verify) | ⏳ blocked by network policy |
| USHL | Jr. US Tier I | 229 | HockeyTech (to verify) | ⏳ blocked by network policy |
| J20 Nationell (U20 Nationell) | Sweden U20 | 184 | ❔ Swedish federation stats | ⏳ |
| QMJHL | CHL | 178 | HockeyTech (to verify) | ⏳ blocked by network policy |
| NTDP | US U17/U18 | 132 | ❔ (USHL schedule via HockeyTech) | ⏳ |
| MHL | Russia U20 | 105 | ❔ KHL/MHL site | ⏳ |
| U20 SM-sarja | Finland U20 | 89 | ❔ Finnish federation stats | ⏳ |
| NCAA (D-I) | College | 79 | ❔ | ⏳ |
| SHL | Sweden | 54 | ❔ | ⏳ |
| Liiga | Finland | 46 | ❔ Liiga site API | ⏳ |
| USHS-Prep, USHS-MN | US high school | 84 | ❔ | ⏳ |
| BCHL | Canada Jr. A | 34 | ❔ | ⏳ |
| KHL | Russia | 28 | ❔ KHL site | ⏳ |
| HockeyAllsvenskan | Sweden 2 | 26 | ❔ | ⏳ |
| VHL | Russia 2 | 22 | ❔ | ⏳ |
| Extraliga (Czechia) | Czechia | 21 | ❔ | ⏳ |
| AJHL, OJHL | Canada Jr. A | 33 | ❔ | ⏳ |
| 18U AAA (US) | US 18U | 11 | ❔ | ⏳ |
| Extraliga (Slovakia) | Slovakia | 11 | ❔ | ⏳ |
| NL | Switzerland | 10 | ❔ | ⏳ |
| Extraliga juniorů | Czechia U20 | 8 | ❔ | ⏳ |
| DEL | Germany | 8 | ❔ | ⏳ |
| NAHL | Jr. US Tier II | 7 | ❔ | ⏳ |
| HockeyEttan, Mestis | Sweden 3, Finland 2 | 14 | ❔ | ⏳ |
| CAHS | Canada prep | 7 | ❔ | ⏳ |
| AHL, ECHL | Pro | — | HockeyTech (to verify) | ⏳ blocked by network policy |
| IIHF: World Juniors, U18 WJC, Hlinka Gretzky Cup, WC | International | — | ❔ IIHF | ⏳ |

## Tier 2 — other pro and junior leagues

**North America:** SPHL · NCAA III · EHL · NCDC · MJHL · SJHL · SIJHL · CCHL ·
NOJHL · MJAHL · QJHL · NAPrepHL U18/U16/U14 · MPHL · PHC · PPP · USHS-MI ·
USHS-NY · USHS-MA · CISAA · GMHL.

**Europe:** Sweden (Division 2–6, U20 Region, U18 Nationell, U18 Region, SUHL,
TV-Pucken) · Finland (Suomi-sarja, II-/III-divisioona, U20 Mestis, U18
SM-sarja, U18 Mestis) · Switzerland (SL, MyHL, 1. Liga, U21-Elit, U21-Top,
U18-Elit) · Germany (DEL 2, Oberliga, Regionalliga, DNL U20 Div. I–III,
U17 Div. I–II) · Austria/Alps (ICEHL, Alps Hockey League, ÖEL, U20, U18i, U17) ·
France (Ligue Magnus, Division 1–3, U18, U20) · UK (EIHL, NIHL, NIHL 1–2,
England U15/U18/U20, SNL) · Netherlands (CEHL, Tweede Divisie) · Denmark
(Metal Ligaen, 1. Division, U20, U18) · Norway (EHL, HockeyLiga1, 2.–3.
Divisjon, U20, U18, U16) · Iceland (senior, U18) · Russia (Russia3, NMHL,
U16–U18) · Czechia (1. liga, 2. liga, Extraliga 9. trid, Extraliga dorostu) ·
Slovakia (1. liga, Liga starsich ziakov AA, Extraliga dorastu, Extraliga
juniorov) · Latvia (senior, 2, U17) · Hungary (Erste Liga, senior, U18, U21) ·
Belarus (senior, Vysshaya, U18) · Ukraine (senior, U19) · Kazakhstan · Poland
(PHL, 2, 3, U20, U18) · Italy (IHL Serie A, IHL, IHL Division 1, U19, U16) ·
Slovenia (senior, U19), IntHL, IntHL U19 · Croatia · Serbia · Bosnia · Spain ·
Turkey (senior, 2, U20, U18) · Bulgaria (senior, U20, U18, U16) · Estonia ·
Lithuania · Romania (senior, U20, U18, U16).

**International & club:** World Cup · WC D1A–D4, D3Q · Olympics, OGQ · U20
WJC D1A–D3B · U18 WJC D1A–D3B · YOG · U17 WHC · CCOA (senior, D1, U20, U18) ·
Champions Hockey League · Continental Cup.

**Other regions:** Asia League · CIHL HK · China · Japan · Korea College ·
Australia (AIHL, AIJHL, ECSL, IHSA Premier, IHV Premier, WASL) · NZIHL ·
South Africa (GPHL, WPIHL) · Israel (senior, 2, U20) · IEHL · UAE.

**College (Europe):** EUHL · SUHL · FCAA · MSHL1–3 · RSHL1–2 · SHLSPB1–2 · ULLH.

## Tier 3 — youth and minor (public stat lines only)

**US 18U/16U/15U/14U:** AYHL · BEAST · CSDHL · ECEL · EJEPL · MNHP (incl. 15O) ·
MNBEL 14U · NAPHL · NAT1HL · T1EHL · THF · UT1HL.

**Canada Jr. B / Jr. C:** EOJHL · GOJHL · CAJAAHL · IsJHL · LHC · KIJHL ·
NEAJBHL · NWJHL · PIJHL · PJHL · VIJHL · HC U21C · HTJHL · NorJHL · QVJHL ·
LHJABF · LHJACN · LHJACRSE · LHJAL · LHJALL · LHJALSL · LHJAM · LHJAMA ·
LHJAO · LHJAOSF · LHJARV · LHJASLSJ · NBJHL · NSRJHL · PEIJCHL.

**Canada U15–U18:** AEHL U18 / U18 AA / U17 / U16 AA · BCEHL U18/U17 · CSSHL
U18/U17/U17 AAA · CSSHLE U17/U18 · JPHL 18U · MU18HL · PHL U18/U16 · SAAHL
U18/U16 · SMAAAHL · WAAA U17 · ALLIANCE U18/U16/U15 · GNU18L · GTHL
U18/U16/U15 · HEO U18/U18 AA/U16/U16 AA/U15/U15 AA · OMHA U18/U16/U15 · NOHL
U15 · NBPEIMU18HL · NLU18MHL · NSU18MHL · PEI U18 · QM18AAA · QM18AA ·
QM17AAA · RSEQ M18 D1 · NBU15AAAHL · NBU14AAAHL · NLAAAHL U15 · NSU16AAAHL ·
NSU15MHL.

## Next step

The environment this is built in can only reach the NHL API, MoneyPuck and
GitHub. Setting its network access to **Full** (cloud environment menu →
Edit → Network access) lets each league's stats platform be identified and
its terms checked in one pass; allowing just `lscluster.hockeytech.com`
unblocks OHL, WHL, QMJHL, USHL, AHL and ECHL.
