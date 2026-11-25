// Token Radar's dashboard (radar-2). It reads window.RADAR (written beside dashboard/ by main.ts)
// and renders the ranked board, a filterable table, a per-protocol detail drawer with the model's
// own inputs and the protocol's farm plan. No network: every byte it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var WATCH = {};
  (DATA.watchlist || []).forEach(function (s) { WATCH[s] = true; });
  var state = { q: '', category: 'all', chain: 'all', watchlist: false, tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  // The model in one function (radar-2): the page recomputes a row from the snapshot figures and
  // checks the number board.json carries, so the page's code and the board's data are visibly the
  // same arithmetic. TVL is log-scaled, so size alone does not decide the rank.
  function impliedOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    var chains = Math.min(Math.max((row.chains || []).length, 1), model.breadth_max_chains);
    var breadth = 1 + model.breadth_per_chain * (chains - 1);
    return Math.max(1, Math.round(model.scale * Math.pow(row.tvl_usd, model.tvl_exponent) * growthMult * maturity * breadth));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json: category, chains, TVL and age
  // decide the action, the capital, the hold and every cost and time. No name is special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function chainTwoOf(p) { return p.chains && p.chains.length > 1 ? p.chains[1] : chainOf(p); }
  function gasFor(chain) {
    var c = (chain || '').toLowerCase();
    if (c.indexOf('ethereum') >= 0) return 'about $6 of gas';
    if (c.indexOf('solana') >= 0) return 'about $0.02 of gas';
    if (c.indexOf('bitcoin') >= 0) return 'about $2 of gas';
    if (c.indexOf('tron') >= 0) return 'about $0.50 of gas';
    if (c.indexOf('arbitrum') >= 0 || c.indexOf('optimism') >= 0 || c.indexOf('base') >= 0 || c.indexOf('linea') >= 0 || c.indexOf('blast') >= 0 || c.indexOf('scroll') >= 0 || c.indexOf('zksync') >= 0 || c.indexOf('polygon') >= 0 || c.indexOf('ink') >= 0 || c.indexOf('mode') >= 0) return 'about $0.30 of gas';
    return 'about $1 of gas';
  }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  // One playbook per category group. Each group names its own main action, second action, weekly
  // action and risk check, all filled from the protocol's own record.
  var GROUPS = [
    { test: function (c) { return c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0; },
      main: function (n, k, ch) { return 'Supply $' + k + ' of USDC to ' + n + ' on ' + ch + ' as collateral, then borrow $25 of USDC against it and repay the borrow within a week.'; },
      second: function (n, k, ch, ch2) { return 'Borrow a second $25 from ' + n + ' on ' + (ch2 === ch ? ch : ch2) + ' and repay it the same day, so borrowing is recorded on more than one chain.'; },
      weekly: function (n, ch) { return 'Adjust the ' + n + ' position once a week on ' + ch + ': top up the collateral by $10 or repay $10 of the borrow.'; },
      risk: function (n, k, ch) { return 'Watch ' + n + "'s health factor every week and keep it above 2.0; if it falls under 1.5, repay part of the borrow at once or the position can be liquidated."; } },
    { test: function (c) { return c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0 || c.indexOf('liquidity manager') >= 0; },
      main: function (n, k, ch) { return 'Provide $' + k + " of liquidity to " + n + "'s main pool on " + ch + ' in the pair the pool already holds most of, and keep the position open.'; },
      second: function (n, k, ch, ch2) { return 'Swap $20 through ' + n + ' on ' + ch + ' once, using the pool you already hold, and keep the swap receipt beside the position.'; },
      weekly: function (n, ch) { return 'Rebalance the ' + n + ' pool position once a week on ' + ch + ': collect the fees, then add half of them back as liquidity.'; },
      risk: function (n, k, ch) { return 'Check impermanent loss on the ' + n + ' position after a 10% move in either token; if the loss passes $' + Math.round(k * 0.15) + ', exit the pool and hold the single asset instead.'; } },
    { test: function (c) { return c.indexOf('bridge') >= 0; },
      main: function (n, k, ch) { return 'Bridge $' + k + ' of USDC to ' + ch + ' through ' + n + ', wait for the bridged funds to arrive, then use them in an app on ' + ch + '.'; },
      second: function (n, k, ch, ch2) { return 'Bridge $20 back from ' + ch + ' to ' + ch2 + ' through ' + n + ' and then forward again, so both directions of the bridge are recorded.'; },
      weekly: function (n, ch) { return 'Bridge $10 through ' + n + ' to ' + ch + ' once a week, even in a quiet week, to keep the bridging history unbroken.'; },
      risk: function (n, k, ch) { return 'Check the bridged funds land on ' + ch + ' within 30 minutes; if a ' + n + ' transfer is still pending after an hour, stop bridging and check the protocol\'s status page first.'; } },
    { test: function (c) { return c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0; },
      main: function (n, k, ch) { return 'Stake $' + k + " of the chain's staking asset through " + n + ' on ' + ch + ' and keep the receipt token it issues.'; },
      second: function (n, k, ch, ch2) { return 'Restake the ' + n + ' receipt token once on ' + ch + ', or delegate a second $25 stake to a different validator through ' + n + '.'; },
      weekly: function (n, ch) { return 'Claim the staking rewards from ' + n + ' on ' + ch + ' once a week and restake at least half of what you claim.'; },
      risk: function (n, k, ch) { return 'Check ' + n + "'s validator slashing history before you stake more; a validator slashed in the last 90 days is a reason to move the stake elsewhere."; } },
    { test: function (c) { return c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('basis') >= 0; },
      main: function (n, k, ch) { return 'Deposit $' + k + ' of USDC as margin on ' + n + ' on ' + ch + ' and open one small hedge, no more than a quarter of the margin.'; },
      second: function (n, k, ch, ch2) { return 'Close the first ' + n + ' hedge on ' + ch + ' and open a second one half its size, so a second trade is recorded.'; },
      weekly: function (n, ch) { return 'Rebalance the ' + n + ' hedge once a week on ' + ch + ': take profit above 5% and cut the position if it falls 5% against you.'; },
      risk: function (n, k, ch) { return 'Keep the ' + n + ' margin ratio above 150% at all times; a 5% move against the hedge calls for a top-up or a close, never a bigger position.'; } },
    { test: function (c) { return c.indexOf('rwa') >= 0; },
      main: function (n, k, ch) { return 'Mint $' + k + " of " + n + "'s yield-bearing asset on " + ch + ' and hold it so the yield accrues to your wallet.'; },
      second: function (n, k, ch, ch2) { return 'Reinvest the first yield payout from ' + n + ' on ' + ch + ', even $5, back into the same asset.'; },
      weekly: function (n, ch) { return 'Check the ' + n + ' yield on ' + ch + ' once a week and compare it with the previous week; a drop of a third calls for a look at the underlying asset.'; },
      risk: function (n, k, ch) { return 'Check ' + n + "'s attestation for the underlying asset is current before you mint more; an attestation older than 90 days is a reason to wait."; } },
    { test: function (c) { return c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('aggregator') >= 0; },
      main: function (n, k, ch) { return 'Deposit $' + k + ' into a ' + n + ' vault on ' + ch + ' and keep the vault shares it issues.'; },
      second: function (n, k, ch, ch2) { return 'Deposit a second $25 into a different ' + n + ' vault on ' + ch + ', or add $25 to the first vault if it is the only one.'; },
      weekly: function (n, ch) { return 'Check the ' + n + ' vault allocation once a week on ' + ch + '; a shift of more than 10% in one week is worth reading the vault\'s own note on.'; },
      risk: function (n, k, ch) { return 'Check the ' + n + " vault's largest single allocation stays under half its funds; a vault that concentrates more than that is a reason to split the deposit."; } },
    { test: function (c) { return c.indexOf('stable') >= 0; },
      main: function (n, k, ch) { return 'Mint or deposit $' + k + ' of the stable asset through ' + n + ' on ' + ch + ' and hold it in the wallet you farm with.'; },
      second: function (n, k, ch, ch2) { return 'Mint a second $20 of the stable asset through ' + n + ' on ' + ch + ' against a small deposit and hold it beside the first.'; },
      weekly: function (n, ch) { return 'Check the ' + n + " stable asset's peg once a week on " + ch + ' and record the price you see.'; },
      risk: function (n, k, ch) { return 'Redeem the ' + n + " stable asset if its peg breaks $0.99; a stable asset that stays under its peg for a day is not a hold."; } },
    { test: function (c) { return c.indexOf('insurance') >= 0; },
      main: function (n, k, ch) { return 'Buy $' + k + ' of cover from ' + n + ' on ' + ch + ' for the risk the protocol prices most cheaply, and keep the policy.'; },
      second: function (n, k, ch, ch2) { return 'Buy a second small cover policy from ' + n + ' on ' + ch + ' for a different risk, so two policies are on record.'; },
      weekly: function (n, ch) { return 'Check the ' + n + ' cover on ' + ch + ' once a week: the amount covered, the premium paid and the expiry date.'; },
      risk: function (n, k, ch) { return 'File any ' + n + ' claim within 7 days of the incident it covers; a claim filed late is the most common reason a payout is refused.'; } },
    { test: function (c) { return c.indexOf('prediction') >= 0; },
      main: function (n, k, ch) { return 'Fund $' + k + ' on ' + n + ' on ' + ch + ' and place one position on a market that closes within the week.'; },
      second: function (n, k, ch, ch2) { return 'Place a second $10 position on ' + n + ' on ' + ch + ' in a different market, so two markets are on record.'; },
      weekly: function (n, ch) { return 'Settle the week\'s ' + n + ' positions on ' + ch + ' and record the outcome of each before you place the next.'; },
      risk: function (n, k, ch) { return 'Cap every ' + n + ' position at $' + Math.max(10, Math.round(k * 0.1)) + '; a prediction market can lose the whole stake, so no single market takes more.'; } },
    { test: function (c) { return c.indexOf('launchpad') >= 0; },
      main: function (n, k, ch) { return 'Stake $' + k + ' in ' + n + "'s launch pool on " + ch + ' to qualify for its next sale, and keep the stake through the sale window.'; },
      second: function (n, k, ch, ch2) { return 'Join a second ' + n + ' sale on ' + ch + ' with $25, even a small one, so two sales are on record.'; },
      weekly: function (n, ch) { return 'Check the ' + n + " sale calendar on " + ch + ' once a week and note the next sale\'s date and terms.'; },
      risk: function (n, k, ch) { return 'Read the ' + n + " sale's vesting terms before you buy; a sale that locks the tokens for a year is a different bet from one that unlocks at once."; } },
    { test: function (c) { return c.indexOf('index') >= 0; },
      main: function (n, k, ch) { return 'Buy $' + k + ' of the ' + n + ' index on ' + ch + " and hold it so the index's own rebalancing is recorded."; },
      second: function (n, k, ch, ch2) { return 'Add $25 more to the ' + n + ' index on ' + ch + ' after its next rebalance, so two buys straddle one rebalance.'; },
      weekly: function (n, ch) { return 'Check the ' + n + ' index weights once a week on ' + ch + ' and note any holding that moved by more than 5%.'; },
      risk: function (n, k, ch) { return 'Check the ' + n + " index's largest holding stays under a third of the index; an index that concentrates more is a single-asset bet in disguise."; } }
  ];
  var DEFAULT_PLAY = {
    main: function (n, k, ch) { return 'Deposit $' + k + ' of USDC into ' + n + ' on ' + ch + ' and keep the position open so the activity is recorded.'; },
    second: function (n, k, ch, ch2) { return 'Deposit a second $25 into ' + n + ' on ' + (ch2 === ch ? ch : ch2) + ', so the position is recorded on more than one chain.'; },
    weekly: function (n, ch) { return 'Use ' + n + ' on ' + ch + ' once a week: a deposit, a swap or a vote, whichever the app offers that week.'; },
    risk: function (n, k, ch) { return 'Check the ' + n + " position's value once a week; if its TVL falls 20% in a week, unwind $" + Math.round(k / 2) + ' of it and wait before you add more.'; }
  };
  function playFor(p) {
    var c = (p.category || '').toLowerCase();
    for (var i = 0; i < GROUPS.length; i++) if (GROUPS[i].test(c)) return GROUPS[i];
    return DEFAULT_PLAY;
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var chain2 = chainTwoOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var gas = gasFor(chain);
    var play = playFor(p);
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: gas + ' for the first transaction', time: '5 minutes' },
      { text: play.main(p.name, capital, chain), cost: '$' + capital + ' of capital and ' + gas, time: '15 minutes to set up' },
      { text: play.second(p.name, capital, chain, chain2), cost: '$25 of capital and ' + gas, time: '20 minutes' },
      { text: play.weekly(p.name, chain), cost: gas + ' a week', time: '10 minutes a week' },
      { text: play.risk(p.name, capital, chain), cost: 'no fee to check', time: '10 minutes' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes, then write the wallet, the dates and every transaction in a farm log.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' }
    ].map(stepText);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('w') === '1') state.watchlist = true;
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.watchlist) params.set('w', '1');
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.watchlist && !WATCH[r.slug]) return false;
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  function lede() {
    var top = DATA.rows[0];
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' pre-token protocols below that floor. Implied value is a model, not a promise: it is log-scaled in TVL, so size alone does not decide the rank.' }),
        el('p', { class: 'top-pick', text: (top ? top.name + ' at ' + fmtUsd(top.implied_value_usd) + ' implied value on ' + fmtUsd(top.tvl_usd) + ' of TVL.' : '') })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Early rows below the floor' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) }))
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chainCounts = {};
    DATA.rows.forEach(function (r) { (r.chains || []).forEach(function (c) { chainCounts[c] = (chainCounts[c] || 0) + 1; }); });
    var chains = Object.keys(chainCounts).sort(function (a, b) { return chainCounts[b] - chainCounts[a]; });
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, slug or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var select = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    select.addEventListener('change', function () { state.category = select.value; writeHash(); render(); });
    var chainSelect = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c + ' (' + chainCounts[c] + ')', selected: c === state.chain ? 'selected' : null }); })
    );
    chainSelect.addEventListener('change', function () { state.chain = chainSelect.value; writeHash(); render(); });
    var watchBtn = el('button', { type: 'button', 'aria-pressed': state.watchlist ? 'true' : 'false', text: state.watchlist ? 'Watchlist only: on' : 'Watchlist only', onclick: function () { state.watchlist = !state.watchlist; writeHash(); render(); } });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), select),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSelect),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Scope' }), watchBtn),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.watchlist = false; writeHash(); render(); } })
      ));
    }
    var max = list[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num rank', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (WATCH[r.slug] ? 'Watchlist - ' : '') + (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('span', { class: 'status', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status live', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    var top = DATA.rows[0];
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        'implied = round( ' + m.scale + ' x tvl_usd^' + m.tvl_exponent + ' x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') x (1 + ' + m.breadth_per_chain + ' x (min(chains, ' + m.breadth_max_chains + ') - 1)) )'
      ),
      el('p', { class: 'sub', text: 'TVL is log-scaled with an exponent of ' + m.tvl_exponent + ': doubling TVL lifts the value by about 74%, never by double. Seven-day growth moves the value by up to 60% either way. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days. Chain breadth is a tie-breaker only, worth at most 4.5%.' }),
      el('p', { class: 'sub', text: top ? 'Worked example, rank 1: ' + top.name + ' holds ' + fmtUsd(top.tvl_usd) + ' of TVL, grew ' + fmtPct(top.change_7d) + ' in seven days, has run ' + fmtAge(top.age_days) + ' with no token on record, and scores ' + fmtUsd(top.implied_value_usd) + ' by this formula.' : '' }),
      el('p', { class: 'sub', text: 'A protocol is listed as pre-token when its record carries no token: that is what the snapshot says, never proof it has none. The live-token protocols are set aside with their market caps shown.' })
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    var why = 'Rank ' + row.rank + ' of ' + DATA.board_size + ': its TVL is ' + fmtUsd(row.tvl_usd) + ', its seven-day change is ' + fmtPct(row.change_7d) + ', and it has run ' + fmtAge(row.age_days) + ' with no token on record.';
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (WATCH[row.slug] ? ' - Watchlist' : '') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('p', { class: 'sub', text: why }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Chains' }), el('b', { class: 'num', text: String((row.chains || []).length) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: String(row.growth_multiplier) })),
        el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: String(row.maturity_multiplier) })),
        el('div', null, el('span', { text: 'Breadth multiplier' }), el('b', { class: 'num', text: String(row.breadth_multiplier) })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(impliedOf(row, DATA.model)) + (impliedOf(row, DATA.model) === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
