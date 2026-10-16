# Market — eagle view (`/market`)

The whole Indian market on one page, for the trader's daily look: **Market** in the sidebar. It refreshes itself:
every 20–30 seconds while NSE is open, every few minutes when it's closed. Every panel and control has a tooltip
explaining how to read it.

> Related: [api.md](api.md) · [status.md](status.md) · [architecture.md](architecture.md)

## 1. What's on the page (top to bottom)

| Panel | What it shows | Source |
| --- | --- | --- |
| **Header** | Session (pre-open / open / closed) with IST clock and countdown, where stock prices come from (Kite live / NSE), last update, refresh | NSE |
| **Index pulse** | Nifty 50, Sensex, Bank Nifty, Fin Nifty, Midcap 100, Smallcap 100, India VIX: level, change, today's line vs yesterday's close, day range, distance from the 52-week high | NSE · Sensex and lines from Yahoo |
| **The market in 30 seconds** | Plain sentences written from the numbers: index and breadth (broad or narrow move), mid / small caps vs the Nifty, leading and lagging sectors, VIX band, FII / DII cash, FII long % in index futures, 52-week highs vs lows, options-implied move, the world | all of the below |
| **Breadth** | Up vs down for Nifty 50 / 500 / Midcap 150 / Smallcap 250, 52-week highs vs lows, a VIX meter | NSE |
| **Market map** | Every stock as a tile grouped by sector: colour = today's move (the % is printed), size = money traded (or equal). Universe: Nifty 50 / 100 / 500, Midcap 150, Smallcap 250, F&O. A bell marks stocks your V2 strategies alerted on today | Kite (all Nifty 500, live) or NSE sector-index stocks without Kite |
| **Sectors, themes & styles** | 18 sectors, 22 themes (defence, railway PSUs, EV, digital…), 8 styles (momentum, quality, value, low vol…) ranked by today / 1W / 1M / 1Y, with breadth and P/E. Click a sector → its stocks on the map | NSE |
| **Sector rotation** | Each sector's 1-month vs 1-week move relative to the Nifty: Leading / Weakening / Lagging / Improving | NSE |
| **Movers** | Gainers, losers, most active (value), volume shockers (× 1-week average), 52-week highs / lows, gap up / down, Open = Low / Open = High, circuits, pre-open (09:00–09:15) | map data + NSE |
| **Key levels** | Pivots S3–R3 and the central pivot range (CPR) for Nifty, Bank Nifty, Fin Nifty, Sensex from the last completed session; CPR width (narrow / normal / wide) and where price is | NSE (closed) / Yahoo daily bars (open) |
| **F&O pulse** | Nifty & Bank Nifty option chains at the nearest expiry: PCR, max pain, put wall (support), call wall (resistance), ATM-straddle expected move and range, OI by strike. OI build-up (long build-up, short build-up, short covering, long unwinding). Who holds index F&O (FII / DII / Pro / Client, FII long % for 5 days). Index futures premium | option chain: **Kite**; the rest NSE |
| **Money flow** | FII / DII cash buy, sell, net (history kept by the app, see §3); bulk & block deals with buyer / seller | NSE |
| **World** | US, Europe, Asia indices; Brent, gold, silver, copper, natural gas; USD/INR, dollar index, US 10-year yield; bitcoin — with intraday lines | Yahoo Finance |
| **News & innovation** | ET, Mint, Business Standard (markets, economy, companies), ET Tech, Mint Tech, Inc42, YourStory — newest first, tagged with the companies they mention and those stocks' moves today. Filters: category, watchlist, today's movers (±3%), search | RSS feeds |
| **Calendar & filings** | Results & board meetings (next 3 weeks), dividend / split / bonus ex-dates, latest company filings (PDF links); Nifty 500 only by default | NSE |
| **Company panel** | Click any stock anywhere: price, day and 52-week ranges, today's line, open / close / value / volume, alerts today, upcoming events, 7 days of news (Google News), 30 days of NSE filings, links to a TradingView chart and NSE | Kite / NSE, Yahoo, Google News |
| **Watchlist** | Pin stocks (☆) from movers or the company panel; they sit in the bar under the header with today's move. Kept in this browser / the desktop app | — |
| **Data** (footer) | Every source and whether it's answering | — |

## 2. How the data is fetched

`src/server/market/` serves `/api/market/{overview,map,movers,options,global,news,calendar,company/:symbol}`.

- **No database.** Market data lives in memory (`cache.ts`): each piece is reused for its TTL (seconds while open,
  minutes–hours when closed), then served once more while a background refresh runs; concurrent requests share one
  fetch; a failing source keeps its last good data and is left alone for 30 s–2 min. The page only polls while
  it's open, so nothing runs when nobody looks.
- **Kite** (your session): one quote request for all ~500 Nifty 500 stocks (every 15 s while open), and the
  Nifty / Bank Nifty option chains (±20 strikes around ATM, every minute) using the contracts V2 already synced.
  Without a Kite login the map uses NSE's sector-index stocks (~240, every 2 min) and the option chain is hidden.
- **NSE website** (`www.nseindia.com/api`, `archives.nseindia.com`): unofficial endpoints NSE's own pages use — at
  most one request at a time per host, ≥ 300 ms apart. NSE can change or block them; panels then show their last
  data and the footer turns red.
- **Yahoo Finance**: the spark endpoint takes 20 symbols per request (world: 2 requests every 3 min).
- **News**: 13 RSS feeds every 5 min; companies are tagged by name, known aliases (RIL, L&T, HUL…) or their NSE
  symbol in capitals.

## 3. Files on disk

`data/market-history.json` (next to `pending-writes.json`; the desktop app keeps it in its data folder): one entry
per day of FII / DII cash flows. NSE publishes only the latest day, so the history chart fills in as days pass.

## 4. Limits

- Unofficial sources (NSE website, Yahoo, feeds) can be late, wrong or blocked; nothing here is advice.
- Sector P/E, breadth and 1W / 1M / 1Y moves are NSE's index figures; the map's sector header is the equal-weighted
  average of the stocks shown.
- The pivot / CPR "narrow → trending day" note and the VIX bands are common rules of thumb, labelled as such.
- NSE holidays: the session comes from NSE's market status, so the page knows a holiday; the header countdown
  doesn't (it says "next trading day").
