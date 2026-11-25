// The token radar's model (radar-2): one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and adds the
// 200 pre-token protocols below the watchlist floor with the most TVL: the early rows the radar exists
// to find. A protocol is pre-token when its index entry records no token (no market cap, no CoinGecko
// id, no symbol); the snapshot's live-token protocols are kept apart and shown as the market's own
// values, never mixed into the ranked board.
//
// Implied value follows only from the snapshot's own figures, and it is log-scaled in TVL so a
// protocol twice as large is not automatically twice as valuable:
//
//   growth     = clamp(change_7d, -50, 100) per cent
//   growthMult = 1 + (growth / 100) x 0.6
//   maturity   = 0.70 + min(age_days, 1460) / 1460 x 0.50   (age_days unknown: 365)
//   breadth    = 1 + 0.015 x (min(chains, 4) - 1)
//   implied    = max(1, round(16 x tvl_usd^0.8 x growthMult x maturity x breadth))
//
// TVL^0.8 compresses size: a $2.75B protocol scores about $440M, a $50M one about $18M, a $5M one
// about $3M. Growth rewards a rising TVL and penalises a falling one; maturity rewards a protocol
// that has run longer with no token; breadth is a small tie-breaker for protocols live on more
// chains. No protocol name is ever special-cased: the same function scores every row.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them and the sandbox may change them. */
export interface ModelConstants {
  scale: number;
  tvl_exponent: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  breadth_per_chain: number;
  breadth_max_chains: number;
}

export const MODEL: ModelConstants = {
  scale: 16,
  tvl_exponent: 0.8,
  growth_weight: 0.6,
  growth_floor: -50,
  growth_cap: 100,
  maturity_floor: 0.7,
  maturity_range: 0.5,
  maturity_days: 1460,
  unknown_age_days: 365,
  breadth_per_chain: 0.015,
  breadth_max_chains: 4,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 200;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    scale: number;
    tvl_exponent: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  watchlist: string[];
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The four multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(protocol: SnapshotProtocol, asOf: string, model: ModelConstants): { implied: number; growthPct: number; growthMult: number; maturityMult: number; breadthMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const chainCount = Math.min(Math.max(protocol.chains.length, 1), model.breadth_max_chains);
  const breadthMult = 1 + model.breadth_per_chain * (chainCount - 1);
  const implied = Math.max(1, Math.round(model.scale * Math.pow(protocol.tvl_usd, model.tvl_exponent) * growthMult * maturityMult * breadthMult));
  return { implied, growthPct, growthMult, maturityMult, breadthMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The headline sentence's figures: how many watchlist slugs, how many rows, how many live protocols. */
export interface BoardSummary {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but the
  // board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: pre-token protocols below the watchlist floor, by TVL, capped. Never a replacement
  // for a watchlist row: a chosen protocol stays chosen.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const { implied, growthPct, growthMult, maturityMult, breadthMult, age } = impliedValue(p, snapshot.as_of, model);
    return { p, implied, growthPct, growthMult, maturityMult, breadthMult, age };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      scale: model.scale,
      tvl_exponent: model.tvl_exponent,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      breadth_multiplier: round4(s.breadthMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** A second chain when the protocol runs on more than one, else the first chain again. */
function chainTwoOf(p: SnapshotProtocol): string {
  return p.chains.length > 1 ? p.chains[1]! : chainOf(p);
}

/** The gas a single transaction costs on a chain, in the words a farmer budgets with. */
function gasFor(chain: string): string {
  const c = chain.toLowerCase();
  if (c.includes('ethereum')) return 'about $6 of gas';
  if (c.includes('solana')) return 'about $0.02 of gas';
  if (c.includes('bitcoin')) return 'about $2 of gas';
  if (c.includes('tron')) return 'about $0.50 of gas';
  if (c.includes('arbitrum') || c.includes('optimism') || c.includes('base') || c.includes('linea') || c.includes('blast') || c.includes('scroll') || c.includes('zksync') || c.includes('polygon') || c.includes('ink') || c.includes('mode')) return 'about $0.30 of gas';
  return 'about $1 of gas';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** One category group's playbook: its main action, its second action, its weekly action, its risk. */
interface GroupPlay {
  test: (c: string) => boolean;
  main: (name: string, capital: number, chain: string) => string;
  second: (name: string, capital: number, chain: string, chain2: string) => string;
  weekly: (name: string, chain: string) => string;
  risk: (name: string, capital: number, chain: string) => string;
}

const GROUPS: GroupPlay[] = [
  {
    test: (c) => c.includes('lend') || c.includes('cdp') || c.includes('collateral'),
    main: (n, k, ch) => `Supply $${k} of USDC to ${n} on ${ch} as collateral, then borrow $25 of USDC against it and repay the borrow within a week.`,
    second: (n, _k, ch, ch2) => `Borrow a second $25 from ${n} on ${ch2 === ch ? ch : ch2} and repay it the same day, so borrowing is recorded on more than one chain.`,
    weekly: (n, ch) => `Adjust the ${n} position once a week on ${ch}: top up the collateral by $10 or repay $10 of the borrow.`,
    risk: (n, _k, _ch) => `Watch ${n}'s health factor every week and keep it above 2.0; if it falls under 1.5, repay part of the borrow at once or the position can be liquidated.`,
  },
  {
    test: (c) => c.includes('dex') || c.includes('yield') || c.includes('leveraged farm') || c.includes('liquidity manager'),
    main: (n, k, ch) => `Provide $${k} of liquidity to ${n}'s main pool on ${ch} in the pair the pool already holds most of, and keep the position open.`,
    second: (n, _k, ch, _ch2) => `Swap $20 through ${n} on ${ch} once, using the pool you already hold, and keep the swap receipt beside the position.`,
    weekly: (n, ch) => `Rebalance the ${n} pool position once a week on ${ch}: collect the fees, then add half of them back as liquidity.`,
    risk: (n, k, _ch) => `Check impermanent loss on the ${n} position after a 10% move in either token; if the loss passes $${Math.round(k * 0.15)}, exit the pool and hold the single asset instead.`,
  },
  {
    test: (c) => c.includes('bridge'),
    main: (n, k, ch) => `Bridge $${k} of USDC to ${ch} through ${n}, wait for the bridged funds to arrive, then use them in an app on ${ch}.`,
    second: (n, _k, ch, ch2) => `Bridge $20 back from ${ch} to ${ch2} through ${n} and then forward again, so both directions of the bridge are recorded.`,
    weekly: (n, ch) => `Bridge $10 through ${n} to ${ch} once a week, even in a quiet week, to keep the bridging history unbroken.`,
    risk: (n, _k, ch) => `Check the bridged funds land on ${ch} within 30 minutes; if a ${n} transfer is still pending after an hour, stop bridging and check the protocol's status page first.`,
  },
  {
    test: (c) => c.includes('staking') || c.includes('restak'),
    main: (n, k, ch) => `Stake $${k} of the chain's staking asset through ${n} on ${ch} and keep the receipt token it issues.`,
    second: (n, _k, ch, _ch2) => `Restake the ${n} receipt token once on ${ch}, or delegate a second $25 stake to a different validator through ${n}.`,
    weekly: (n, ch) => `Claim the staking rewards from ${n} on ${ch} once a week and restake at least half of what you claim.`,
    risk: (n, _k, _ch) => `Check ${n}'s validator slashing history before you stake more; a validator slashed in the last 90 days is a reason to move the stake elsewhere.`,
  },
  {
    test: (c) => c.includes('perpetual') || c.includes('derivative') || c.includes('basis'),
    main: (n, k, ch) => `Deposit $${k} of USDC as margin on ${n} on ${ch} and open one small hedge, no more than a quarter of the margin.`,
    second: (n, _k, ch, _ch2) => `Close the first ${n} hedge on ${ch} and open a second one half its size, so a second trade is recorded.`,
    weekly: (n, ch) => `Rebalance the ${n} hedge once a week on ${ch}: take profit above 5% and cut the position if it falls 5% against you.`,
    risk: (n, _k, _ch) => `Keep the ${n} margin ratio above 150% at all times; a 5% move against the hedge calls for a top-up or a close, never a bigger position.`,
  },
  {
    test: (c) => c.includes('rwa'),
    main: (n, k, ch) => `Mint $${k} of ${n}'s yield-bearing asset on ${ch} and hold it so the yield accrues to your wallet.`,
    second: (n, _k, ch, _ch2) => `Reinvest the first yield payout from ${n} on ${ch}, even $5, back into the same asset.`,
    weekly: (n, ch) => `Check the ${n} yield on ${ch} once a week and compare it with the previous week; a drop of a third calls for a look at the underlying asset.`,
    risk: (n, _k, _ch) => `Check ${n}'s attestation for the underlying asset is current before you mint more; an attestation older than 90 days is a reason to wait.`,
  },
  {
    test: (c) => c.includes('curator') || c.includes('allocator') || c.includes('aggregator'),
    main: (n, k, ch) => `Deposit $${k} into a ${n} vault on ${ch} and keep the vault shares it issues.`,
    second: (n, _k, ch, _ch2) => `Deposit a second $25 into a different ${n} vault on ${ch}, or add $25 to the first vault if it is the only one.`,
    weekly: (n, ch) => `Check the ${n} vault allocation once a week on ${ch}; a shift of more than 10% in one week is worth reading the vault's own note on.`,
    risk: (n, _k, _ch) => `Check the ${n} vault's largest single allocation stays under half its funds; a vault that concentrates more than that is a reason to split the deposit.`,
  },
  {
    test: (c) => c.includes('stable'),
    main: (n, k, ch) => `Mint or deposit $${k} of the stable asset through ${n} on ${ch} and hold it in the wallet you farm with.`,
    second: (n, _k, ch, _ch2) => `Mint a second $20 of the stable asset through ${n} on ${ch} against a small deposit and hold it beside the first.`,
    weekly: (n, ch) => `Check the ${n} stable asset's peg once a week on ${ch} and record the price you see.`,
    risk: (n, _k, _ch) => `Redeem the ${n} stable asset if its peg breaks $0.99; a stable asset that stays under its peg for a day is not a hold.`,
  },
  {
    test: (c) => c.includes('insurance'),
    main: (n, k, ch) => `Buy $${k} of cover from ${n} on ${ch} for the risk the protocol prices most cheaply, and keep the policy.`,
    second: (n, _k, ch, _ch2) => `Buy a second small cover policy from ${n} on ${ch} for a different risk, so two policies are on record.`,
    weekly: (n, ch) => `Check the ${n} cover on ${ch} once a week: the amount covered, the premium paid and the expiry date.`,
    risk: (n, _k, _ch) => `File any ${n} claim within 7 days of the incident it covers; a claim filed late is the most common reason a payout is refused.`,
  },
  {
    test: (c) => c.includes('prediction'),
    main: (n, k, ch) => `Fund $${k} on ${n} on ${ch} and place one position on a market that closes within the week.`,
    second: (n, _k, ch, _ch2) => `Place a second $10 position on ${n} on ${ch} in a different market, so two markets are on record.`,
    weekly: (n, ch) => `Settle the week's ${n} positions on ${ch} and record the outcome of each before you place the next.`,
    risk: (n, k, _ch) => `Cap every ${n} position at $${Math.max(10, Math.round(k * 0.1))}; a prediction market can lose the whole stake, so no single market takes more.`,
  },
  {
    test: (c) => c.includes('launchpad'),
    main: (n, k, ch) => `Stake $${k} in ${n}'s launch pool on ${ch} to qualify for its next sale, and keep the stake through the sale window.`,
    second: (n, _k, ch, _ch2) => `Join a second ${n} sale on ${ch} with $25, even a small one, so two sales are on record.`,
    weekly: (n, ch) => `Check the ${n} sale calendar on ${ch} once a week and note the next sale's date and terms.`,
    risk: (n, _k, _ch) => `Read the ${n} sale's vesting terms before you buy; a sale that locks the tokens for a year is a different bet from one that unlocks at once.`,
  },
  {
    test: (c) => c.includes('index'),
    main: (n, k, ch) => `Buy $${k} of the ${n} index on ${ch} and hold it so the index's own rebalancing is recorded.`,
    second: (n, _k, ch, _ch2) => `Add $25 more to the ${n} index on ${ch} after its next rebalance, so two buys straddle one rebalance.`,
    weekly: (n, ch) => `Check the ${n} index weights once a week on ${ch} and note any holding that moved by more than 5%.`,
    risk: (n, _k, _ch) => `Check the ${n} index's largest holding stays under a third of the index; an index that concentrates more is a single-asset bet in disguise.`,
  },
];

/** The default playbook, for a category no group above names. */
const DEFAULT_PLAY: GroupPlay = {
  test: () => true,
  main: (n, k, ch) => `Deposit $${k} of USDC into ${n} on ${ch} and keep the position open so the activity is recorded.`,
  second: (n, _k, ch, ch2) => `Deposit a second $25 into ${n} on ${ch2 === ch ? ch : ch2}, so the position is recorded on more than one chain.`,
  weekly: (n, ch) => `Use ${n} on ${ch} once a week: a deposit, a swap or a vote, whichever the app offers that week.`,
  risk: (n, k, _ch) => `Check the ${n} position's value once a week; if its TVL falls 20% in a week, unwind $${Math.round(k / 2)} of it and wait before you add more.`,
};

/** The playbook for a protocol's category, or the default one. */
function playFor(p: SnapshotProtocol): GroupPlay {
  const c = (p.category ?? '').toLowerCase();
  for (const g of GROUPS) if (g.test(c)) return g;
  return DEFAULT_PLAY;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const chain2 = chainTwoOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasFor(chain);
  const play = playFor(p);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: `${gas} for the first transaction`,
      time: '5 minutes',
    },
    {
      text: play.main(p.name, capital, chain),
      cost: `$${capital} of capital and ${gas}`,
      time: '15 minutes to set up',
    },
    {
      text: play.second(p.name, capital, chain, chain2),
      cost: `$25 of capital and ${gas}`,
      time: '20 minutes',
    },
    {
      text: play.weekly(p.name, chain),
      cost: `${gas} a week`,
      time: '10 minutes a week',
    },
    {
      text: play.risk(p.name, capital, chain),
      cost: 'no fee to check',
      time: '10 minutes',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes, then write the wallet, the dates and every transaction in a farm log.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    watchlist: snapshot.watchlist,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
