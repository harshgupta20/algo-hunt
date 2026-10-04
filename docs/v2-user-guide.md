# V2 — trader guide

**Strategy + Product = Alert.** Build a strategy once, without choosing a product. Then connect it to NIFTY,
RELIANCE, GOLD or anything else to get alerts, and use Compare to see which products it suits.

Open **V2** in the sidebar (the home page opens it too). Every control has an ⓘ or a hover tooltip explaining it.

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

## 2b. Backtest with money (Backtest tab)

"If I had traded this strategy on these products with this money, what would I have made?" Nothing is saved or sent.

1. Pick a strategy (or press **Backtest** on its card), up to 20 products and a period (**5 days / 10 days / Max** —
   as far back as the trigger timeframe allows, e.g. 20 days of 15-minute candles).
2. Set the **starting capital** (₹1,00,000 by default, or **No limit**). The trade settings start from the strategy's
   paper settings — cash per trade, target, stop-loss, square-off, charges, slippage, and what each group trades —
   change them here just for this test.
3. **Backtest**: every alert the strategy would have sent is traded like a paper trade — entered at the alert
   candle's close (± slippage), followed minute by minute on the contract's Kite 1-minute candles to the target,
   stop-loss (if both fall in the same minute the stop counts; a gap through the stop fills at that minute's open),
   the other group, the 15:20 / 23:20 square-off, expiry, or the end of the test. A trade opens only if the money
   that's free (capital + profit so far − money in open trades) covers it; otherwise it's listed under **Alerts not
   traded** with the reason.
4. Results: **final capital** (and the lowest the account went), net P&L, return on capital, win rate, profit factor,
   drawdown, the P&L charts, **by product** (open a row for the contracts used and data notes), every trade (CSV).
   When nothing was traded, a box at the top says why — no alerts in the period, or every alert skipped (grouped by
   reason, with what to change: e.g. *Not enough money* → raise the capital, a futures lot needs its margin of about
   ₹1.4–2.3 lakh; *After the square-off* → switch **Square off daily** off). Products whose candles couldn't be read
   are listed there too.

Needs a **Kite login** (candles come from Kite) — without one it says so instead of running. **Daily / weekly
strategies** alert at the 15:30 close, after the square-off time: switch **Square off daily** off to trade them
(held overnight, closed by the target / stop-loss / expiry / end of the test).

Limits (as Compare): contracts are the ones listed today, with option strikes fixed around ATM at the start of the
period; Kite has no candles for expired contracts.

**Exit rules** (Backtest only for now): under the trade settings, each group that trades can get its own
**Exit when…** conditions — the same builder as the strategy's (any leg, timeframe and indicator; AND / OR).
Quick buttons add the usual ones on the traded contract: **RSI turns** (crossed below 40), **Price crosses SMA**
(close crossed below SMA 20) and **3-candle low** (close crossed below the lowest low of the previous 3 candles; for a
sell they are mirrored). They're checked at every close of the smallest timeframe used; the trade exits at that
close (*Exit rule* in the trade list). Target, stop-loss, square-off and the other exits still apply — whichever
comes first. The results' notes repeat the rules in words.

MCX quantities are in the exchange's units: one CRUDEOIL lot is 100 barrels, Gold Mini 100 g (priced per 10 g),
Copper 2,500 kg, … — so a single lot often needs more than the cash per trade (shown *over budget*).

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
connection opens a paper trade automatically, with these defaults: **₹10,000 per trade**, target **+20 %**, stop-loss
**−10 %**, intraday square-off **15:20** (NSE / BSE) and **23:20** (MCX), exit when the other group fires, charges and
**0.5 %** slippage on.

**Changing the values**

- **For a whole strategy:** open it (Strategies → ✎) → **4 · Paper trading**. These are the defaults all its
  connections use, plus **what to trade**: one row per top-level group (a strategy whose top level is OR — e.g.
  Bullish / Bearish), or one for the whole strategy — the leg (by default the group's option leg, else its future)
  and **Buy** or **Sell**. "Don't trade" turns a group into an exit signal only. Untick the box to stop paper trading
  the strategy. Changing only the paper settings doesn't create a new strategy version.
- **For one connection:** click its **📄 chip** (Connections tab, or the ranking on the Paper tab) — e.g.
  `📄 ₹10,000 · +20/−10%`. Change cash, target, stop-loss, square-off, slippage or charges, or switch paper trading
  off for that connection only. Values that differ from the strategy's are highlighted **own** (click ↺ to go back);
  **Use strategy's settings** forgets them all. The chip is marked **OWN** when a connection has its own values.

**How trades work**

- **Size:** as many whole lots as the cash per trade covers — at least one lot, flagged **over budget** when one lot
  costs more. Bought options and stocks count the premium / price; futures and sold options count an estimated
  margin (≈12 % of the contract value for indices, 20 % stocks, 10 % MCX).
- **One position per connection and strike position.** The same group firing again keeps it; the other group firing
  closes it (if "Exit when another group fires" is on) and opens its own.
- **Closes** at the target (at the target price), the stop-loss (at the price that crossed it, with slippage — if
  both are reached at once the stop counts), the daily square-off, or the contract's expiry (square-off off). No new
  trades after the square-off time or while the market is closed. An index Spot leg can't be traded.
- The alert message gets a line such as `📄 Paper: BUY 1 lot (75) NIFTY…25000CE @ ₹100.50 · target ₹120.60 · stop ₹90.45`.
- With the live worker running, targets and stop-losses are checked on every tick; without it, the per-minute scanner
  checks them on the latest price once a minute.

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

## Good to know

- **Scanning:** with the live worker running, connections are checked seconds after each candle closes. Without it, they're checked every minute during market hours (NSE/BSE 09:15–15:30; MCX 09:00–23:30 or 23:55), and also while V2 is open in a browser.
- **Duplicates:** a candle never alerts twice. Acknowledged alerts stay quiet until the strategy turns false and then true again.
- **Unknown results:** "Unknown" means not enough data, e.g. indicator warm-up or a strike that isn't listed. Unknown never alerts.
