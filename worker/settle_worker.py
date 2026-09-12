#!/usr/bin/env python3
"""
Voltbets settlement worker — cPanel cron side of the auto-settlement engine.

WHAT IT DOES
  Finds football matches that kicked off >110 minutes ago, scrapes their
  statistics (corners) and incidents (goals, cards) from SofaScore through a
  rotating residential-proxy pool, and POSTs one signed payload per match to
  the Railway backend, which does the actual settling.

WHY IT IS A SEPARATE PROCESS ON cPANEL
  Scraping is noisy, bursty and gets CDN-blocked. Running it on the app host
  would compete with customer traffic and, worse, would put an outbound
  scraping footprint on the same IP that serves the site. cPanel cron is cheap,
  isolated, and if it dies the app is unaffected.

DEPENDENCIES: none. Standard library only — deliberately.
  Shared cPanel hosts often have no pip access, an old system Python, or no
  compiler for lxml/curl_cffi. `urllib` + `ssl` are always there, so this runs
  on any cPanel Python 3.8+. Proxy support is built on ProxyHandler.

SETUP (see docs/AUTO-SETTLEMENT.md for the full runbook)
  export SETTLE_WEBHOOK_URL="https://your-app.up.railway.app/api/v1/settlement/process"
  export SETTLE_WEBHOOK_SECRET="<same secret as the backend>"
  export SETTLE_PROXIES_FILE="/home/USER/voltbets/proxies.txt"   # one per line
  cron: */10 * * * * /usr/bin/python3 /home/USER/voltbets/settle_worker.py >> settle.log 2>&1
"""

from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import random
import re
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable, Optional

# ─────────────────────────────── configuration ───────────────────────────────

SOFASCORE = "https://www.sofascore.com/api/v1"
FOTMOB = "https://www.fotmob.com"

# Which upstream this worker reads.
#   "sofa"   (default) the original SofaScore scrape, behind the proxy pool
#   "fotmob" needs no key and no proxy: one pre-rendered match page carries
#            corners (FT + HT), cards (FT + HT) and goals (FT + HT)
# See docs/FREE-DATA-SOURCES.md before changing this.
SOURCE = os.environ.get("SETTLE_SOURCE", "sofa").strip().lower()
WEBHOOK_URL = os.environ.get("SETTLE_WEBHOOK_URL", "")
WEBHOOK_SECRET = os.environ.get("SETTLE_WEBHOOK_SECRET", "")
PENDING_URL = os.environ.get("SETTLE_PENDING_URL", "")  # defaults from WEBHOOK_URL
PROXIES_FILE = os.environ.get("SETTLE_PROXIES_FILE", "")
PROXIES_ENV = os.environ.get("SETTLE_PROXIES", "")  # comma/newline separated

REQUEST_TIMEOUT = float(os.environ.get("SETTLE_TIMEOUT", "12"))  # seconds, hard cap
PROXY_MAX_LATENCY = float(os.environ.get("SETTLE_PROXY_MAX_LATENCY", "5"))  # >5s = drop
MATCH_AGE_MINUTES = int(os.environ.get("SETTLE_MATCH_AGE_MINUTES", "110"))
MAX_MATCHES_PER_RUN = int(os.environ.get("SETTLE_MAX_MATCHES", "60"))
RETRIES_PER_REQUEST = int(os.environ.get("SETTLE_RETRIES", "4"))
DRY_RUN = os.environ.get("SETTLE_DRY_RUN", "").lower() in ("1", "true", "yes")

UA_POOL = [
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 "
    "(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/126.0.0.0 Mobile Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/126.0.0.0 Safari/537.36",
]

# Statuses that mean "this exit is burnt for this target" — drop, do not retry it.
DROP_STATUSES = {403, 429, 407, 451, 503}


def log(msg: str) -> None:
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    print(f"[{ts}] {msg}", flush=True)


# ──────────────────────────────── proxy pool ─────────────────────────────────


@dataclass
class ProxyPool:
    """
    Rotating pool of residential proxies with health-checking and self-purging.

    A proxy is dropped permanently for the run when it:
      * takes longer than PROXY_MAX_LATENCY to answer,
      * raises a connection/timeout error,
      * returns a blocking status (403 / 429 / 407 / 451 / 503).

    Dropping is aggressive on purpose: a burnt residential exit never recovers
    within a cron window, and retrying it wastes the whole budget. The pool
    keeps a per-run dead set plus counters so the log shows which exits rot.
    """

    proxies: list[str] = field(default_factory=list)
    dead: dict[str, str] = field(default_factory=dict)
    ok_count: dict[str, int] = field(default_factory=dict)
    fail_count: dict[str, int] = field(default_factory=dict)
    _cursor: int = 0

    @classmethod
    def from_env(cls) -> "ProxyPool":
        raw: list[str] = []
        if PROXIES_FILE and os.path.exists(PROXIES_FILE):
            with open(PROXIES_FILE, "r", encoding="utf-8") as fh:
                raw += [ln.strip() for ln in fh if ln.strip() and not ln.startswith("#")]
        if PROXIES_ENV:
            raw += [p.strip() for p in PROXIES_ENV.replace(",", "\n").splitlines() if p.strip()]
        # de-dupe, keep order
        seen, out = set(), []
        for p in raw:
            if p not in seen:
                seen.add(p)
                out.append(p)
        # Random start so parallel cron hosts don't hammer the same exit first.
        random.shuffle(out)
        pool = cls(proxies=out)
        log(f"proxy pool loaded: {len(out)} exit(s)")
        if not out:
            log("WARNING: no proxies configured — falling back to direct requests "
                "(expect blocks; set SETTLE_PROXIES_FILE)")
        return pool

    def alive(self) -> list[str]:
        return [p for p in self.proxies if p not in self.dead]

    def rotate(self) -> Optional[str]:
        """Next usable proxy, or None when the pool is exhausted (= direct)."""
        live = self.alive()
        if not live:
            return None
        self._cursor = (self._cursor + 1) % len(live)
        return live[self._cursor]

    def drop(self, proxy: Optional[str], reason: str) -> None:
        if not proxy or proxy in self.dead:
            return
        self.dead[proxy] = reason
        self.fail_count[proxy] = self.fail_count.get(proxy, 0) + 1
        remaining = len(self.alive())
        log(f"proxy DROPPED ({reason}) {_mask(proxy)} — {remaining} left in pool")

    def mark_ok(self, proxy: Optional[str]) -> None:
        if proxy:
            self.ok_count[proxy] = self.ok_count.get(proxy, 0) + 1

    def healthcheck(self, ctx_check=3) -> None:
        """Pre-flight: throw away exits that cannot reach the target at all."""
        live = self.alive()
        if not live:
            return
        log(f"pre-flight healthcheck on {len(live)} exit(s)")
        sample = live[: ctx_check * 5]
        for proxy in sample:
            started = time.monotonic()
            try:
                _http_get(f"{SOFASCORE}/sport/football/events/live", proxy, timeout=PROXY_MAX_LATENCY)
                latency = time.monotonic() - started
                if latency > PROXY_MAX_LATENCY:
                    self.drop(proxy, f"slow pre-flight {latency:.1f}s")
                else:
                    self.mark_ok(proxy)
            except urllib.error.HTTPError as e:
                if e.code in DROP_STATUSES:
                    self.drop(proxy, f"pre-flight HTTP {e.code}")
            except Exception as e:  # noqa: BLE001 - any transport failure = unusable
                self.drop(proxy, f"pre-flight {type(e).__name__}")

    def report(self) -> str:
        return (
            f"pool report: {len(self.alive())}/{len(self.proxies)} alive, "
            f"{len(self.dead)} dropped"
        )


def _mask(proxy: str) -> str:
    """Never log proxy credentials in full."""
    try:
        u = urllib.parse.urlsplit(proxy if "://" in proxy else f"http://{proxy}")
        if u.hostname:
            return f"{u.scheme}://{u.hostname}:{u.port or ''}"
    except Exception:  # noqa: BLE001
        pass
    return "<proxy>"


def _opener(proxy: Optional[str]):
    handlers: list[Any] = []
    if proxy:
        url = proxy if "://" in proxy else f"http://{proxy}"
        handlers.append(urllib.request.ProxyHandler({"http": url, "https": url}))
    else:
        handlers.append(urllib.request.ProxyHandler({}))  # ignore ambient env proxies
    ctx = ssl.create_default_context()
    handlers.append(urllib.request.HTTPSHandler(context=ctx))
    return urllib.request.build_opener(*handlers)


def _http_get(url: str, proxy: Optional[str], timeout: float,
              referer: str = "https://www.sofascore.com/") -> bytes:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": random.choice(UA_POOL),
            "Accept": "application/json, text/html, text/plain, */*",
            "Accept-Language": "en-GB,en;q=0.9",
            "Referer": referer,
        },
    )
    with _opener(proxy).open(req, timeout=timeout) as resp:
        return resp.read()


def _fetch_bytes(pool: ProxyPool, url: str, what: str, referer: str) -> Optional[bytes]:
    """
    GET a URL, rotating proxies and purging bad exits.

    Returns None when every proxy failed — the caller skips that match rather
    than sending a partial payload. A missing corner count must never look like
    zero corners.
    """
    last_error = "no proxy available"
    for attempt in range(RETRIES_PER_REQUEST):
        proxy = pool.rotate()
        started = time.monotonic()
        try:
            body = _http_get(url, proxy, REQUEST_TIMEOUT, referer=referer)
            elapsed = time.monotonic() - started
            if elapsed > PROXY_MAX_LATENCY:
                # Answered, but too slowly to keep in a cron window.
                pool.drop(proxy, f"slow {elapsed:.1f}s")
                continue
            pool.mark_ok(proxy)
            return body
        except urllib.error.HTTPError as e:
            if e.code in DROP_STATUSES:
                pool.drop(proxy, f"HTTP {e.code}")
            else:
                last_error = f"HTTP {e.code}"
        except urllib.error.URLError as e:
            pool.drop(proxy, f"conn {e.reason.__class__.__name__ if hasattr(e, 'reason') else 'error'}")
        except (TimeoutError, ssl.SSLError) as e:
            pool.drop(proxy, type(e).__name__)
        except Exception as e:  # noqa: BLE001
            pool.drop(proxy, type(e).__name__)

        if not pool.alive():
            break
        time.sleep(0.4 * (attempt + 1))

    log(f"  {what}: FAILED ({last_error})")
    return None


def fetch_json(pool: ProxyPool, url: str, what: str,
               referer: str = "https://www.sofascore.com/") -> Optional[dict]:
    body = _fetch_bytes(pool, url, what, referer)
    if body is None:
        return None
    try:
        return json.loads(body.decode("utf-8", "replace"))
    except json.JSONDecodeError:
        log(f"  {what}: FAILED (non-JSON response)")
        return None


def fetch_text(pool: ProxyPool, url: str, what: str,
               referer: str = FOTMOB + "/") -> Optional[str]:
    body = _fetch_bytes(pool, url, what, referer)
    return None if body is None else body.decode("utf-8", "replace")


# ───────────────────────────── SofaScore scraping ────────────────────────────


def _stat_value(item: dict) -> Optional[int]:
    """
    SofaScore statistic values arrive as "7", "7 (2)" (value + extra) or
    sometimes as a percentage. Take the leading integer, else None.
    """
    raw = str(item.get("home" if "home" in item else "value", "")).strip()
    for key in ("home", "away", "value"):
        v = str(item.get(key, "")).strip()
        if v:
            raw = v
            break
    else:
        return None
    head = raw.split("(")[0].strip().strip("%")
    try:
        return int(float(head))
    except ValueError:
        return None


def _find_stats_item(payload: dict, period: str, names: Iterable[str]) -> Optional[tuple[int, int]]:
    """Locate a statistics row by name within a period ("ALL" / "1ST")."""
    wanted = {n.lower() for n in names}
    for p in payload.get("statistics", []) or []:
        if str(p.get("period", "")).upper() != period.upper():
            continue
        for group in p.get("groups", []) or []:
            for item in group.get("statisticsItems", []) or []:
                if str(item.get("name", "")).strip().lower() in wanted:
                    home = _to_int(item.get("home"))
                    away = _to_int(item.get("away"))
                    if home is not None and away is not None:
                        return home, away
    return None


def _to_int(v: Any) -> Optional[int]:
    try:
        return int(float(str(v).split("(")[0].strip().strip("%")))
    except (TypeError, ValueError):
        return None


CORNER_NAMES = ("corner kicks", "corners", "corner kicks total", "total corners")


def extract_corners(stats: dict) -> dict:
    """
    Corners for both halves. The statistics endpoint reports period "1ST" for
    the first half and "ALL" for the full match; when a provider omits the 1ST
    block we return None (not 0) so the HT markets stay manual instead of
    settling against a wrong number.
    """
    ft = _find_stats_item(stats, "ALL", CORNER_NAMES)
    ht = _find_stats_item(stats, "1ST", CORNER_NAMES)
    return {
        "ht": {"home": ht[0] if ht else None, "away": ht[1] if ht else None},
        "ft": {"home": ft[0] if ft else None, "away": ft[1] if ft else None},
    }


def extract_goals(incidents: dict, event: Optional[dict]) -> dict:
    """
    Goals per half from the incident timeline, with the full-time score taken
    from the event itself (authoritative, and it excludes penalty-shootout
    goals, which must never count towards a goals market).

    Own goals are credited to the OPPOSITE side of the player who scored them.
    """
    ht_home = ht_away = 0
    ht_seen = False
    for inc in incidents.get("incidents", []) or []:
        if inc.get("incidentType") != "goal":
            continue
        cls = str(inc.get("incidentClass", "")).lower()
        if "shootout" in cls or "penaltyshootout" in cls.replace(" ", ""):
            continue  # shootout goals are not match goals
        minute = _to_int(inc.get("time")) or 0
        extra = _to_int(inc.get("addedTime")) or 0
        if minute > 45 + max(extra, 0) and minute > 45:
            continue  # second half
        if cls == "owngoal":
            is_home = not bool(inc.get("isHome"))
        else:
            is_home = bool(inc.get("isHome"))
        if is_home:
            ht_home += 1
        else:
            ht_away += 1
        ht_seen = True

    home_ft = _to_int((event or {}).get("homeScore", {}).get("current"))
    away_ft = _to_int((event or {}).get("awayScore", {}).get("current"))
    if home_ft is None or away_ft is None:
        # Fall back to the timeline (sum of both halves) when the event score is
        # unavailable; mark HT as unknown if we saw no goal incidents at all.
        home_ft = sum(
            1 for i in incidents.get("incidents", []) or []
            if i.get("incidentType") == "goal" and bool(i.get("isHome"))
        )
        away_ft = sum(
            1 for i in incidents.get("incidents", []) or []
            if i.get("incidentType") == "goal" and not bool(i.get("isHome"))
        )

    return {
        "ht": {"home": ht_home if ht_seen else None, "away": ht_away if ht_seen else None},
        "ft": {"home": home_ft, "away": away_ft},
    }


def extract_cards(incidents: dict) -> dict:
    """
    Yellow/red cards per half from the incident timeline.
    A second yellow is reported as `yellowRed` — counted as a red (the player
    was sent off), with the preceding yellow already counted separately.
    """
    out = {
        "ht": {"homeYellows": 0, "awayYellows": 0, "homeReds": 0, "awayReds": 0},
        "ft": {"homeYellows": 0, "awayYellows": 0, "homeReds": 0, "awayReds": 0},
    }
    seen = False
    for inc in incidents.get("incidents", []) or []:
        if inc.get("incidentType") != "card":
            continue
        seen = True
        cls = str(inc.get("incidentClass", "")).lower()
        is_home = bool(inc.get("isHome"))
        minute = _to_int(inc.get("time")) or 0
        extra = _to_int(inc.get("addedTime")) or 0
        first_half = minute <= 45 + max(extra, 0)
        for bucket in ("ft", "ht") if first_half else ("ft",):
            if "red" in cls:  # red + yellowRed
                out[bucket]["homeReds" if is_home else "awayReds"] += 1
            elif "yellow" in cls:
                out[bucket]["homeYellows" if is_home else "awayYellows"] += 1
    if not seen:
        # No card incidents at all is a legitimate 0-0; report zeros.
        pass
    return out


# ───────────────────────────── FotMob scraping ───────────────────────────────
# The free replacement for the corner gap: no API key, no proxy, no bot
# challenge. One pre-rendered match page carries corners (FT + HT), cards
# (FT + HT) and the full-time score; half-time goals come from the goal
# timeline and are only trusted when they reconcile with that score.
# See docs/FREE-DATA-SOURCES.md.

_NEXT_DATA_RE = re.compile(
    r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', re.S
)


def _parse_iso(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    try:
        return datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except ValueError:
        return None


def fotmob_day_events(pool: ProxyPool, day: datetime) -> list[dict]:
    """Finished fixtures for a day, normalized into the SofaScore event shape so
    the shared matcher and the rest of the orchestrator work unchanged."""
    url = f"{FOTMOB}/api/data/matches?date={day:%Y%m%d}"
    data = fetch_json(pool, url, f"fotmob day {day:%Y-%m-%d}", referer=FOTMOB + "/")
    if not data:
        return []

    cutoff = datetime.now(timezone.utc) - timedelta(minutes=MATCH_AGE_MINUTES)
    out: list[dict] = []
    for league in data.get("leagues") or []:
        for m in league.get("matches") or []:
            status = m.get("status") or {}
            # `awarded` matches had their result decided off the pitch — there
            # are no corners to read, so they must not look like a 0-0.
            if not status.get("finished") or status.get("cancelled") or status.get("awarded"):
                continue
            start = _parse_iso(status.get("utcTime"))
            if start is None or start > cutoff or not m.get("id"):
                continue
            out.append({
                "id": m.get("id"),
                "startTimestamp": int(start.timestamp()),
                "status": {"type": "finished"},
                "homeTeam": {"name": (m.get("home") or {}).get("name", "")},
                "awayTeam": {"name": (m.get("away") or {}).get("name", "")},
            })
    return out


def fotmob_page(pool: ProxyPool, match_id: Any) -> Optional[dict]:
    """Fetch a match page and return the pageProps JSON embedded in it.

    Stats live in __NEXT_DATA__ for pre-rendered matches. Some matches ship a
    deferred shell that has no `content` at all; those return None and the caller
    skips the fixture rather than sending a half-empty payload.
    """
    html = fetch_text(pool, f"{FOTMOB}/match/{match_id}", f"fotmob match {match_id}")
    if not html:
        return None
    m = _NEXT_DATA_RE.search(html)
    if not m:
        log(f"  fotmob {match_id}: page had no __NEXT_DATA__")
        return None
    try:
        return (json.loads(m.group(1)).get("props") or {}).get("pageProps") or {}
    except json.JSONDecodeError:
        log(f"  fotmob {match_id}: __NEXT_DATA__ was not valid JSON")
        return None


def _fotmob_period_stat(periods: dict, period: str, titles: Iterable[str]) -> Optional[tuple[int, int]]:
    """Positional [home, away] value of a named stat inside one period.

    Shape: Periods[period].stats[] are GROUPS, each with its own stats[] items
    of {title, key, stats: [home, away], format, type}.
    """
    wanted = {t.lower() for t in titles}
    for group in ((periods.get(period) or {}).get("stats") or []):
        for item in (group or {}).get("stats") or []:
            if str(item.get("title", "")).strip().lower() in wanted:
                vals = item.get("stats")
                if isinstance(vals, list) and len(vals) >= 2:
                    home, away = _to_int(vals[0]), _to_int(vals[1])
                    if home is not None and away is not None:
                        return home, away
    return None


FOTMOB_CORNER_TITLES = ("corners", "corner kicks")
FOTMOB_YELLOW_TITLES = ("yellow cards",)
FOTMOB_RED_TITLES = ("red cards",)


def fotmob_corners(periods: dict) -> dict:
    ft = _fotmob_period_stat(periods, "All", FOTMOB_CORNER_TITLES)
    ht = _fotmob_period_stat(periods, "FirstHalf", FOTMOB_CORNER_TITLES)
    return {
        "ht": {"home": ht[0] if ht else None, "away": ht[1] if ht else None},
        "ft": {"home": ft[0] if ft else None, "away": ft[1] if ft else None},
    }


def fotmob_cards(periods: dict) -> dict:
    out: dict = {}
    for bucket, period in (("ft", "All"), ("ht", "FirstHalf")):
        yellow = _fotmob_period_stat(periods, period, FOTMOB_YELLOW_TITLES)
        red = _fotmob_period_stat(periods, period, FOTMOB_RED_TITLES)
        out[bucket] = {
            "homeYellows": yellow[0] if yellow else None,
            "awayYellows": yellow[1] if yellow else None,
            "homeReds": red[0] if red else None,
            "awayReds": red[1] if red else None,
        }
    return out


def _fotmob_events(pp: dict) -> list[dict]:
    ev = ((pp.get("content") or {}).get("matchFacts") or {}).get("events") or {}
    items = ev.get("events") if isinstance(ev, dict) else None
    return [e for e in (items or []) if isinstance(e, dict)]


def fotmob_goals(pp: dict) -> dict:
    """FT from the header score (authoritative, and shootout-free).

    HT is derived from the goal timeline, but ONLY when that timeline accounts
    for every goal the header claims and no own goal blurs the side. Otherwise
    HT is null, which keeps the half-time goals markets in manual review instead
    of settling them against a guess.
    """
    teams = ((pp.get("header") or {}).get("teams")) or []
    ft_home = _to_int(teams[0].get("score")) if len(teams) > 0 and isinstance(teams[0], dict) else None
    ft_away = _to_int(teams[1].get("score")) if len(teams) > 1 and isinstance(teams[1], dict) else None

    goals = [e for e in _fotmob_events(pp) if e.get("type") == "Goal"]
    ht_home = ht_away = 0
    own_goal = False
    for e in goals:
        if e.get("ownGoal"):
            own_goal = True
        if (_to_int(e.get("time")) or 0) <= 45:
            if e.get("isHome"):
                ht_home += 1
            else:
                ht_away += 1

    ht = None
    if ft_home is not None and ft_away is not None:
        if ft_home == 0 and ft_away == 0:
            ht = {"home": 0, "away": 0}
        elif len(goals) == ft_home + ft_away and not own_goal:
            ht = {"home": ht_home, "away": ht_away}
    return {
        "ht": ht or {"home": None, "away": None},
        "ft": {"home": ft_home, "away": ft_away},
    }


def fotmob_stats(pp: dict) -> Optional[dict]:
    """All three families for the wire payload, or None if the page has no stats."""
    periods = (((pp.get("content") or {}).get("stats") or {}).get("Periods")) or {}
    if not periods:
        return None
    return {
        "corners": fotmob_corners(periods),
        "goals": fotmob_goals(pp),
        "cards": fotmob_cards(periods),
    }


def fotmob_process(pool: ProxyPool, ev: dict) -> bool:
    """Scrape + send one match from FotMob. Returns True when accepted."""
    match_id = ev.get("id")
    pp = fotmob_page(pool, match_id)
    if not pp:
        log(f"  fotmob {match_id}: page unavailable — skipping (no partial send)")
        return False
    general = pp.get("general") or {}
    if not general.get("finished"):
        log(f"  fotmob {match_id}: not finished yet — skipping")
        return False
    stats = fotmob_stats(pp)
    if not stats:
        log(f"  fotmob {match_id}: no stats block (deferred page shell) — skipping")
        return False

    # Same idempotency rule as the SofaScore path: stable per match + revision,
    # so a retry of the same scrape is recognised while a later correction is
    # processed as new data.
    revision = hashlib.sha256(json.dumps(stats, sort_keys=True).encode()).hexdigest()[:12]
    payload = {
        "eventId": f"fotmob-{match_id}-{revision}",
        "source": "settle-worker-fotmob",
        "match": {
            "externalId": str(match_id),
            "kickoff": datetime.fromtimestamp(int(ev["startTimestamp"]), tz=timezone.utc).isoformat(),
            "homeName": (general.get("homeTeam") or {}).get("name") or ev["homeTeam"]["name"],
            "awayName": (general.get("awayTeam") or {}).get("name") or ev["awayTeam"]["name"],
            "status": "FINISHED",
        },
        "stats": stats,
        "meta": {
            "scrapedAt": datetime.now(timezone.utc).isoformat(),
            "url": f"{FOTMOB}/match/{match_id}",
        },
    }
    ok, detail = post_payload(payload)
    label = f"{payload['match']['homeName']} vs {payload['match']['awayName']}"
    log(f"  {'OK  ' if ok else 'FAIL'} {label} corners FT {stats['corners']['ft']} "
        f"yellows FT {stats['cards']['ft']['homeYellows']}-{stats['cards']['ft']['awayYellows']} — {detail}")
    return ok


# ─────────────────────────────── webhook sender ──────────────────────────────


def sign(secret: str, timestamp: str, body: bytes) -> str:
    """HMAC-SHA256 over `${timestamp}.${body}` — mirrors the backend verifier."""
    mac = hmac.new(secret.encode("utf-8"), digestmod=hashlib.sha256)
    mac.update(f"{timestamp}.".encode("utf-8"))
    mac.update(body)
    return mac.hexdigest()


def post_payload(payload: dict) -> tuple[bool, str]:
    """POST a signed payload. Returns (ok, detail)."""
    # Dry run first: its job is to prove the SCRAPE works, so it must not
    # require a webhook to be configured yet.
    if DRY_RUN:
        return True, "dry-run (not sent)"
    if not WEBHOOK_URL or not WEBHOOK_SECRET:
        return False, "SETTLE_WEBHOOK_URL / SETTLE_WEBHOOK_SECRET not configured"

    body = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    headers = _signed_headers(body)
    headers["Content-Type"] = "application/json"
    headers["X-Voltbets-Event-Id"] = payload["eventId"]
    req = urllib.request.Request(WEBHOOK_URL, data=body, method="POST", headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT + 8) as resp:
            detail = resp.read().decode("utf-8", "replace")[:300]
            return resp.status in (200, 201, 202), f"HTTP {resp.status} {detail}"
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:300]
        return False, f"HTTP {e.code} {detail}"
    except Exception as e:  # noqa: BLE001
        return False, f"{type(e).__name__}: {e}"


# ─────────────────────────── work list (what to scrape) ──────────────────────


def _signed_headers(body: bytes) -> dict:
    """HMAC headers for a request. A GET has no body, so it signs "" (mirrors
    the backend verifier, which hashes `${ts}.${rawBody}`)."""
    ts = str(int(time.time()))
    return {
        "X-Voltbets-Timestamp": ts,
        "X-Voltbets-Signature": f"sha256={sign(WEBHOOK_SECRET, ts, body)}",
        "User-Agent": "voltbets-settle-worker/1.0",
    }


def fetch_pending(pool: "ProxyPool") -> list[dict]:
    """
    Ask the backend which matches still need external stats.

    Without this the worker scrapes a whole day and discards nearly all of it,
    burning both the proxy budget and the block rate on matches nobody bet on.
    A failure here is not fatal: the caller falls back to the date scan.
    """
    url = PENDING_URL or (WEBHOOK_URL.replace("/process", "/pending") if WEBHOOK_URL else "")
    if not url or not WEBHOOK_SECRET:
        return []
    req = urllib.request.Request(url, method="GET", headers=_signed_headers(b""))
    try:
        with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT + 8) as resp:
            data = json.loads(resp.read().decode("utf-8", "replace"))
        games = data.get("games", []) or []
        log(f"work list: {len(games)} game(s) with unsettled stat markets")
        return games
    except urllib.error.HTTPError as e:
        log(f"work list unavailable (HTTP {e.code}) — falling back to date scan")
    except Exception as e:  # noqa: BLE001
        log(f"work list unavailable ({type(e).__name__}) — falling back to date scan")
    return []


def normalize_team(name: str) -> str:
    """Mirror of normalizeTeamName() in src/lib/settlement/resolve-stats.ts."""
    import re
    import unicodedata

    s = unicodedata.normalize("NFD", name or "")
    s = "".join(c for c in s if unicodedata.category(c) != "Mn").lower()
    s = re.sub(r"[^a-z0-9\s]", " ", s)
    s = re.sub(r"\b(fc|afc|cf|sc|ac|as|ss|ssc|cd|ud|rc|rcd|bk|fk|if|club|the|de|of)\b", " ", s)
    return " ".join(t for t in s.split() if len(t) > 1)


def team_score(a: str, b: str) -> float:
    """Token coverage in [0,1] — coverage only, exactly like the backend.
    A looser rule (one long shared token is enough) would match
    'Manchester United' with 'Manchester City' and settle the wrong fixture."""
    x, y = normalize_team(a), normalize_team(b)
    if not x or not y:
        return 0.0
    if x == y:
        return 1.0
    xs, ys = set(x.split()), set(y.split())
    shared = len({t for t in xs if t in ys and len(t) >= 3})
    return shared / max(len(xs), len(ys)) if shared else 0.0


MIN_TEAM_SCORE = 0.6
KICKOFF_TOLERANCE_MINUTES = 180


def match_event(pending: dict, events: list[dict]) -> Optional[dict]:
    """Resolve one work-list entry to ITS event id in the scrape source.

    The two sides share no id (our externalId belongs to the odds feed), so the
    match is made on team names + kickoff — the same rule the backend applies in
    the other direction.
    """
    want_home, want_away = pending.get("homeName", ""), pending.get("awayName", "")
    try:
        want_kick = datetime.fromisoformat(pending["kickoff"].replace("Z", "+00:00"))
    except (KeyError, ValueError):
        return None

    best, best_score = None, 0.0
    for ev in events:
        ts = ev.get("startTimestamp")
        if not ts:
            continue
        delta = abs(datetime.fromtimestamp(int(ts), tz=timezone.utc) - want_kick).total_seconds() / 60
        if delta > KICKOFF_TOLERANCE_MINUTES:
            continue
        home = (ev.get("homeTeam") or {}).get("name", "")
        away = (ev.get("awayTeam") or {}).get("name", "")
        straight = min(team_score(home, want_home), team_score(away, want_away))
        swapped = min(team_score(home, want_away), team_score(away, want_home))
        score = max(straight, swapped)
        if score >= MIN_TEAM_SCORE and score > best_score:
            best, best_score = ev, score
    return best


# ──────────────────────────────── discovery ──────────────────────────────────


def find_finished_events(pool: ProxyPool, day: datetime) -> list[dict]:
    """Scheduled events for a date, filtered to matches old enough to settle."""
    url = f"{SOFASCORE}/sport/football/scheduled-events/{day.strftime('%Y-%m-%d')}"
    data = fetch_json(pool, url, f"scheduled-events {day:%Y-%m-%d}")
    if not data:
        return []

    cutoff = datetime.now(timezone.utc) - timedelta(minutes=MATCH_AGE_MINUTES)
    out: list[dict] = []
    for ev in data.get("events", []) or []:
        status = str((ev.get("status") or {}).get("type", "")).lower()
        if status not in ("finished", "aet", "pen"):
            continue
        ts = ev.get("startTimestamp")
        if not ts:
            continue
        start = datetime.fromtimestamp(int(ts), tz=timezone.utc)
        if start > cutoff:
            continue
        out.append(ev)
    return out


def build_payload(ev: dict) -> Optional[dict]:
    """Scrape one event and shape it into the backend's wire format."""
    event_id = ev.get("id")
    if not event_id:
        return None
    return {
        "eventId": "",  # filled by caller (needs the revision hash)
        "source": "settle-worker",
        "match": {
            "externalId": str(event_id),
            "kickoff": datetime.fromtimestamp(int(ev["startTimestamp"]), tz=timezone.utc).isoformat(),
            "homeName": (ev.get("homeTeam") or {}).get("name", ""),
            "awayName": (ev.get("awayTeam") or {}).get("name", ""),
            "status": {"finished": "FINISHED", "aet": "AET", "pen": "PENS"}.get(
                str((ev.get("status") or {}).get("type", "")).lower(), "FINISHED"
            ),
        },
    }


def process_event(pool: ProxyPool, ev: dict) -> bool:
    """Scrape + send one match. Returns True when the backend accepted it."""
    event_id = ev.get("id")
    base = build_payload(ev)
    if not base:
        return False

    stats = fetch_json(pool, f"{SOFASCORE}/event/{event_id}/statistics", f"statistics {event_id}")
    if not stats:
        log(f"  event {event_id}: statistics unavailable — skipping (no partial send)")
        return False
    incidents = fetch_json(pool, f"{SOFASCORE}/event/{event_id}/incidents", f"incidents {event_id}")
    if incidents is None:
        log(f"  event {event_id}: incidents unavailable — skipping (no partial send)")
        return False

    corners = extract_corners(stats)
    goals = extract_goals(incidents, ev)
    cards = extract_cards(incidents)

    # Idempotency key: stable per match + revision, so a retry of the SAME
    # scrape is recognised, while a genuinely later revision (score correction)
    # is processed as new data.
    revision = hashlib.sha256(
        json.dumps({"c": corners, "g": goals, "k": cards}, sort_keys=True).encode()
    ).hexdigest()[:12]
    base["eventId"] = f"sofa-{event_id}-{revision}"
    base["stats"] = {"corners": corners, "goals": goals, "cards": cards}
    base["meta"] = {"scrapedAt": datetime.now(timezone.utc).isoformat(), "url": f"{SOFASCORE}/event/{event_id}"}

    ok, detail = post_payload(base)
    label = f"{base['match']['homeName']} vs {base['match']['awayName']}"
    log(f"  {'OK  ' if ok else 'FAIL'} {label} corners FT {corners['ft']} — {detail}")
    return ok


# ─────────────────────────────────── main ────────────────────────────────────


def main() -> int:
    ap = argparse.ArgumentParser(description="Voltbets settlement worker")
    ap.add_argument("--date", help="YYYY-MM-DD to scan (default: today and yesterday UTC)")
    ap.add_argument("--limit", type=int, default=MAX_MATCHES_PER_RUN)
    ap.add_argument("--dry-run", action="store_true", help="scrape but do not POST")
    ap.add_argument("--no-pending", action="store_true",
                    help="ignore the backend work list and scrape every finished match")
    ap.add_argument("--selftest", action="store_true",
                    help="run the parser/matching self-test offline and exit")
    ap.add_argument("--source", choices=("sofa", "fotmob"), default=SOURCE,
                    help=f"upstream stats source (default: {SOURCE}; env SETTLE_SOURCE)")
    args = ap.parse_args()

    if args.selftest:
        return selftest()

    global DRY_RUN
    if args.dry_run:
        DRY_RUN = True

    log(f"settlement worker start (source={args.source}, dry_run={DRY_RUN}, age>{MATCH_AGE_MINUTES}min)")
    pool = ProxyPool.from_env()
    if args.source == "fotmob":
        # FotMob needs neither a key nor a proxy. Healthchecking exits against a
        # SofaScore URL would only burn them for nothing.
        log("source=fotmob: no key and no proxy required"
            + (" (proxies configured and will still be rotated)" if pool.proxies else ""))
    else:
        pool.healthcheck()

    days = (
        [datetime.strptime(args.date, "%Y-%m-%d").replace(tzinfo=timezone.utc)]
        if args.date
        else [datetime.now(timezone.utc), datetime.now(timezone.utc) - timedelta(days=1)]
    )

    # The daily schedule doubles as the id index: it is 1-2 cheap requests that
    # map our fixtures onto the scrape source's event ids.
    day_events = fotmob_day_events if args.source == "fotmob" else find_finished_events
    process = fotmob_process if args.source == "fotmob" else process_event

    events: list[dict] = []
    for day in days:
        found = day_events(pool, day)
        log(f"{day:%Y-%m-%d}: {len(found)} finished event(s) older than {MATCH_AGE_MINUTES}min")
        events += found

    seen: set = set()
    unique: list[dict] = []
    for ev in events:
        if ev.get("id") in seen:
            continue
        seen.add(ev.get("id"))
        unique.append(ev)

    # Prefer the backend work list: it names the matches with UNSETTLED stat
    # markets, so a run touches a handful of fixtures instead of a full day.
    targets: list[dict] = []
    if not args.no_pending:
        pending = fetch_pending(pool)
        if pending:
            unmatched = 0
            for entry in pending:
                ev = match_event(entry, unique)
                if ev:
                    targets.append(ev)
                else:
                    unmatched += 1
            log(f"work list: resolved {len(targets)}/{len(pending)} to source events"
                + (f", {unmatched} unmatched (names drifted or not in today's feed)" if unmatched else ""))
            if not targets:
                log("work list resolved nothing — check the team-name mapping before trusting a quiet run")
                return 1

    if not targets:
        log("no work list configured — scraping every finished match this window")
        targets = unique[: args.limit]

    sent = 0
    for ev in targets:
        if process(pool, ev):
            sent += 1
        # Only stop for an exhausted pool. With no proxies configured we are
        # talking to the source directly, and an empty pool is the normal state
        # rather than a failure.
        if pool.proxies and not pool.alive():
            log("proxy pool exhausted — stopping this run")
            break

    log(f"done: {sent}/{len(targets)} accepted. {pool.report()}")
    return 0



# ─────────────────────────────── self-test ───────────────────────────────────
# Exercises the PARSERS (the part that silently goes wrong when a provider
# changes its payload) with no network access. Run after any edit to this file
# and after any report of a mis-settled stat market:
#     python3 settle_worker.py --selftest


def selftest() -> int:
    import hmac as _hmac  # noqa: F401  (documents that sign() is HMAC-based)

    failures: list[str] = []

    def check(label: str, got: object, want: object) -> None:
        if got != want:
            failures.append(f"{label}: got {got!r}, want {want!r}")

    # 1. Team matching must NOT match different clubs from the same city.
    check("normalize Wrexham AFC", normalize_team("Wrexham AFC"), "wrexham")
    check("normalize accents", normalize_team("Fenerbahçe"), "fenerbahce")
    check("normalize initials", normalize_team("Racing Santander S.A.D."), "racing santander")
    check("score exact", team_score("Racing Santander", "Racing Santander"), 1.0)
    check("score suffix", team_score("Wrexham AFC", "Wrexham"), 1.0)
    if team_score("Manchester United", "Manchester City") >= MIN_TEAM_SCORE:
        failures.append("team_score matched Manchester United vs Manchester City — would settle the wrong fixture")

    # 2. Statistics parsing: period "ALL" = FT, "1ST" = first half.
    stats = {
        "statistics": [
            {"period": "ALL", "groups": [{"statisticsItems": [
                {"name": "Corner kicks", "home": "6", "away": "4"},
                {"name": "Yellow cards", "home": "3", "away": "2"},
            ]}]},
            {"period": "1ST", "groups": [{"statisticsItems": [
                {"name": "Corner kicks", "home": "2", "away": "3"},
            ]}]},
        ]
    }
    corners = extract_corners(stats)
    check("corners ft", corners["ft"], {"home": 6, "away": 4})
    check("corners ht", corners["ht"], {"home": 2, "away": 3})

    # Missing 1ST block must be None (not 0) so HT markets stay manual.
    check("corners ht missing", extract_corners({"statistics": stats["statistics"][:1]})["ht"],
          {"home": None, "away": None})

    # 3. Goals: HT from the timeline, FT from the event score (excludes shootout).
    incidents = {"incidents": [
        {"incidentType": "goal", "incidentClass": "regular", "time": 23, "isHome": True},
        {"incidentType": "goal", "incidentClass": "regular", "time": 52, "isHome": False},
        {"incidentType": "goal", "incidentClass": "regular", "time": 74, "isHome": False},   # own goal
        {"incidentType": "goal", "incidentClass": "penaltyShootoutGoal", "time": 120, "isHome": True},
    ]}
    goals = extract_goals(incidents, {"homeScore": {"current": 2}, "awayScore": {"current": 1}})
    check("goals ht", goals["ht"], {"home": 1, "away": 0})
    check("goals ft", goals["ft"], {"home": 2, "away": 1})

    # 4. Cards: HT split at 45', a second yellow counts as a red.
    cards = extract_cards({"incidents": [
        {"incidentType": "card", "incidentClass": "yellow", "time": 30, "isHome": True},
        {"incidentType": "card", "incidentClass": "yellow", "time": 44, "isHome": False},
        {"incidentType": "card", "incidentClass": "red", "time": 70, "isHome": True},
        {"incidentType": "card", "incidentClass": "yellowRed", "time": 85, "isHome": False},
    ]})
    check("cards ht", cards["ht"], {"homeYellows": 1, "awayYellows": 1, "homeReds": 0, "awayReds": 0})
    check("cards ft", cards["ft"], {"homeYellows": 1, "awayYellows": 1, "homeReds": 1, "awayReds": 1})

    # 5. Work-list matching: right fixture, right kickoff, orientation tolerated.
    ev = {
        "id": 999,
        "startTimestamp": int(datetime(2026, 9, 11, 18, 0, tzinfo=timezone.utc).timestamp()),
        "homeTeam": {"name": "Racing Santander"},
        "awayTeam": {"name": "Deportivo Alaves"},
    }
    other = {
        "id": 1000,
        "startTimestamp": ev["startTimestamp"],
        "homeTeam": {"name": "Manchester United"},
        "awayTeam": {"name": "Manchester City"},
    }
    matched = match_event(
        {"homeName": "Racing Santander", "awayName": "Deportivo Alaves", "kickoff": "2026-09-11T18:00:00Z"},
        [other, ev],
    )
    check("match_event picks the right fixture", (matched or {}).get("id"), 999)
    check("match_event rejects a stranger",
          match_event({"homeName": "Nobody", "awayName": "At All", "kickoff": "2026-09-11T18:00:00Z"}, [ev]), None)

    # 6. The signature the backend verifies: HMAC over "<ts>.<body>".
    check("sign matches the documented scheme",
          sign("secret", "1800000000", b'{"a":1}'),
          _hmac.new(b"secret", b'1800000000.{"a":1}', hashlib.sha256).hexdigest())

    # 7. FotMob parsing. Payload captured verbatim from the live page for
    #    Union Berlin 1-3 Schalke 04 (2026-09-11) — the match that proved
    #    BigBallsData undercounts cards, so the expected 3-1 is the point.
    fm_periods = {
        "All": {"stats": [
            {"title": "Top stats", "stats": [
                {"title": "Ball possession", "key": "ball_possession", "stats": [66, 34]},
                {"title": "Yellow cards", "key": "yellow_cards", "stats": [3, 1]},
                {"title": "Corners", "key": "corners", "stats": [4, 5]},
                {"title": "Red cards", "key": "red_cards", "stats": [0, 0]},
            ]},
        ]},
        "FirstHalf": {"stats": [
            {"title": "Top stats", "stats": [
                {"title": "Yellow cards", "key": "yellow_cards", "stats": [1, 0]},
                {"title": "Corners", "key": "corners", "stats": [1, 5]},
                {"title": "Red cards", "key": "red_cards", "stats": [0, 0]},
            ]},
        ]},
    }
    fm_goals_events = [
        {"type": "Goal", "time": 25, "isHome": False},
        {"type": "Goal", "time": 46, "isHome": False},
        {"type": "Goal", "time": 90, "isHome": True},
        {"type": "Goal", "time": 90, "isHome": False},
    ]
    pp = {
        "header": {"teams": [{"score": 1}, {"score": 3}]},
        "content": {"stats": {"Periods": fm_periods},
                    "matchFacts": {"events": {"events": fm_goals_events}}},
    }
    fm_corners = fotmob_corners(fm_periods)
    check("fotmob corners ft", fm_corners["ft"], {"home": 4, "away": 5})
    check("fotmob corners ht", fm_corners["ht"], {"home": 1, "away": 5})
    fm_cards = fotmob_cards(fm_periods)
    check("fotmob yellows ft (the undercount case)", 
          [fm_cards["ft"]["homeYellows"], fm_cards["ft"]["awayYellows"]], [3, 1])
    check("fotmob yellows ht",
          [fm_cards["ht"]["homeYellows"], fm_cards["ht"]["awayYellows"]], [1, 0])
    fm_goals = fotmob_goals(pp)
    check("fotmob goals ft", fm_goals["ft"], {"home": 1, "away": 3})
    check("fotmob goals ht", fm_goals["ht"], {"home": 0, "away": 1})

    # A timeline that does not add up to the header score must yield a null HT,
    # never a wrong one: that is what keeps HT markets in review.
    broken = {"header": {"teams": [{"score": 1}, {"score": 3}]},
              "content": {"stats": {"Periods": fm_periods},
                          "matchFacts": {"events": {"events": fm_goals_events[:2]}}}}
    check("fotmob ht goals null when timeline is short", fotmob_goals(broken)["ht"],
          {"home": None, "away": None})

    # An own goal blurs side attribution, so HT must also be withheld.
    og = {"header": {"teams": [{"score": 1}, {"score": 3}]},
          "content": {"stats": {"Periods": fm_periods},
                      "matchFacts": {"events": {"events": [
                          dict(e, ownGoal=True) if i == 0 else e
                          for i, e in enumerate(fm_goals_events)]}}}}
    check("fotmob ht goals null when an own goal is present", fotmob_goals(og)["ht"],
          {"home": None, "away": None})

    # A page with no stats block (deferred shell) yields None -> skip, no send.
    check("fotmob stats None without a stats block",
          fotmob_stats({"header": {"teams": [{"score": 0}, {"score": 0}]}, "content": {}}), None)
    # A real 0-0 is still settled: zero is a fact, missing is not.
    zero = {"header": {"teams": [{"score": 0}, {"score": 0}]},
            "content": {"stats": {"Periods": fm_periods}, "matchFacts": {"events": {"events": []}}}}
    check("fotmob 0-0 gives an actual 0-0 at HT", fotmob_goals(zero)["ht"],
          {"home": 0, "away": 0})

    if failures:
        print("SELFTEST FAILED:")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("selftest: all parser + matching checks passed")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(130)
