# Smallcap & Microcap Terminal

A free, self-updating terminal for the Nifty Smallcap 250 and Nifty Microcap 250, built from public NSE data.
It runs entirely on GitHub: a scheduled job fetches NSE's end-of-day files and the site is published with GitHub Pages,
so it opens in any browser on any device with no software installed.

## What's in it

| Tab | What it shows |
| --- | --- |
| Market Pulse | Nifty 50 / Midcap / Smallcap / Microcap and VIX; breadth (% above 50- and 200-day averages, advancers/decliners, 52-week highs and lows); FII/DII cash flows; FII, client, pro and DII positioning in index futures; sector and theme index returns |
| Movers | Top and bottom movers for 1D, 5D, 15D, 1M, 3M, 6M, 1Y; sector mix of the top movers and hit rates; momentum map; return distribution; every stock as a heatmap |
| Sector Rotation | Rotation map (leading / weakening / lagging / improving), sector breadth, median returns by window |
| Smart Money | Delivery-based accumulation and distribution, bulk and block deals with named buyers and sellers, net institutional buying by stock, most active institutions |
| Ownership | Quarterly promoter / FPI / DII / MF / insurance holdings with quarter-on-quarter change, named holders above 1% (which fund owns what, new entries, exits), promoter pledge |
| Screens | Momentum leaders, stage-2 trend template, 52-week breakouts on volume, volume shocks, accumulation, institutions + momentum, oversold in uptrend, quiet compounders, breakdowns, promoter selling |
| Stock terminal | Search any stock, company, sector or fund; price chart with 20/50-day averages and volume, technicals, shareholding, named holders, deals, and links to TradingView, NSE and Screener |

## How it stays fresh

* `.github/workflows/update.yml` runs at about 18:10, 19:20 and 20:50 IST on weekdays and 07:45 IST daily.
* The site checks for new data every 5 minutes while open and loads it automatically. **⟳ Refresh** loads it immediately.
* **⚡ Update from NSE** runs the job on demand. Without a token it opens the job on GitHub where you press *Run workflow*;
  with a fine-grained token (this repo only, *Actions: Read and write*) saved in ⚙ it does it in one click.

## One-time setup

1. Settings → Pages → *Build and deployment* → Source: **GitHub Actions**.
2. Actions tab → **update** → *Run workflow*. The first run downloads a year of files and takes 10–20 minutes.

## Data notes

* Prices are NSE end-of-day closes, adjusted for splits and bonuses using NSE's corporate-action list.
  Holidays on which NSE re-publishes the previous day's file are skipped.
* Shareholding comes from each company's quarterly XBRL filing. Only holders above 1% are named by law,
  so smaller fund positions are not visible.
* Bulk/block deals, FII/DII cash flows and their history are collected daily from the day the terminal starts (`state/`).
* For information only; not investment advice.

Run locally: `python3 pipeline/update.py` then `python3 -m http.server -d site` and open http://localhost:8000.
