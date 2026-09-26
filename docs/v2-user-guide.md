# V2 — trader guide

**Strategy + Product = Alert.** Build a strategy once, without choosing a product. Then connect it to NIFTY,
RELIANCE, GOLD or anything else to get alerts, and use Compare to see which products it suits.

Open **V2 · beta** in the sidebar. Every control has an ⓘ or a hover tooltip explaining it.

---

## First-time setup (once)

1. **Connect Kite:** Settings → Broker Connection → log in.
2. **Load products:** V2 → **Products** → **Sync from Kite**. This takes about a minute and fetches NSE indices, NSE stocks, BSE indices and MCX commodities.
3. **Alert destinations:** V2 → **Settings**:
   - Telegram chat id, and/or email recipients.
   - Press the ✈ button next to each to send a test message.
4. **Holidays:** V2 → Settings → **Market calendar**. Add this year's NSE and MCX holidays.

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

## 3. Connect and switch on (Connections tab)

1. Click **New connection**, pick the strategy, then tick one or more products.
2. Settings:
   - **Expiry:** for strategies with CE / PE legs this is the option expiry. NSE indices are weekly, so "Current" means this week.
   - **Strike positions:** "Around ATM only", or also ±1 / ±2 / ±3 strikes. Each position alerts separately.
   - **Alert when:** "Becomes true" (the first candle it turns true) or "While true". Also set a cooldown and choose Telegram and/or Email.
3. **Contracts now** shows the exact contracts each leg uses on that product, with live prices.
4. Click **Connect**, then **Switch on** each connection in the list.
   - Candles that closed before you switched on never alert.
   - ▶ **Explain now** shows why a connection would or wouldn't alert right now.

## 4. Alerts

- **Alerts tab:** active alerts (✓ to acknowledge), the full history, and every signal including suppressed ones with the reason. Expand an alert to see why it fired.
- **Telegram / email messages** list the product, strike, each leg's contract and price, and every condition with its values.

## Good to know

- **Scanning:** strategies are checked every minute during market hours (NSE/BSE 09:15–15:30; MCX 09:00–23:30 or 23:55), and also while V2 is open in a browser.
- **Duplicates:** a candle never alerts twice. Acknowledged alerts stay quiet until the strategy turns false and then true again.
- **Unknown results:** "Unknown" means not enough data, e.g. indicator warm-up or a strike that isn't listed. Unknown never alerts.
