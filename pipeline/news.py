#!/usr/bin/env python3
"""Live news collector for the terminal. Runs every few minutes in GitHub Actions.

Reads public RSS feeds (business press, RBI, SEBI, PIB) and NSE's corporate
announcements, tags each item with category, tone, importance and any
Smallcap 250 / Microcap 250 stocks it mentions, and writes out/news.json.
Standard library only.
"""
import csv, datetime as dt, email.utils, html, json, os, re, sys, time, urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.environ.get("NEWS_OUT", os.path.join(ROOT, "out"))
PREV = os.environ.get("NEWS_PREV", "")          # previous news.json, to keep items that dropped off feeds
os.makedirs(OUT, exist_ok=True)
UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/130.0 Safari/537.36", "Accept": "*/*", "Accept-Language": "en-IN,en;q=0.9",
      "Referer": "https://www.nseindia.com/"}
IST = dt.timezone(dt.timedelta(hours=5, minutes=30))
NOW = dt.datetime.now(dt.timezone.utc)

FEEDS = [
    ("Economic Times", "Markets", "https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms"),
    ("Economic Times", "Stocks", "https://economictimes.indiatimes.com/markets/stocks/rssfeeds/2146842.cms"),
    ("Economic Times", "Economy", "https://economictimes.indiatimes.com/news/economy/rssfeeds/1373380680.cms"),
    ("Moneycontrol", "Markets", "https://www.moneycontrol.com/rss/marketreports.xml"),
    ("Moneycontrol", "Business", "https://www.moneycontrol.com/rss/business.xml"),
    ("Moneycontrol", "Latest", "https://www.moneycontrol.com/rss/latestnews.xml"),
    ("Mint", "Markets", "https://www.livemint.com/rss/markets"),
    ("Mint", "Companies", "https://www.livemint.com/rss/companies"),
    ("Business Standard", "Markets", "https://www.business-standard.com/rss/markets-106.rss"),
    ("Business Standard", "Companies", "https://www.business-standard.com/rss/companies-101.rss"),
    ("BusinessLine", "Markets", "https://www.thehindubusinessline.com/markets/feeder/default.rss"),
    ("RBI", "Policy", "https://www.rbi.org.in/pressreleases_rss.xml"),
    ("SEBI", "Policy", "https://www.sebi.gov.in/sebirss.xml"),
    ("PIB", "Policy", "https://pib.gov.in/RssMain.aspx?ModId=6&Lang=1&Regid=3"),
]
CATS = [
    ("Policy", r"\bRBI\b|\bSEBI\b|government|ministry|cabinet|policy|budget|\bGST\b|tariff|\bduty\b|\bPLI\b|regulat|"
               r"notification|circular|repo rate|monetary|fiscal|subsid|ban\b|export curb|import curb|\bCCI\b"),
    ("Funds & Flows", r"\bFIIs?\b|\bFPIs?\b|\bDIIs?\b|mutual funds?|\bMFs?\b|block deal|bulk deal|stake|\bSIP\b|\bAMFI\b|"
                      r"inflow|outflow|promoter|pledge|\bOFS\b|\bQIP\b|buys? shares|sells? shares|offloads?|picks up"),
    ("Results", r"\bQ[1-4]\b|results?|net profit|profit|revenue|earnings|EBITDA|margin|guidance|PAT\b"),
    ("Corporate", r"\border\b|orders|contract|wins|bags|acquisition|acquire|merger|demerger|\bIPO\b|listing|launch|"
                  r"approval|USFDA|capex|expansion|plant|dividend|bonus|split|buyback|rating"),
    ("Global", r"\bFed\b|US |Wall Street|China|global|crude|Brent|dollar|Treasury|Europe|Japan|geopolit"),
    ("Markets", r"Sensex|Nifty|market|smallcap|midcap|rupee|stocks? to (buy|watch)|gainers|losers|rally|sell-?off"),
]
POS = r"surge|soar|jump|rall(y|ies)|gain|rise|rises|climb|record high|wins|bags|upgrade|beats|approval|boost|" \
      r"strong|robust|buy\b|bullish|outperform|top gainer|hits 52-week high|upper circuit|order win|raises stake|hikes stake"
NEG = r"fall|falls|slump|plunge|crash|tumble|slide|decline|drop|cut\b|downgrade|probe|penalty|fine\b|loss|weak|miss|" \
      r"sell-?off|bearish|underperform|raid|default|resign|exit|lower circuit|52-week low|ban\b|pledge|offload|trims stake"
STOP_SYMS = {"STAR", "CLEAN", "RAIN", "GLAND", "SAFARI", "TIMEX", "CERA", "QUESS", "ROUTE", "SKIPPER", "SUBROS",
             "ACE", "TI", "SIS", "NCC", "BLS", "EPL", "FSL", "IGL", "IEX", "KEC", "KSB", "MGL", "PTC", "RBA", "SCI",
             "AVL", "OMNI", "TARC", "ICIL", "APOLLO", "CENTUM", "MOIL", "MMTC", "IFCI", "IDBI", "NAVA", "ATUL", "CESC"}
GENERIC = r"\b(industries|india|technologies|technology|limited|ltd|enterprises|solutions|services|systems|company|" \
          r"corporation|corp|holdings|international|the|and|of|co|engineering|infrastructure|products)\b"


def get(url, timeout=25):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
        return r.read()


def clean(s):
    s = html.unescape(re.sub(r"<[^>]+>", " ", s or ""))
    return re.sub(r"\s+", " ", s).strip()


def parse_date(s):
    if not s:
        return None
    try:
        d = email.utils.parsedate_to_datetime(s)
        if d.tzinfo is None:
            d = d.replace(tzinfo=IST)
        return d.astimezone(dt.timezone.utc)
    except Exception:
        pass
    for f in ("%Y-%m-%dT%H:%M:%S%z", "%d-%b-%Y %H:%M:%S", "%d %b %Y %H:%M:%S"):
        try:
            d = dt.datetime.strptime(s.strip(), f)
            if d.tzinfo is None:
                d = d.replace(tzinfo=IST)
            return d.astimezone(dt.timezone.utc)
        except ValueError:
            continue
    return None


def read_feed(src, sec, url):
    try:
        raw = get(url)
        root = ET.fromstring(raw)
    except Exception as e:
        return src, sec, [], "%s" % e.__class__.__name__
    items = []
    for it in root.iter():
        tag = it.tag.split("}")[-1]
        if tag not in ("item", "entry"):
            continue
        g = lambda name: next((c.text or "" for c in it if c.tag.split("}")[-1] == name), "")
        link = g("link") or next((c.get("href") for c in it if c.tag.split("}")[-1] == "link"), "")
        items.append({"t": clean(g("title")), "u": link.strip(), "s": clean(g("description") or g("summary"))[:300],
                      "d": parse_date(g("pubDate") or g("published") or g("updated") or g("date"))})
    return src, sec, items, None


def universe():
    path = os.path.join(ROOT, "state", "export", "stocks.csv")
    out = []
    try:
        rows = list(csv.reader(open(path, encoding="utf-8")))[2:]
    except FileNotFoundError:
        return out
    for r in rows:
        sym, name, idx = r[0], r[1], r[2]
        core = re.sub(GENERIC, " ", name, flags=re.I)
        core = re.sub(r"[^A-Za-z0-9&' ]", " ", core)
        core = re.sub(r"\s+", " ", core).strip()
        pats = []
        if len(core) >= 5:
            pats.append(re.compile(r"\b" + re.escape(core) + r"\b", re.I))
        if len(sym) >= 5 and sym not in STOP_SYMS and sym.isalpha():
            pats.append(re.compile(r"\b" + re.escape(sym) + r"\b"))
        if pats:
            out.append((sym, "S" if idx.startswith("Small") else "M", pats))
    return out


def tag(item, uni):
    text = item["t"] + " . " + item["s"]
    cat = next((c for c, p in CATS if re.search(p, item["t"], re.I)), None) or \
        next((c for c, p in CATS if re.search(p, text, re.I)), "Markets")
    if item["src"] in ("RBI", "SEBI", "PIB"):
        cat = "Policy"
    pos, neg = len(re.findall(POS, item["t"], re.I)), len(re.findall(NEG, item["t"], re.I))
    tone = "pos" if pos > neg else "neg" if neg > pos else "neu"
    syms = []
    for sym, ix, pats in uni:
        if any(p.search(item["t"]) for p in pats):
            syms.append([sym, ix])
    syms = syms[:4]
    imp = 1
    imp += 2 if syms else 0
    imp += 2 if cat == "Policy" else 1 if cat in ("Funds & Flows", "Results") else 0
    imp += 1 if re.search(r"\bRBI\b|\bSEBI\b|repo|budget|tariff|block deal|bulk deal|stake|order|upper circuit|"
                          r"lower circuit|record|crash|surge|plunge", item["t"], re.I) else 0
    item.update({"c": cat, "tone": tone, "sy": syms, "imp": min(imp, 5)})
    return item


def nse_announcements(uni_syms):
    """Company filings to NSE (results, orders, acquisitions, board outcomes) for universe stocks."""
    try:
        data = json.loads(get("https://www.nseindia.com/api/corporate-announcements?index=equities").decode("utf-8"))
    except Exception as e:
        return [], e.__class__.__name__
    skip = r"trading window|newspaper|loss of share|duplicate share|certificate|74\(5\)|compliance|closure of|" \
           r"ESOP|ESOS|allotment of equity shares under|change in.*(address|email)|reg\. 39"
    out = []
    for x in data if isinstance(data, list) else []:
        sym = x.get("symbol", "")
        if sym not in uni_syms:
            continue
        desc = clean(x.get("desc", ""))
        body = clean(x.get("attchmntText", ""))
        if re.search(skip, desc + " " + body[:120], re.I):
            continue
        out.append({"t": "%s: %s" % (sym, desc), "s": body[:300], "u": x.get("attchmntFile") or
                    "https://www.nseindia.com/companies-listing/corporate-filings-announcements",
                    "d": parse_date(x.get("an_dt") or x.get("sort_date")), "src": "NSE filing", "sec": "Announcements",
                    "c": "Corporate", "tone": "neu", "sy": [[sym, uni_syms[sym]]], "imp": 3})
    return out, None


def main():
    uni = universe()
    uni_syms = {s: ix for s, ix, _ in uni}
    with ThreadPoolExecutor(8) as ex:
        res = list(ex.map(lambda f: read_feed(*f), FEEDS))
    items, status = [], []
    for src, sec, its, err in res:
        status.append({"src": src, "sec": sec, "n": len(its), "err": err})
        for it in its:
            if not it["t"] or not it["u"]:
                continue
            it.update({"src": src, "sec": sec})
            items.append(tag(it, uni))
    ann, err = nse_announcements(uni_syms)
    status.append({"src": "NSE filing", "sec": "Announcements", "n": len(ann), "err": err})
    items += ann
    # keep earlier items that have dropped off the feeds, for up to 3 days
    prev = []
    if PREV and os.path.exists(PREV):
        try:
            prev = json.load(open(PREV)).get("items", [])
        except Exception:
            prev = []
    seen, merged = set(), []
    cutoff = NOW - dt.timedelta(days=3)
    for it in items + [dict(p, d=parse_date(p.get("d"))) for p in prev]:
        key = re.sub(r"\W+", "", (it["t"] or "").lower())[:90]
        if key in seen:
            continue
        seen.add(key)
        d = it.get("d") or NOW
        if d < cutoff or d > NOW + dt.timedelta(hours=2):
            continue
        it["d"] = d.strftime("%Y-%m-%dT%H:%M:%SZ")
        merged.append(it)
    merged.sort(key=lambda x: x["d"], reverse=True)
    merged = merged[:600]
    out = {"generated": NOW.strftime("%Y-%m-%dT%H:%M:%SZ"), "sources": status, "items": merged}
    with open(os.path.join(OUT, "news.json"), "w") as f:
        json.dump(out, f, separators=(",", ":"))
    ok = sum(1 for s in status if not s["err"])
    print("news: %d items, %d/%d sources ok, %d tagged to universe stocks" %
          (len(merged), ok, len(status), sum(1 for x in merged if x.get("sy"))))
    for s in status:
        print("  %-18s %-13s %4d %s" % (s["src"], s["sec"], s["n"], s["err"] or ""))


if __name__ == "__main__":
    main()
