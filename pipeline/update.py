#!/usr/bin/env python3
"""Daily data pipeline for the Smallcap & Microcap Terminal.

Pulls only public NSE files and APIs, works out every metric, and writes the
JSON the website reads (site/data/*.json). Runs in GitHub Actions on a
schedule and on demand; also runs on any machine with Python 3.9+ and no
extra packages.

Data (all from NSE):
  * sec_bhavdata_full_DDMMYYYY.csv  daily prices, volume, delivery (1 year)
  * ind_close_all_DDMMYYYY.csv      index closes
  * fao_participant_oi_DDMMYYYY.csv FII / DII / Pro / Client derivatives OI
  * bulk.csv / block.csv            today's bulk and block deals (named parties)
  * api/fiidiiTradeReact            provisional FII / DII cash flows
  * api/corporates-corporateActions splits and bonuses (price adjustment)
  * api/corporate-share-holdings-master + SHP XBRL  quarterly shareholding
"""
import csv, html, io, json, math, os, re, sys, time, datetime as dt, statistics, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.environ.get("CACHE_DIR", os.path.join(ROOT, ".cache"))
STATE = os.path.join(ROOT, "state")          # committed history that NSE does not keep for us
OUT = os.path.join(ROOT, "site", "data")
for d in (CACHE, STATE, OUT, os.path.join(CACHE, "bhav"), os.path.join(CACHE, "idx"),
          os.path.join(CACHE, "poi"), os.path.join(STATE, "shp")):
    os.makedirs(d, exist_ok=True)

ARCH = "https://nsearchives.nseindia.com"
API = "https://www.nseindia.com/api"
UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/130.0 Safari/537.36",
      "Accept": "*/*", "Accept-Language": "en-US,en;q=0.9", "Referer": "https://www.nseindia.com/"}
SESSIONS = 262          # one year of trading days plus a little
TODAY = dt.date.today()
LOG = []
SHORT = {"Automobile and Auto Components": "Auto & Components", "Fast Moving Consumer Goods": "FMCG",
         "Oil Gas & Consumable Fuels": "Oil & Gas", "Media Entertainment & Publication": "Media & Ent.",
         "Information Technology": "IT", "Construction Materials": "Cement & Materials"}
INDICES = {"S": ("Nifty Smallcap 250", "ind_niftysmallcap250list.csv"),
           "M": ("Nifty Microcap 250", "ind_niftymicrocap250_list.csv")}
WATCH_INDICES = ["Nifty 50", "Nifty Midcap 150", "Nifty Smallcap 250", "Nifty Microcap 250", "Nifty 500",
                 "Nifty Bank", "Nifty IT", "Nifty Pharma", "Nifty Auto", "Nifty Metal", "Nifty FMCG",
                 "Nifty Realty", "Nifty Energy", "Nifty PSU Bank", "Nifty Media", "Nifty Healthcare Index",
                 "Nifty Capital Markets", "Nifty India Defence", "Nifty Chemicals", "Nifty Consumer Durables",
                 "Nifty Oil & Gas", "Nifty Financial Services", "Nifty Infrastructure", "Nifty PSE", "India VIX"]


def log(msg):
    LOG.append(msg)
    print(msg, flush=True)


def get(url, tries=3, timeout=40):
    last = None
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            last = "HTTP %s" % e.code
        except Exception as e:  # noqa
            last = e.__class__.__name__
        time.sleep(1.5 * (i + 1))
    raise RuntimeError("fetch failed %s (%s)" % (url, last))


def get_json(url):
    raw = get(url)
    return None if raw is None else json.loads(raw.decode("utf-8", "replace"))


def load_json(path, default):
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return default


def save_json(path, obj, pretty=False):
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(obj, f, separators=None if pretty else (",", ":"), indent=1 if pretty else None)
    os.replace(tmp, path)


def r(x, n=2):
    return None if x is None or (isinstance(x, float) and (math.isnan(x) or math.isinf(x))) else round(x, n)


# ----------------------------------------------------------------------------------------- daily files
def daily_file(kind, d):
    """Fetch one dated archive file through the cache. Returns text or None (no session / missing)."""
    tag = d.strftime("%d%m%Y")
    if kind == "bhav":
        url, folder = "%s/products/content/sec_bhavdata_full_%s.csv" % (ARCH, tag), "bhav"
    elif kind == "idx":
        url, folder = "%s/content/indices/ind_close_all_%s.csv" % (ARCH, tag), "idx"
    else:
        url, folder = "%s/content/nsccl/fao_participant_oi_%s.csv" % (ARCH, tag), "poi"
    path = os.path.join(CACHE, folder, tag + ".csv")
    miss = path + ".none"
    if os.path.exists(path):
        txt = open(path, encoding="utf-8", errors="replace").read()
        return None if kind == "bhav" and not bhav_is_for(txt, d) else txt
    if os.path.exists(miss) and (TODAY - d).days > 4:
        return None
    raw = get(url)
    if raw is None:
        if d < TODAY:
            open(miss, "w").close()
        return None
    txt = raw.decode("utf-8", "replace")
    if kind == "bhav" and not bhav_is_for(txt, d):
        # NSE re-publishes the previous day's file on some holidays; treat as no session
        if (TODAY - d).days > 1:
            open(miss, "w").close()
        return None
    with open(path, "w", encoding="utf-8") as f:
        f.write(txt)
    return txt


def bhav_is_for(txt, d):
    try:
        return txt.split("\n", 2)[1].split(",")[2].strip().lower() == d.strftime("%d-%b-%Y").lower()
    except Exception:
        return False


def find_sessions():
    """Most recent SESSIONS trading days, newest first, using cached files where possible."""
    days, d = [], TODAY
    cands = []
    while len(cands) < int(SESSIONS * 1.55) + 20:
        cands.append(d)
        d -= dt.timedelta(days=1)
    with ThreadPoolExecutor(6) as ex:
        texts = list(ex.map(lambda x: daily_file("bhav", x), cands))
    for c, t in zip(cands, texts):
        if t:
            days.append((c, t))
        if len(days) == SESSIONS:
            break
    return days


def parse_bhav(txt):
    rd = csv.reader(io.StringIO(txt))
    h = [x.strip() for x in next(rd)]
    ix = {k: h.index(k) for k in ("SYMBOL", "SERIES", "PREV_CLOSE", "HIGH_PRICE", "LOW_PRICE", "CLOSE_PRICE",
                                  "TTL_TRD_QNTY", "TURNOVER_LACS", "DELIV_QTY", "DELIV_PER")}
    out = {}
    for c in rd:
        if len(c) < len(h):
            continue
        s, se = c[ix["SYMBOL"]].strip(), c[ix["SERIES"]].strip()
        if se not in ("EQ", "BE", "BZ", "SM", "ST"):
            continue
        if s in out and se != "EQ":
            continue

        def f(k):
            try:
                return float(c[ix[k]])
            except ValueError:
                return None
        out[s] = (f("CLOSE_PRICE"), f("PREV_CLOSE"), f("HIGH_PRICE"), f("LOW_PRICE"), f("TTL_TRD_QNTY") or 0.0,
                  f("TURNOVER_LACS") or 0.0, f("DELIV_QTY"), f("DELIV_PER"))
    return out


def parse_idx(txt):
    out = {}
    for row in csv.DictReader(io.StringIO(txt)):
        try:
            out[row["Index Name"].strip()] = float(row["Closing Index Value"])
        except (KeyError, ValueError):
            pass
    return out


# ----------------------------------------------------------------------------------- corporate actions
def corporate_actions(frm, to):
    path = os.path.join(STATE, "corporate_actions.json")
    st = load_json(path, {"fetched": None, "items": []})
    if st["fetched"] != TODAY.isoformat():
        try:
            data = get_json("%s/corporates-corporateActions?index=equities&from_date=%s&to_date=%s"
                            % (API, frm.strftime("%d-%m-%Y"), (to + dt.timedelta(days=7)).strftime("%d-%m-%Y")))
            if data:
                keep = [{"symbol": x.get("symbol"), "subject": x.get("subject", ""), "exDate": x.get("exDate")}
                        for x in data if re.search(r"bonus|split|sub-?div|consolidat", x.get("subject", ""), re.I)]
                seen = {(i["symbol"], i["exDate"], i["subject"]) for i in st["items"]}
                st["items"] += [k for k in keep if (k["symbol"], k["exDate"], k["subject"]) not in seen]
                st["fetched"] = TODAY.isoformat()
                save_json(path, st, pretty=True)
        except Exception as e:
            log("corporate actions unavailable today (%s); using saved list" % e)
    adj = {}
    for x in st["items"]:
        subj = x["subject"]
        try:
            ex = dt.datetime.strptime(x["exDate"], "%d-%b-%Y").date()
        except (TypeError, ValueError):
            continue
        f = None
        m = re.search(r"Bonus\s*(\d+)\s*:\s*(\d+)", subj, re.I)
        if m:
            a, b = float(m.group(1)), float(m.group(2))
            f = (a + b) / b
        m = re.search(r"From\s*R[se]\.?\s*([\d.]+).*?To\s*R[se]\.?\s*([\d.]+)", subj, re.I)
        if m and re.search(r"split|sub-?div|consolidat", subj, re.I):
            f = float(m.group(1)) / float(m.group(2))
        if f and abs(f - 1) > 1e-9:
            adj[(x["symbol"], ex)] = (f, subj)
    return adj


# --------------------------------------------------------------------------------------- constituents
def constituents():
    rows = {}
    for code, (iname, fname) in INDICES.items():
        raw = get("%s/content/indices/%s" % (ARCH, fname))
        if raw is None:
            raise RuntimeError("constituent file missing: " + fname)
        for c in list(csv.reader(io.StringIO(raw.decode("utf-8", "replace"))))[1:]:
            if len(c) < 5 or not c[2].strip() or c[2].strip().startswith("DUMMY"):
                continue
            sym = c[2].strip()
            rows[sym] = {"i": code, "n": re.sub(r"\s+(Ltd\.?|Limited)$", "", c[0].strip(), flags=re.I),
                         "s": SHORT.get(c[1].strip(), c[1].strip()), "isin": c[4].strip()}
    return rows


# ---------------------------------------------------------------------------------------------- maths
def sma(a, n):
    return sum(a[:n]) / n if len(a) >= n else None


def rsi(closes_new_first, n=14):
    c = list(reversed(closes_new_first[: n * 6]))
    if len(c) < n + 1:
        return None
    gains = [max(c[i] - c[i - 1], 0) for i in range(1, len(c))]
    losses = [max(c[i - 1] - c[i], 0) for i in range(1, len(c))]
    ag, al = sum(gains[:n]) / n, sum(losses[:n]) / n
    for g, l in zip(gains[n:], losses[n:]):
        ag, al = (ag * (n - 1) + g) / n, (al * (n - 1) + l) / n
    return 100.0 if al == 0 else 100 - 100 / (1 + ag / al)


def pct_rank(values):
    """Map each value to its percentile (0-100) within the list; None stays None."""
    vs = sorted(v for v in values if v is not None)
    if not vs:
        return [None] * len(values)
    out = []
    for v in values:
        if v is None:
            out.append(None)
            continue
        lo = sum(1 for x in vs if x < v)
        eq = sum(1 for x in vs if x == v)
        out.append(100.0 * (lo + 0.5 * eq) / len(vs))
    return out


def build_series(sym, B, dates, adj):
    """Split/bonus-adjusted series, newest first, built by chaining each day's close over its prev close."""
    if sym not in B[0]:
        return None
    A = [B[0][sym][0]]
    factor = 1.0          # cumulative factor applied to older raw values
    H, L, V, DQ, DP, TO, F = [B[0][sym][2]], [B[0][sym][3]], [B[0][sym][4]], [B[0][sym][6]], [B[0][sym][7]], \
        [B[0][sym][5]], [1.0]
    for i in range(len(B) - 1):
        x = B[i].get(sym)
        if x is None:            # did not trade that day: stop the chain there
            break
        c, p = x[0], x[1]
        k = adj.get((sym, dates[i]), (1.0, ""))[0]
        nxt = B[i + 1].get(sym)
        if not p or nxt is None:
            break
        ret = c / (p / k) - 1
        if abs(ret) > 0.5 and k == 1.0:
            # a >50% one-day move with no recorded split/bonus: likely an unrecorded corporate action
            # (demerger, relisting). Stop history here rather than show a fake crash or rally.
            break
        A.append(A[-1] / (1 + ret))
        factor *= k
        F.append(factor)
        H.append(nxt[2] / factor * (A[-1] / (nxt[0] / factor)) if nxt[0] else None)
        L.append(nxt[3] / factor * (A[-1] / (nxt[0] / factor)) if nxt[0] else None)
        V.append(nxt[4] * factor)
        DQ.append(nxt[6] * factor if nxt[6] is not None else None)
        DP.append(nxt[7])
        TO.append(nxt[5])
    return {"c": A, "h": H, "l": L, "v": V, "dq": DQ, "dp": DP, "to": TO}


def ret_n(c, n):
    return (c[0] / c[n] - 1) * 100 if len(c) > n and c[n] else None


# ------------------------------------------------------------------------------------------ deals
INST = [("MF", r"MUTUAL FUND|\bMF\b|ASSET MANAGEMENT|\bAMC\b|TRUSTEE"),
        ("Insurance", r"INSURANCE|ASSURANCE|\bLIC\b|LIFE "),
        ("FPI/Foreign fund", r"\bFUND\b|FUNDS|SICAV|\bPLC\b|\bLLC\b|\bL\.?P\.?\b|PTE|MAURITIUS|SINGAPORE|CAYMAN|"
                             r"MASTER|PORTFOLIO|SECURITIES INVESTMENT|INVESTMENT TRUST|GOLDMAN|MORGAN STANLEY|"
                             r"CITIGROUP|BNP|SOCIETE|NOMURA|JP ?MORGAN|BOFA|MERRILL|VANGUARD|BLACKROCK|ABU DHABI|"
                             r"GOVERNMENT OF|NORGES|SOVEREIGN|ELARA|NEXPACT|VIKASA|ALTEA|SAINT CAPITAL"),
        ("AIF/PMS", r"ALTERNATIVE INVESTMENT|\bAIF\b|OPPORTUNITIES|CATEGORY III|PMS"),
        ("Bank/NBFC", r"BANK\b|FINANCE LIMITED|FINANCIAL SERVICES|FINVEST|CAPITAL LIMITED"),
        ("Broker/Prop", r"SECURITIES|BROKING|STOCK BROKING|SHARE BROKERS|CAPITAL MARKETS|COMMODITIES|"
                        r"TRADING|PROPRIETARY|GRAVITON|QE SECURITIES|HRTI|JUNOMONETA|MICROCURVES|IRAGE|"
                        r"NK SECURITIES|ALPHAGREP|TOWER RESEARCH|JUMP|OPTIVER|CITADEL|SUSQUEHANNA")]


def classify(name):
    u = name.upper()
    if re.search(INST[5][1], u):
        return "Broker/Prop"
    for k, pat in INST[:5]:
        if re.search(pat, u):
            return k
    if re.search(r"\bHUF\b", u) or (len(u.split()) <= 4 and not re.search(r"LIMITED|LTD|LLP|PRIVATE|PVT|TRUST", u)):
        return "Individual"
    return "Corporate/Other"


def update_deals(univ):
    path = os.path.join(STATE, "deals.json")
    st = load_json(path, {"rows": []})
    have = {(x["d"], x["sym"], x["who"], x["side"], x["qty"], x["px"], x["t"]) for x in st["rows"]}
    added = 0
    for kind in ("bulk", "block"):
        try:
            raw = get("%s/content/equities/%s.csv" % (ARCH, kind))
        except Exception as e:
            log("%s deals unavailable (%s)" % (kind, e))
            continue
        if not raw:
            continue
        for row in csv.DictReader(io.StringIO(raw.decode("utf-8", "replace"))):
            try:
                d = dt.datetime.strptime(row["Date"].strip(), "%d-%b-%Y").date().isoformat()
                rec = {"d": d, "t": kind, "sym": row["Symbol"].strip(), "nm": row["Security Name"].strip(),
                       "who": row["Client Name"].strip(), "side": row["Buy/Sell"].strip().upper()[:1],
                       "qty": int(float(row["Quantity Traded"].replace(",", ""))),
                       "px": float(row["Trade Price / Wght. Avg. Price"].replace(",", ""))}
            except (KeyError, ValueError):
                continue
            key = (rec["d"], rec["sym"], rec["who"], rec["side"], rec["qty"], rec["px"], rec["t"])
            if key in have:
                continue
            rec["cat"] = classify(rec["who"])
            st["rows"].append(rec)
            have.add(key)
            added += 1
    cutoff = (TODAY - dt.timedelta(days=370)).isoformat()
    st["rows"] = sorted([x for x in st["rows"] if x["d"] >= cutoff], key=lambda x: (x["d"], x["sym"]), reverse=True)
    save_json(path, st)
    log("deals: %d new, %d kept" % (added, len(st["rows"])))
    for x in st["rows"]:
        x["u"] = univ.get(x["sym"], {}).get("i")
        x["val"] = round(x["qty"] * x["px"] / 1e7, 2)
    return st["rows"]


# ------------------------------------------------------------------------------------------ FII / DII
def update_fiidii():
    path = os.path.join(STATE, "fiidii.json")
    st = load_json(path, {"rows": []})
    try:
        data = get_json(API + "/fiidiiTradeReact") or []
        by = {}
        for x in data:
            d = dt.datetime.strptime(x["date"], "%d-%b-%Y").date().isoformat()
            cat = "FII" if "FII" in x["category"].upper() else "DII"
            by.setdefault(d, {})[cat] = {"buy": float(x["buyValue"]), "sell": float(x["sellValue"]),
                                         "net": float(x["netValue"])}
        known = {x["d"] for x in st["rows"]}
        for d, v in by.items():
            if d in known:
                st["rows"] = [y for y in st["rows"] if y["d"] != d]
            st["rows"].append({"d": d, **v})
        st["rows"].sort(key=lambda x: x["d"], reverse=True)
        save_json(path, st)
    except Exception as e:
        log("FII/DII cash flows unavailable today (%s)" % e)
    return st["rows"][:250]


def participant_oi(days):
    """FII / DII / Pro / Client positioning in index futures and options for each session."""
    out = []
    for d in days[:60]:
        txt = daily_file("poi", d)
        if not txt:
            continue
        rows = list(csv.reader(io.StringIO(txt)))
        hdr = None
        rec = {"d": d.isoformat()}
        for row in rows:
            cells = [c.strip() for c in row]
            if cells and cells[0] == "Client Type":
                hdr = cells
                continue
            if hdr and cells and cells[0] in ("Client", "DII", "FII", "Pro"):
                vals = dict(zip(hdr, cells))

                def v(k):
                    for kk in vals:
                        if kk.strip().lower() == k.lower():
                            try:
                                return float(vals[kk])
                            except ValueError:
                                return 0.0
                    return 0.0
                rec[cells[0]] = {"fil": v("Future Index Long"), "fis": v("Future Index Short"),
                                 "fsl": v("Future Stock Long"), "fss": v("Future Stock Short"),
                                 "cl": v("Option Index Call Long"), "pl": v("Option Index Put Long"),
                                 "cs": v("Option Index Call Short"), "ps": v("Option Index Put Short")}
        if "FII" in rec:
            out.append(rec)
    return out


# --------------------------------------------------------------------------------------- shareholding
CATS = {
    "promoter": "ShareholdingOfPromoterAndPromoterGroup",
    "fpi": "InstitutionsForeign",
    "dii": "InstitutionsDomestic",
    "mf": "MutualFundsOrUTI",
    "ins": "InsuranceCompanies",
    "aif": "AlternativeInvestmentFunds",
    "bank": "Banks",
    "pf": "ProvidentFundsOrPensionFunds",
    "retail": "ResidentIndividualShareholdersHoldingNominalShareCapitalUpToRsTwoLakh",
    "hni": "ResidentIndividualShareholdersHoldingNominalShareCapitalInExcessOfRsTwoLakh",
    "corp": "BodiesCorporate",
    "nri": "NonResidentIndians",
    "govt": "Governments",
    "public": "PublicShareholding",
}
NAMED = {"MutualFundsOrUTI": "MF", "DetailsOfSharesHeldByInstitutionsForeignPortfolioInvestorOne": "FPI",
         "DetailsOfSharesHeldByInstitutionsForeignPortfolioInvestorTwo": "FPI",
         "InstitutionsForeignPortfolioInvestorCategoryOne": "FPI", "InsuranceCompanies": "Insurance",
         "AlternativeInvestmentFunds": "AIF", "Banks": "Bank", "ProvidentFundsOrPensionFunds": "Pension fund",
         "SovereignWealthFundsForeign": "Sovereign fund", "ForeignDirectInvestment": "FDI",
         "BodiesCorporate": "Corporate", "OtherInstitutionsForeign": "Foreign inst.",
         "ForeignCompanies": "Foreign company", "NBFCsRegisteredWithRBI": "NBFC",
         "ResidentIndividualShareholdersHoldingNominalShareCapitalInExcessOfRsTwoLakh": "Individual (HNI)",
         "OtherFinancialInstitutions": "Fin. inst.", "VentureCapitalFunds": "VC fund",
         "ForeignVentureCapitalInvestors": "Foreign VC"}


def parse_shp(xml):
    def facts(tag):
        return re.findall(r"<in-bse-shp:" + tag + r"[^>]*contextRef=\"([^\"]+)\"[^>]*>([^<]*)<", xml)
    pct = {}
    for ctx, v in facts("ShareholdingAsAPercentageOfTotalNumberOfShares"):
        try:
            pct[ctx] = float(v) * 100
        except ValueError:
            pass
    out = {k: r(pct.get(v + "_ContextI", 0.0), 2) for k, v in CATS.items()}
    shares = {}
    for ctx, v in facts("NumberOfShares"):
        try:
            shares[ctx] = float(v)
        except ValueError:
            pass
    pl = [v for ctx, v in facts("EncumberedShareUnderPledgedAsPercentageOfTotalNumberOfShares")
          if ctx == "ShareholdingOfPromoterAndPromoterGroup_ContextI"]
    try:
        out["pledge"] = r(float(pl[0]) * 100, 2) if pl else 0.0
    except ValueError:
        out["pledge"] = 0.0
    holders = []
    for ctx, name in facts("NameOfTheShareholder"):
        if not ctx.startswith("D_"):
            continue
        base = ctx[2:]
        cat = re.sub(r"_Context\w+$", "", base)
        if cat not in NAMED:
            continue
        p = pct.get(base)
        if p is None or p < 1.0:
            continue
        holders.append({"n": re.sub(r"\s+", " ", html.unescape(name)).strip(), "c": NAMED[cat], "p": r(p, 2)})
    holders.sort(key=lambda h: -h["p"])
    out["holders"] = holders[:25]
    return out


def update_shareholding(univ, budget_s):
    """Keep each stock's last few quarters. Cheap master list first; XBRL only for new quarters."""
    t0 = time.time()
    done = fresh = 0
    q_end = latest_quarter_end()
    order = sorted(univ, key=lambda s: load_json(os.path.join(STATE, "shp", s + ".json"), {}).get("checked", ""))
    for sym in order:
        if time.time() - t0 > budget_s:
            break
        path = os.path.join(STATE, "shp", sym + ".json")
        st = load_json(path, {"checked": "", "q": []})
        have = {q["date"] for q in st["q"]}
        # within results season check daily if the latest quarter is missing, otherwise weekly
        stale_days = 1 if q_end.isoformat() not in have and (TODAY - q_end).days < 60 else 7
        if st["checked"] and (TODAY - dt.date.fromisoformat(st["checked"])).days < stale_days:
            continue
        try:
            master = get_json("%s/corporate-share-holdings-master?index=equities&symbol=%s"
                              % (API, urllib.request.quote(sym))) or []
        except Exception as e:
            log("shareholding list unavailable (%s); will retry next run" % e)
            break
        qs = []
        for m in master:
            try:
                d = dt.datetime.strptime(m["date"], "%d-%b-%Y").date().isoformat()
            except (KeyError, ValueError):
                continue
            if d in {q["date"] for q in qs}:
                continue
            qs.append({"date": d, "promoter": float(m.get("pr_and_prgrp") or 0), "xbrl": m.get("xbrl"),
                       "filed": m.get("submissionDate")})
        qs.sort(key=lambda q: q["date"], reverse=True)
        old = {q["date"]: q for q in st["q"]}
        newq = []
        for i, q in enumerate(qs[:8]):
            prev = old.get(q["date"])
            if prev and prev.get("detail"):
                newq.append(prev)
                continue
            if i < 3 and q.get("xbrl"):
                try:
                    xml = get(q["xbrl"].replace("nsearchives.nseindia.in", "nsearchives.nseindia.com"), timeout=60)
                    if xml:
                        q["detail"] = parse_shp(xml.decode("utf-8", "replace"))
                        fresh += 1
                except Exception as e:
                    log("SHP file for %s %s not read (%s)" % (sym, q["date"], e))
                time.sleep(0.25)
            newq.append(q)
        st = {"checked": TODAY.isoformat(), "q": newq}
        save_json(os.path.join(STATE, "shp", sym + ".json"), st)
        done += 1
        time.sleep(0.25)
    log("shareholding: %d stocks checked, %d new filings read" % (done, fresh))


def latest_quarter_end():
    y, m = TODAY.year, TODAY.month
    q = [(3, 31), (6, 30), (9, 30), (12, 31)]
    cands = [dt.date(y - 1, 12, 31)] + [dt.date(y, mm, dd) for mm, dd in q]
    return max(c for c in cands if c <= TODAY)


AMCS = ["ADITYA BIRLA", "AXIS", "BANDHAN", "BANK OF INDIA", "BARODA", "CANARA ROBECO", "DSP", "EDELWEISS",
        "FRANKLIN", "GROWW", "HDFC", "HELIOS", "HSBC", "ICICI PRUDENTIAL", "INVESCO", "ITI", "JM ", "KOTAK", "LIC",
        "MAHINDRA", "MIRAE", "MOTILAL", "NAVI", "NIPPON", "NJ ", "OLD BRIDGE", "PGIM", "PPFAS", "PARAG PARIKH", "QUANT",
        "QUANTUM", "SAMCO", "SBI", "SHRIRAM", "SUNDARAM", "TATA", "TAURUS", "TRUST MF", "UNION", "UTI", "WHITEOAK",
        "360 ONE", "BAJAJ FINSERV", "ZERODHA", "UNIFI", "CAPITALMIND", "ABAKKUS", "CHOICE", "JIO BLACKROCK"]


def fund_house(name, cat):
    u = name.upper().replace("-", " ")
    if cat != "MF":
        return None
    for a in AMCS:
        if a in u or u.startswith(a.strip()):
            return {"PARAG PARIKH": "PPFAS", "ICICI PRUDENTIAL": "ICICI PRUDENTIAL"}.get(a, a.strip())
    if u.startswith("ICICI"):
        return "ICICI PRUDENTIAL"
    return u.split()[0]


def houses(holders):
    agg = {}
    for h in holders:
        f = fund_house(h["n"], h["c"])
        if f:
            agg[f] = agg.get(f, 0.0) + h["p"]
    return agg


def norm(name):
    """Match the same holder across quarters despite case, punctuation and 'A/C' wording differences."""
    u = re.sub(r"[^A-Z0-9 ]", " ", html.unescape(name).upper())
    u = re.sub(r"\b(A C|AC|LTD|LIMITED|THE|TRUSTEE|TRUSTEES|COMPANY|CO|PVT|PRIVATE|MUTUAL FUND|MF)\b", " ", u)
    return re.sub(r"\s+", "", u)[:34]


def ownership_out(univ):
    out = {}
    for sym in univ:
        st = load_json(os.path.join(STATE, "shp", sym + ".json"), None)
        if not st or not st.get("q"):
            continue
        qs = st["q"]
        det = [q for q in qs if q.get("detail")]
        rec = {"hist": [[q["date"], r(q["promoter"], 2)] for q in qs[:8]]}
        if det:
            cur = det[0]
            rec["date"] = cur["date"]
            rec["now"] = {k: v for k, v in cur["detail"].items() if k != "holders"}
            rec["holders"] = cur["detail"]["holders"]
            if len(det) > 1:
                prv = det[1]
                rec["prev_date"] = prv["date"]
                rec["chg"] = {k: r((cur["detail"].get(k) or 0) - (prv["detail"].get(k) or 0), 2)
                              for k in CATS if k != "public"}
                ph = {norm(h["n"]): h["p"] for h in prv["detail"]["holders"]}
                ch = {norm(h["n"]): h["p"] for h in cur["detail"]["holders"]}
                for h in rec["holders"]:
                    k = norm(h["n"])
                    h["d"] = r(h["p"] - ph[k], 2) if k in ph else None   # None = new above 1%
                rec["exited"] = [{"n": h["n"], "c": h["c"], "p": h["p"]}
                                 for h in prv["detail"]["holders"] if norm(h["n"]) not in ch][:10]
                hc, hp = houses(cur["detail"]["holders"]), houses(prv["detail"]["holders"])
                rec["houses"] = sorted([{"f": f, "p": r(hc.get(f, 0.0), 2), "d": r(hc.get(f, 0.0) - hp.get(f, 0.0), 2),
                                         "new": f not in hp, "gone": f not in hc}
                                        for f in set(hc) | set(hp)], key=lambda x: -x["p"])
        out[sym] = rec
    return out


# -------------------------------------------------------------------------------------------- main
def main():
    t0 = time.time()
    univ = constituents()
    log("universe: %d stocks" % len(univ))
    sess = find_sessions()
    if len(sess) < 60:
        raise RuntimeError("only %d sessions found" % len(sess))
    dates = [d for d, _ in sess]
    B = [parse_bhav(t) for _, t in sess]
    log("price history: %d sessions, %s to %s" % (len(dates), dates[-1], dates[0]))
    adj = corporate_actions(dates[-1], dates[0])

    # index closes for the same sessions
    with ThreadPoolExecutor(6) as ex:
        idx_txt = list(ex.map(lambda d: daily_file("idx", d), dates))
    IDX = [parse_idx(t) if t else {} for t in idx_txt]

    # ---- per stock
    stocks, flags, used_adj = [], [], []
    series_for_breadth = {}
    for sym, meta in univ.items():
        S = build_series(sym, B, dates, adj)
        if not S:
            flags.append("%s did not trade on %s" % (sym, dates[0]))
            continue
        c, v = S["c"], S["v"]
        series_for_breadth[sym] = c
        for (s2, d2), (f, subj) in adj.items():
            if s2 == sym and d2 >= dates[min(len(c) - 1, len(dates) - 1)]:
                used_adj.append("%s: %s (ex %s)" % (sym, subj, d2.strftime("%d %b %Y")))
        raw = B[0][sym]
        n = len(c)
        rets = {k: r(ret_n(c, k), 2) for k in (1, 5, 15, 21, 63, 126, 252)}
        d20, d50, d200 = sma(c, 20), sma(c, 50), sma(c, 200)
        d200_prev = sma(c[20:], 200) if n >= 220 else None
        prior_h = [x for x in S["h"][1:252] if x]
        prior_l = [x for x in S["l"][1:252] if x]
        newhi = bool(prior_h) and n >= 200 and S["h"][0] is not None and S["h"][0] >= max(prior_h)
        newlo = bool(prior_l) and n >= 200 and S["l"][0] is not None and S["l"][0] <= min(prior_l)
        hi = max(x for x in S["h"][:252] if x) if n >= 2 else None
        lo = min(x for x in S["l"][:252] if x) if n >= 2 else None
        dr = [c[i] / c[i + 1] - 1 for i in range(min(n - 1, 60))]
        vol20 = statistics.pstdev(dr[:20]) * math.sqrt(252) * 100 if len(dr) >= 20 else None
        avgv20 = sum(v[1:21]) / 20 if n >= 21 else None
        dps = [x for x in S["dp"][1:21] if x is not None]
        avg_dp = sum(dps) / len(dps) if dps else None
        tos = S["to"][:20]
        stocks.append({
            "sym": sym, "n": meta["n"], "s": meta["s"], "i": meta["i"],
            "px": raw[0], "hist": n,
            "r1": rets[1], "r5": rets[5], "r15": rets[15], "r1m": rets[21], "r3m": rets[63],
            "r6m": rets[126], "r1y": rets[252],
            "vr": r(v[0] / avgv20, 2) if avgv20 else None,
            "dp": r(raw[7], 1) if raw[7] is not None else None, "dp20": r(avg_dp, 1),
            "to": r(raw[5] / 100, 2), "to20": r(sum(tos) / len(tos) / 100, 2) if tos else None,
            "hi52": r(hi), "lo52": r(lo),
            "fhi": r((c[0] / hi - 1) * 100, 1) if hi else None, "flo": r((c[0] / lo - 1) * 100, 1) if lo else None,
            "d20": r(d20), "d50": r(d50), "d200": r(d200),
            "a50": None if d50 is None else c[0] > d50, "a200": None if d200 is None else c[0] > d200,
            "d200up": None if d200 is None or d200_prev is None else d200 > d200_prev,
            "rsi": r(rsi(c), 1), "vol": r(vol20, 1), "nh": newhi, "nl": newlo,
            "spark": [r(x, 2) for x in reversed(c[:130])],
            "vspark": [int(x) for x in reversed(v[:60])],
        })

    # ranks: relative strength and momentum composite inside each index
    for code in ("S", "M"):
        grp = [s for s in stocks if s["i"] == code]
        rk = {k: pct_rank([s[k] for s in grp]) for k in ("r1m", "r3m", "r6m", "fhi")}
        for j, s in enumerate(grp):
            parts = [(rk["r1m"][j], .2), (rk["r3m"][j], .35), (rk["r6m"][j], .3), (rk["fhi"][j], .15)]
            have = [(p, w) for p, w in parts if p is not None]
            s["mom"] = r(sum(p * w for p, w in have) / sum(w for _, w in have), 0) if have else None
            s["rs3m"] = r(rk["r3m"][j], 0)

    # ---- index levels and market breadth
    def idx_series(name):
        out = []
        for d, m in zip(dates, IDX):
            if name in m:
                out.append((d.isoformat(), m[name]))
        return out
    indices = []
    for name in WATCH_INDICES:
        ser = idx_series(name)
        if not ser:
            continue
        cl = [x[1] for x in ser]
        indices.append({"name": name, "last": r(cl[0]), "r1": r(ret_n(cl, 1)), "r5": r(ret_n(cl, 5)),
                        "r1m": r(ret_n(cl, 21)), "r3m": r(ret_n(cl, 63)), "r1y": r(ret_n(cl, 252)),
                        "series": [[d, r(v)] for d, v in reversed(ser)] if name in
                        ("Nifty 50", "Nifty Smallcap 250", "Nifty Microcap 250", "Nifty Midcap 150", "India VIX")
                        else None})
    breadth = []
    for k in range(min(120, len(dates) - 50)):
        row = {"d": dates[k].isoformat()}
        for code in ("S", "M"):
            above = tot = adv = dec = 0
            for s in stocks:
                if s["i"] != code:
                    continue
                c = series_for_breadth[s["sym"]]
                if len(c) > k + 50:
                    tot += 1
                    above += c[k] > sum(c[k:k + 50]) / 50
                if len(c) > k + 1:
                    adv += c[k] > c[k + 1]
                    dec += c[k] < c[k + 1]
            row[code] = {"a50": r(above / tot * 100, 1) if tot else None, "adv": adv, "dec": dec}
        breadth.append(row)
    breadth.reverse()
    hl = {}
    for code in ("S", "M"):
        g = [s for s in stocks if s["i"] == code]
        hl[code] = {"nh": sum(1 for s in g if s["nh"]), "nl": sum(1 for s in g if s["nl"]),
                    "a200": r(sum(1 for s in g if s["a200"]) / max(1, sum(1 for s in g if s["a200"] is not None)) * 100, 1),
                    "a50": r(sum(1 for s in g if s["a50"]) / max(1, sum(1 for s in g if s["a50"] is not None)) * 100, 1)}

    fiidii = update_fiidii()
    poi = participant_oi(dates)
    deals = update_deals(univ)

    budget = float(os.environ.get("SHP_BUDGET_S", "900"))
    if budget > 0:
        update_shareholding(univ, budget)
    own = ownership_out(univ)
    for s in stocks:
        o = own.get(s["sym"])
        if o and "now" in o:
            s["prom"] = o["now"].get("promoter")
            s["fpi"] = o["now"].get("fpi")
            s["mf"] = o["now"].get("mf")
            s["dii"] = o["now"].get("dii")
            s["pledge"] = o["now"].get("pledge")
            if "chg" in o:
                s["dfpi"] = o["chg"].get("fpi")
                s["dmf"] = o["chg"].get("mf")
                s["ddii"] = o["chg"].get("dii")
                s["dprom"] = o["chg"].get("promoter")

    meta = {"asof": dates[0].isoformat(), "generated": dt.datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
            "sessions": len(dates),
            "windows": {"1D": dates[1].isoformat(), "5D": dates[5].isoformat(), "15D": dates[15].isoformat(),
                        "1M": dates[21].isoformat(), "3M": dates[63].isoformat() if len(dates) > 63 else None,
                        "1Y": dates[252].isoformat() if len(dates) > 252 else None},
            "count": {"S": sum(1 for s in stocks if s["i"] == "S"), "M": sum(1 for s in stocks if s["i"] == "M")},
            "adjusted": sorted(set(used_adj)), "flags": flags,
            "fiidii_asof": fiidii[0]["d"] if fiidii else None,
            "poi_asof": poi[0]["d"] if poi else None,
            "deals_asof": deals[0]["d"] if deals else None,
            "own_count": sum(1 for v in own.values() if "now" in v),
            "log": LOG[-40:], "seconds": round(time.time() - t0)}
    save_json(os.path.join(OUT, "stocks.json"), stocks)
    save_json(os.path.join(OUT, "market.json"), {"indices": indices, "breadth": breadth, "hl": hl,
                                                 "fiidii": fiidii, "poi": poi})
    save_json(os.path.join(OUT, "deals.json"), deals[:4000])
    save_json(os.path.join(OUT, "ownership.json"), own)
    save_json(os.path.join(OUT, "meta.json"), meta, pretty=True)
    log("done in %ds: data as of %s" % (time.time() - t0, dates[0]))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        log("FAILED: %s: %s" % (e.__class__.__name__, e))
        sys.exit(1)
