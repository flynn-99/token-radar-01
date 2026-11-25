# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/flynn-99/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/flynn-99/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

An entry for the make.fun bounty token-radar-01, "Build the best token launch radar": $1,325 USDC in total, $1,000 for 1st place, 10 places paid, ending 2026-12-14 10:00 UTC.

It ranks pre-token protocols by implied value derived from the sealed DefiLlama snapshot — TVL, 7-day change, age with no token, and chain breadth — and gives each one a farm plan, in a static offline dashboard. The board holds 226 rows, covers the 40-protocol watchlist 40/40, and its top row is Steakhouse Financial.

## How the model works

The radar only ranks protocols that have not launched a token yet. Each one gets
an implied value — a rough guess at what its token might be worth — built from
four things in the snapshot: how much value is locked in it (TVL), how that TVL
moved over the last seven days, how long the protocol has been running with no
token, and how many chains it lives on. A protocol with more TVL scores higher;
fast recent growth and a long token-free history push it up further, while the
number of chains is only a small tie-breaker. Nothing on the board is a fixed
list: every rank follows from those four numbers, so the same snapshot always
gives the same board.

Every row also carries a farm plan: seven steps that say what to do, what it
costs, and how long to hold, so a reader can act on a rank instead of just
reading it. The dashboard itself is a static page that works fully offline —
open it with no network and every filter, sort and detail view still works.

## Run it

```sh
MAKEFUN_OUTPUT_DIR=out node main.ts --input ../token-radar-01-kit/input/snapshot.json
```

<sub>Entered on [make.fun](https://make.fun/?ref=xht590mn&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
