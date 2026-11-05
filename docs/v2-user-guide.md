# V2 — trader guide

**Strategy + Product = Alert.** Build a strategy once, without choosing a product. Then connect it to NIFTY,
RELIANCE, GOLD or anything else to get alerts, and use Compare to see which products it suits.

Open **V2** in the sidebar (signing in opens it too; the home page `/` is the product landing page). Every control has an ⓘ or a hover tooltip explaining it.

---

## First-time setup (once)

1. **Connect Kite:** Settings → Broker Connection → log in.
2. **Load products:** V2 → **Products** → **Sync from Kite**. This takes about a minute and fetches NSE indices, NSE stocks, BSE indices and MCX commodities.
3. **Alert destinations:** V2 → **Settings**:
   - **Telegram chats:** everyone who should get alerts. Each person first opens our bot **[@algohuntbot](https://t.me/algohuntbot)** in Telegram ([Telegram Web](https://web.telegram.org/k/#@algohuntbot)) and presses **Start** — for a group, add @algohuntbot to it. Then press **Find chat IDs**, **Add** them, give each a name, and **Save**. Every alert goes to all of them. **Copy invite link** copies the bot's link to send to teammates.
   - Email recipients (optional).
   - Press the ✈ button next to each to send a test message.
4. **Holidays:** V2 → Settings → **Market calendar**. Add this year's NSE and MCX holidays.

## Live alerts on your computer (recommended)

Without it, connections are checked once a minute by a scanner that downloads candles from Kite (about 150 a minute),
so with many products alerts can be a few minutes late. The **live worker** streams prices instead and checks every
connection within seconds of each candle close.

**Every market day:**

1. Log in to Kite in the app (Settings → Broker Connection). If you forget, the worker sends a Telegram reminder 15 minutes before the open.
2. In the project folder run `npm run live` and leave the window open. Keep the computer awake until your last market closes (MCX runs until 23:30 or 23:55).
3. V2 → **Dashboard → Live feed** shows its state:
   - **Warming up:** it's loading candle history for the contracts in use. This takes a few minutes, and results are checked on Kite's candles meanwhile.
   - **Live:** it's streaming. Each candle close is listed with "decided in" (usually 2–3 seconds).

The first time, run `npm run live -- --check`. It connects to Kite, prints a few NIFTY 50 prices and exits.

**Accuracy: every alert is checked on Kite's own candles.**
- When a condition looks true, or is within a whisker of its level and could matter, the worker downloads Kite's official candle a few seconds after the close. It alerts only if Kite's candle agrees.
- Alerts are marked **✓ Verified**.
- If Kite's candles haven't arrived after 2 minutes, it still alerts, marked **Unverified**.
- **Checked / corrected** on the Live feed card counts how often Kite's candles were used and how often they changed the result.

**If something goes wrong:** if the internet drops or the computer sleeps, the per-minute scanner takes over by itself and Telegram tells you. Alerts are then a few minutes late until the worker is back.

**Limits:** Kite allows 9,000 streamed contracts per login.
- Each connection needs its legs at ATM, plus 2 strikes either side kept ready for ATM moves.
- For example, 210 F&O stocks with FUT + CE + PE at ATM use about 2,500 (4 in use + 8 nearby strikes each).
- If you go over, the extra connections are checked by the per-minute scanner, and the card says so.

## 1. Build a strategy (Strategies tab)

1. Click **New strategy**, or start from an example:

   | Example | What it checks |
   | --- | --- |
   | Future leads the call | FUT RSI above the ATM call's RSI, and the call's RSI crosses 60 |
   | Call up, put down | ATM call RSI up, ATM put RSI down |
   | Future + 3 options | 4 legs |
   | Spot breakout | 1 leg; works on cash stocks |

2. **Legs (1–4).** Choose what the strategy watches. No product yet.
   - **SPOT**: index value or stock cash price.
   - **FUT**: the future.
   - **CE / PE**: a call or put at **ATM**, **ATM+1**, **ATM−2**, …
   - Give a leg a name if you like (e.g. "Hedge put").
3. **When.** Choose the evaluation clock, e.g. every closed 15-minute candle.
4. **Conditions.** Compare any leg with any other leg, or with a number. Each value has its own timeframe and candle type (Normal, Heikin Ashi, Volume).
   - Examples: *A · FUT RSI(14) > B · CE ATM RSI(14)*, *B · CE ATM Close crossed above B · CE ATM SMA(20)*.
   - **Future AND options:** click **+ Condition** once per rule and pick the leg for each row:
     ```
     AND
       A · FUT    RSI(14) crossed above 60
       A · FUT    Close > SMA(20)
       B · CE ATM RSI(14) crossed above 60
       C · PE ATM RSI(14) < 40
     ```
   - **Need a leg you haven't added?** Pick **+ Add FUT / CE ATM / PE ATM / SPOT leg** at the bottom of any Leg list. The leg is added to section 1 and used by that condition. With only one leg, a hint above the conditions offers the same buttons.
   - **Bollinger Bands and moving averages** are price levels, so you never type a number for them. Choosing Bollinger **Upper / Middle / Lower** (or SMA, EMA, the Supertrend line) makes the condition read *Close crossed above Bollinger Upper* automatically.
   - **N-candle low / high** is the lowest low (or highest high) of the previous N candles, not counting the current one: *Close crossed below Lowest low (3 candles)* = the 3-candle low is broken; *Close crossed above Highest high (20 candles)* = a 20-candle breakout.
     - **%B** and **Bandwidth %** are readings, so they get a number (%B 1 = on the upper band, Bandwidth 2 = a tight squeeze).
     - Older conditions like "Bollinger Upper crossed above 60" show a one-click **Compare Close with it** fix.
   - Combine conditions with AND / OR groups and NOT. Name a group (e.g. "Future conditions", "Option conditions") so the preview and alerts read clearly.
5. Check the **Preview** and **Validation** on the right.
6. **Try on a product.** Pick one product and press Run. You'll see every condition's current value and whether it would alert now. Nothing is saved or sent.
7. **Save.** Every save is a new version, and alerts show which version fired.

## 2. Compare products (Compare tab)

1. Pick the strategy and up to 20 products. Products that lack a leg the strategy needs are greyed out ("can't run").
2. Choose a period, expiry and alert rule, then press **Compare**.
3. Products are ranked by how many alerts the strategy would have given:
   - Click a row to see each alert with the leg prices and conditions.
   - **Coverage** shows how many candles had enough data. Low coverage means the count isn't reliable, e.g. an option that didn't exist yet.
4. Press **Connect** on the products you want to follow.

## 2b. Backtest (Backtest tab)

"If I had traded this strategy on these products, what would I have made?" The backtest trades exactly what paper
trading trades — the strategy's **paper plan** (section 5). Nothing is saved or sent unless you press **Save to
strategy**.

1. Pick a strategy (or press **Backtest** on its card), products and a period — type the dates or press a quick period
   (**1D · 5D · 1W · 10D · 1M · 3M · 6M · 1Y · 2Y · 3Y**, the last N days ending today, Friday at a weekend; the Options
   backtest has 1D … 3Y ending yesterday). Futures and options have data only from when today's contract began trading.
2. **Trades — the strategy's plan**: lots per trade (₹ per trade for stocks), target, stop-loss, trailing stop, watch
   window, square-off, charges, slippage, what each group trades and its trailing rules — exactly what
   paper trading uses. Change anything to try it out: changed values are highlighted (↺ goes back), and **Save to
   strategy** makes them the strategy's plan so paper trading uses them from the next alert. "Same as the strategy"
   means paper trading trades exactly this. There is **no starting capital**: like paper trading, every alert trades.
3. **Backtest**: every alert the strategy would have sent is traded like a paper trade — entered at the alert
   candle's close (± slippage), followed minute by minute on the contract's Kite 1-minute candles to the target,
   stop-loss or trailing stop (a stop and the target in the same minute → the stop counts; a gap through the stop
   fills at that minute's open; the trailing stop follows the best price of the minutes before), a trailing rule,
   the other group, the 15:20 / 23:20 square-off, expiry, or the end of the test. With **Trailing SL** on, the
   target starts trailing instead of closing the trade (section 5).
4. Results: net P&L, **money needed** (the most in use at once) and the return on it, win rate, profit factor,
   drawdown, the P&L charts, **by product** (open a row for the contracts used and data notes), every trade (CSV) —
   click a trade for its **story** (section 5).
   When nothing was traded, a box at the top says why — no alerts in the period, or every alert skipped (grouped by
   reason, with what to change: e.g. *After the square-off* → switch **Square off daily** off). Products whose
   candles couldn't be read are listed there too.

Needs a **Kite login** (candles come from Kite) — without one it says so instead of running. **Daily / weekly
strategies** alert at the 15:30 close, after the square-off time: switch **Square off daily** off to trade them
(held overnight, closed by the target / stop-loss / expiry / end of the test).

Limits (as Compare): contracts are the ones listed today, with option strikes fixed around ATM at the start of the
period; Kite has no candles for expired contracts.

Trailing rules, the trailing stop and the watch window are part of the plan — see section 5. The results' notes
repeat them in words.

MCX quantities are in the exchange's units: one CRUDEOIL lot is 100 barrels, Gold Mini 100 g (priced per 10 g),
Copper 2,500 kg, … — the money a lot needs follows from that.

## 2c. Backtest options on expired contracts (Options section)

**Options** in the sidebar (`/options`): the Backtest on contracts **as they were listed** — expired ones included —
from **Upstox** instead of Kite, on the strategies you build in V2 → Strategies. Use it for option (and futures)
strategies over weeks and months: Kite only has today's contracts.

- **Every trigger candle re-picks the legs the way the live scanner does**: the expiry of that day (current / next /
  far among the expiries listed then — on an expiry day the expiring contract is still current) and the strike
  nearest the index's (or stock's) close on that candle, plus the strike position. Each contract keeps **its own lot
  size** (NIFTY was 75 a lot before 65, …). A unit met for the first time takes its previous result from that unit,
  exactly like the scanner, so "becomes true" alerts behave the same.
- Trades are the Backtest's (the same code, the same plan): entry at the alert candle's close ± slippage, exits on the
  traded contract's 1-minute candles, charges. **Trailing rules** are checked on the legs the trade was opened with.
- **Trades are sized in lots** (the plan's *Lots per trade*, 1 by default) × each contract's own lot size — the money
  follows from the premium (or an estimated margin for futures and sold options). No starting capital.
- **Products**: NSE and BSE indices and stocks with F&O. **No MCX** — Upstox has no expired MCX contracts.
- **Period**: complete past days (it ends yesterday at the latest). Upstox keeps about **six months** of expired
  contracts. Days before Upstox's first known expiry, or around an expiry missing from its list, are **not tested**
  (the product row says which days and why) — the test never guesses which contract was current.
- Results look like the Backtest's; a product row's **contracts** list how many contracts each leg used over how
  many expiries (first … last).

**Setup (once)**: an Upstox account with **Upstox Plus** turned on (free; brokerage on that account becomes ₹30 an
order), an app at https://account.upstox.com/developer/apps with Redirect URL `http://localhost:3000/redirect/upstox`,
and in `.env`: `UPSTOX_API_KEY`, `UPSTOX_API_SECRET`, `UPSTOX_REDIRECT_URI=http://localhost:3000/redirect/upstox`
(exactly as saved on the app). Restart the app (it adds the `upstox_session` table). **Each day**: **Connect Upstox**
on the Options page — Upstox ends every login at 3:30 AM IST.

Upstox allows about 2,000 requests per 30 minutes; the app paces itself under that, so a long period on many products
just takes longer. A re-run reuses what was already fetched while the app keeps running.

## 3. Connect and switch on (Connections tab)

1. Click **New connection**, pick the strategy, then tick one or more products.
   - Only products that have every leg the strategy uses are listed. A FUT + CE + PE strategy lists the F&O stocks, the indices and the MCX commodities, not cash-only stocks. The type buttons show how many there are, e.g. **Stocks (210)**.
   - **Select all listed** ticks everything in the list, up to 500 per Connect. Click it again to untick them. Products already connected to the strategy are marked "connected" and skipped.
   - The amber line under the settings estimates the scanner load. Each product costs one candle request per leg each candle, and option legs cost one per strike position. Kite allows about 3 requests a second, so the scanner fetches up to 150 a minute (Settings → Requests per cycle). With 210 F&O stocks on a 3-leg, 5-min strategy (≈630 requests), the last stocks are checked up to about 5 minutes after the candle closes.
2. Settings:
   - **Expiry:** for strategies with CE / PE legs this is the option expiry. NSE indices are weekly, so "Current" means this week.
   - **Strike positions:** "Around ATM only", or also ±1 / ±2 / ±3 strikes. Each position alerts separately.
   - **Alert when:** "Becomes true" (the first candle it turns true) or "While true". Also set a cooldown and choose Telegram and/or Email.
3. **Contracts now** shows the exact contracts each leg uses on that product, with live prices.
4. Click **Connect**, then **Switch on** each connection in the list, or press **Switch all on** in the strategy's header to start them all at once.
   - **Switch all off** stops every connection of that strategy; click it twice to confirm.
   - The chevron (or the strategy's name) minimizes a strategy's list to one line; **Collapse all / Expand all** does every strategy. This is remembered in your browser.
   - Candles that closed before you switched on never alert.
   - ▶ **Explain now** shows why a connection would or wouldn't alert right now.

## 4. Alerts

- **Alarm in the app:** while the app is open in a browser, a new alert rings a loud alarm tune, shows an amber alert card at the top of the page and flashes the tab title. It repeats every 6 seconds until you press **Stop**, open **Alerts**, acknowledge the alert, or click the desktop notification (at most 90 seconds). Settings → Notifications: turn the tune or the repeat off, or press **Test alert** to hear it. Browsers only allow sound after you've clicked the page once; if the sound was blocked, the card shows **Play sound**.

- **Alerts tab:** active alerts (✓ to acknowledge), the full history, and every signal including suppressed ones with the reason. Expand an alert to see why it fired.
- **Telegram / email messages** list the product, strike, each leg's contract and price, and every condition with its values.

## Filters (Alerts and Paper tabs)

One filter bar on both tabs, remembered in your browser (separately for each tab):

- **Strategy** chips show how many alerts (signals, paper trades) each strategy has with the other filters — e.g.
  *5Mint. RSI + Bollinger 33 · 15Mint. RSI + Bollinger 127*. Click one or several to see only theirs, together (none
  = every strategy); the numbers don't change with that choice, only with the period, type, market and the rest.
- **Period** (Today · Yesterday · 7 days · 30 days · All · Custom dates, IST) and **product** search
  (symbol contains, e.g. NIFTY).
- **Filters** row — click chips to narrow (several in a row combine, none = all): **Type** (Index / Stock /
  Commodity), **Market** (NSE / BSE, MCX), **Timeframe** (the strategies' trigger candles), **Group** (the top-level
  group that fired, e.g. Bullish / Bearish). Alerts also offer **Candles** (Verified / Kite candles / Live candle /
  Not verified) and **Delivery** (Sent / Partial / Failed / Acknowledged); Signals offer **Outcome**; Paper offers
  **Side** (Buy / Sell).
- **Clear** resets everything; the count at the right shows how many records are listed (a **+** means more load as
  you scroll). Long lists — alerts, signals, the paper trade log, backtest trades, products — show 50 (products 100)
  at a time and load the next page by themselves when you scroll to the end (or press **Load more**); every filter
  applies to every page. The trade log's **All / Winners / Losers** counts come from the results above, and **CSV**
  exports every matching trade, not just the loaded pages. On the Paper tab the period applies to the results and the
  trade log; open positions are always shown (other filters still apply).

## 5. Paper trading (on for every connection)

See what your alerts would have made — nothing is ever sent to your broker. Every alert of every switched-on
connection opens a paper trade automatically, with these defaults: **1 lot per trade** (futures and options;
**₹10,000** per trade for stocks), target **+20 %**, stop-loss **−10 %**, no trailing stop, the whole session watched,
intraday square-off **15:20** (NSE / BSE) and **23:20** (MCX), exit when the other group fires, charges and **0.5 %**
slippage on. Both backtests trade the same plan.

**Changing the values**

- **For a whole strategy:** open it (Strategies → ✎) → **4 · Paper trading**. These are the defaults all its
  connections use, plus **what to trade**: one row per top-level group (a strategy whose top level is OR — e.g.
  Bullish / Bearish), or one for the whole strategy — the leg (by default the group's option leg, else its future)
  and **Buy** or **Sell**, and each group's **trailing rules**. "Don't trade" turns a group into an
  exit signal only. Untick the box to stop paper trading the strategy. Changing only the paper settings doesn't
  create a new strategy version. (A backtest's **Save to strategy** saves here too.)
- **For one connection:** click its **📄 chip** (Connections tab, or the ranking on the Paper tab) — e.g.
  `📄 1 lot · +20/−10% · trailing from target`. Change lots (₹ for stocks), target, stop-loss, Trailing SL, watch window,
  square-off, slippage or charges, or switch paper trading off for that connection only. Values that differ from the strategy's are highlighted **own** (click ↺ to go back);
  **Use strategy's settings** forgets them all. The chip is marked **OWN** when a connection has its own values.

**How trades work**

- **Size:** futures and options take the plan's **lots per trade** × each contract's own lot size (the way Kite's
  F&O order window and Streak size them); stocks take as many whole shares as the **₹ per trade** buys (at least one,
  flagged **over budget** when one share costs more) — a ₹ amount keeps stocks of very different prices comparable.
  Money used: the premium / price for bought options and stocks, an estimated margin for futures and sold options
  (≈12 % of the contract value for indices, 20 % stocks, 10 % MCX).
- **Stop-loss, target and the Trailing SL switch:**
  - **Trailing SL off** (the default): a normal trade — the stop-loss and the target close it, whichever comes first.
  - **Trailing SL on:** the stop-loss guards the trade until the target. Reaching the target **doesn't close it** —
    it is the trigger: from there the stop-loss and target no longer apply, and your **trailing rules** close the trade
    (plus square-off, expiry and the other group). A winner isn't capped at the target. It needs a target (switching
    it on fills one in) and at least one trailing rule — nothing else to fill in.
  - Example — buy at ₹100, stop-loss 10 %, target 20 %, rule "close below the previous candle's low": until ₹120 only
    the ₹90 stop-loss counts; from ₹120 the trade runs as long as each candle closes above the previous one's low.
  - The rules are checked at candle closes, so after the target a sharp fall inside a candle is caught at that
    candle's close.
  - Per connection (📄 chip) Trailing SL can be switched on or off; the rules are the strategy's, so it can be
    switched on only when the strategy has trailing rules. A connection without a target trades normally.
  - Trades opened before 4 Nov keep the rules they were opened with.
- **Trailing rules** (with Trailing SL, per group — shown only while it's on): **Close the trade when…** — the
  strategy's condition builder (any leg, timeframe, indicator; AND / OR). Quick buttons add the usual ones on the
  traded contract: price crosses **SMA**, the **previous candle's low** broken, the **3-candle low** broken, **RSI
  turns** — mirrored for a sell. Checked from the target on, at every close of the smallest timeframe used, on Kite's
  candles (live: a few seconds after the close, once Kite publishes it); the trade closes at that close (live: the
  price right after). Shown as *Trailing rule*. Switching Trailing SL off keeps them in the plan, unused. (Target
  conditions and the trailing stop % were removed on 4 Nov 2026; plans saved before the switch existed have it on
  when they had trailing rules. Trades already opened with a trailing % keep trailing by it.)
- **Watch window** (optional): **Only between set times** — e.g. 09:30 – 15:00 to skip the jumpy last half hour. A
  trigger candle has to lie inside (open at or after "from", closed by "until"): outside it **no alert is sent** and
  no trade opens — in paper trading, Compare and both backtests. Trades already open are still managed. Times for
  NSE / BSE and MCX; intraday timeframes only. Set it per strategy, per connection (📄 chip) or per backtest.
- **One position per connection and strike position.** The same group firing again keeps it; the other group firing
  closes it (if "Exit when another group fires" is on) and opens its own.
- **Closes** at the target (at the target price — only with Trailing SL off), the stop-loss (before the target) or
  trailing stop (at the price that crossed it, with slippage — if a stop and the target are reached at once the stop
  counts), a trailing rule, the daily
  square-off, or the contract's expiry (square-off off). No new
  trades after the square-off time or while the market is closed. An index Spot leg can't be traded.
- The alert message gets a line such as `📄 Paper: BUY 1 lot (75) NIFTY…25000CE @ ₹100.50 · target ₹120.60 · stop ₹90.45`
  (with Trailing SL: `target ₹120.60 starts trailing 10%`).
- With the live worker running, targets, stop-losses and trailing stops are checked on every tick (trailing rules
  every 10 seconds, once a candle closes); without it, the per-minute scanner checks them once a minute.
- **Saved on this computer, synced at the close.** Every paper trade is saved on your computer the moment it opens
  or closes (open positions' latest prices every 30 seconds), so closing the app or a restart loses nothing. A few
  minutes after each market closes (NSE / BSE 15:30, MCX 23:30 or 23:55) the day's trades go to the database in one
  go. The Paper tab shows it next to **Refresh**: how many trades wait and when they go, or when the last sync was.
  If the app is off at a close it syncs when it starts again.

**The Paper tab** — narrow it with the filter bar (strategy, period, type, market, product, timeframe, group, side):

- **Headline:** net P&L (and today's), return on the **money needed** (the most money in use at once), win rate,
  **profit factor** (money won ÷ money lost — above 1 pays, 1.5+ is solid), average trade, max drawdown.
- **Profit & loss:** the cumulative curve, or **By day** bars. **How trades closed** (target / stop-loss / square-off /
  other group / expiry, with the P&L of each) and **P&L by entry time** (which hours of the day work).
- **Connections ranked** (or **Strategies**): every switched-on connection with its trend, trades, win rate, profit
  factor, average trade, net P&L, return and drawdown — click a column title to sort. "few" marks fewer than 10
  trades (too few to judge). The 📄 chip edits that connection's values right there.
- **Open positions** at the latest price, with a **stop → target** bar showing where each one stands; **Close**
  closes one now.
- **Trade log:** all / winners / losers, **CSV** download. In the Strategies view, ✎ opens a strategy's paper
  settings and 🗑 deletes its paper trades to start over.
- **A trade's story** — click any trade (open positions, the trade log, both backtests): its price from the entry to
  the exit and a little after (1-minute candles, merged into bars so the whole trade fits), with the entry, the
  target and the stop as it moved; and a timeline in words — the entry and its levels, when the target was reached
  and trailing started, when the trailing stop took over from the stop-loss and each time it rose (a long run is
  folded), why it closed (for a trailing rule, the rule itself) and what the price did after. Plus the best and worst
  price while held, how much of the best was **given back**, and the stop at the exit. Backtest trades carry their
  path; a paper trade's is read from Kite when opened (Kite doesn't keep expired contracts' candles — then only the
  timeline shows).

## Good to know

- **Scanning:** with the live worker running, connections are checked seconds after each candle closes. Without it, they're checked every minute during market hours (NSE/BSE 09:15–15:30; MCX 09:00–23:30 or 23:55), and also while V2 is open in a browser.
- **Duplicates:** a candle never alerts twice. Acknowledged alerts stay quiet until the strategy turns false and then true again.
- **Unknown results:** "Unknown" means not enough data, e.g. indicator warm-up or a strike that isn't listed. Unknown never alerts.
