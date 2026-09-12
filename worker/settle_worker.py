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


# Hosts that answer a datacentre IP directly. Routing these through the proxy
# pool adds latency, burns paid exits on requests that never needed one, and
# turns a proxy outage into a settlement outage.
KEYLESS_HOSTS = ("fotmob.com", "365scores.com")


def _pool_for(url: str, pool: ProxyPool) -> ProxyPool:
    """Use the proxy pool ONLY for a source that actually needs it.

    SofaScore blocks datacentre IPs, so it goes through the pool. FotMob and
    365Scores do not block, so they go direct — even when the pool is configured
    (which is exactly the case where a slow exit must not stall settlement).
    """
    if any(h in url for h in KEYLESS_HOSTS):
        return ProxyPool()
    return pool


def _fetch_bytes(pool: ProxyPool, url: str, what: str, referer: str) -> Optional[bytes]:
    """
    GET a URL, rotating proxies and purging bad exits.

    Returns None when every proxy failed — the caller skips that match rather
    than sending a partial payload. A missing corner count must never look like
    zero corners.
    """
    pool = _pool_for(url, pool)
    last_error = "no attempt made"
    for attempt in range(RETRIES_PER_REQUEST):
        proxy = pool.rotate()
        started = time.monotonic()
        try:
            body = _http_get(url, proxy, REQUEST_TIMEOUT, referer=referer)
            elapsed = time.monotonic() - started
            if elapsed > PROXY_MAX_LATENCY:
                # Answered, but too slowly to keep in a cron window.
                last_error = f"slow {elapsed:.1f}s"
                pool.drop(proxy, f"slow {elapsed:.1f}s")
                continue
            pool.mark_ok(proxy)
            return body
        except urllib.error.HTTPError as e:
            last_error = f"HTTP {e.code}"
            if e.code in DROP_STATUSES:
                pool.drop(proxy, f"HTTP {e.code}")
        except urllib.error.URLError as e:
            reason = e.reason.__class__.__name__ if hasattr(e, "reason") else "error"
            last_error = f"conn {reason}"
            pool.drop(proxy, f"conn {reason}")
        except (TimeoutError, ssl.SSLError) as e:
            last_error = type(e).__name__
            pool.drop(proxy, type(e).__name__)
        except Exception as e:  # noqa: BLE001
            last_error = type(e).__name__
            pool.drop(proxy, type(e).__name__)

        # Only stop when a CONFIGURED pool has been exhausted. With no proxies
        # configured we talk to the source directly, so an empty pool is the
        # normal state, not a reason to give up after one transient failure —
        # the keyless sources (fotmob / 365) would otherwise fail a whole run
        # on a single timeout and report it as "no proxy available".
        if pool.proxies and not pool.alive():
            break
        if attempt + 1 < RETRIES_PER_REQUEST:
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


def fotmob_card_events(pp: dict) -> Optional[dict]:
    """Card counts read from FotMob's OWN event timeline, not its stats widget.

    This is the free tiebreak: a source whose summary row disagrees with its own
    minute-by-minute timeline is self-contradictory and can be discarded, with no
    third provider, no key and no extra request (the page is already fetched).
    Returns None when the page carries no timeline at all, so "no data" is never
    mistaken for "no cards".
    """
    ev = ((pp.get("content") or {}).get("matchFacts") or {}).get("events")
    items = ev.get("events") if isinstance(ev, dict) else None
    if items is None:
        return None
    zero = {"homeYellows": 0, "awayYellows": 0, "homeReds": 0, "awayReds": 0}
    out = {"ft": dict(zero), "ht": dict(zero)}
    for e in items:
        if not isinstance(e, dict) or e.get("type") != "Card":
            continue
        card = str(e.get("card") or "").lower()
        if not card:
            continue
        # A second yellow ("YellowRed") is a red for counting purposes, matching
        # the SofaScore extractor's convention.
        is_red = "red" in card
        home = bool(e.get("isHome"))
        minute = _to_int(e.get("time")) or 0
        for bucket in (("ft", "ht") if minute <= 45 else ("ft",)):
            side = "home" if home else "away"
            key = f"{side}{'Reds' if is_red else 'Yellows'}"
            out[bucket][key] += 1
    return out


def s365_card_events(detail: Optional[dict]) -> Optional[dict]:
    """Card counts from 365Scores' own event timeline. None when absent."""
    g = (detail or {}).get("game") or {}
    events = g.get("events")
    if events is None:
        return None
    home_id = (g.get("homeCompetitor") or {}).get("id")
    zero = {"homeYellows": 0, "awayYellows": 0, "homeReds": 0, "awayReds": 0}
    out = {"ft": dict(zero), "ht": dict(zero)}
    for e in events or []:
        name = str(((e.get("eventType") or {}).get("name")) or "").lower()
        if "card" not in name:
            continue
        is_red = "red" in name
        home = e.get("competitorId") == home_id
        minute = _to_int(e.get("gameTime")) or 0
        for bucket in (("ft", "ht") if minute <= 45 else ("ft",)):
            side = "home" if home else "away"
            key = f"{side}{'Reds' if is_red else 'Yellows'}"
            out[bucket][key] += 1
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


# ───────────────────────── 365Scores scraping (keyless) ──────────────────────
#
# A third, independent source. Unlike SofaScore it answers a datacentre IP
# directly — no key, no proxy, no anti-bot challenge. It is what makes a
# two-source agreement rule possible WITHOUT paying anyone.
#
#   day list : /games/allscores/?...&startDate=DD/MM/YYYY&endDate=DD/MM/YYYY
#   stats    : /game/stats/?games=<id>            ← param is `games` (plural);
#              `gameId=` returns HTTP 500
#              &filterId=6 = 1st half, &filterId=8 = 2nd half
#   detail   : /game/?gameId=<id>                 ← status + goal/card timeline
#
# Field semantics that matter for money:
#   * statistic rows are {name, competitorId, value}; Corners=8, Yellow=1, Red=2.
#     Map competitorId via the SAME response's games[0].homeCompetitor.id /
#     .awayCompetitor.id — never by list order.
#   * a filter that returns NOTHING for every family means the split is
#     unsupported for that match (not "zero") — return None so the market goes
#     to review instead of settling 0-0.
S365 = "https://webws.365scores.com/web"
S365_REFERER = "https://www.365scores.com/"
# A normal day carries ~260 football fixtures; a handful means a truncated
# response (seen live), so the day list is re-fetched and the larger kept.
S365_DAY_MIN_GAMES = 50

# Families that must be confirmed by a second source before settling. Cards are
# the documented hazard (BigBallsData undercounts them; a single scrape can too),
# so they default to agree-or-review. Add "corners" to tighten further.
CROSS_REQUIRE = {
    f.strip().lower()
    for f in os.environ.get("SETTLE_CROSS_REQUIRE", "cards").split(",")
    if f.strip()
}


def s365_day_events(pool: ProxyPool, day: datetime) -> list[dict]:
    """Finished fixtures for a day, in the shared event shape.

    The allscores endpoint intermittently answers with a PARTIAL list — observed
    live: 19 games on one call, 263 on the next for the same date. A truncated
    day list silently hides fixtures, and in cross mode a hidden fixture is
    indistinguishable from a disagreement, so it must not be trusted blindly:
    below the sanity floor it is re-fetched and the larger payload wins.
    """
    d = f"{day:%d/%m/%Y}"
    url = (f"{S365}/games/allscores/?appTypeId=5&langId=1&timezoneName=UTC"
           f"&sports=1&startDate={d}&endDate={d}")
    data = None
    best_n = -1
    for attempt in range(2):
        got = fetch_json(pool, url, f"365 day {day:%Y-%m-%d}", referer=S365_REFERER)
        n = len((got or {}).get("games") or [])
        if n > best_n:
            data, best_n = got, n
        if n >= S365_DAY_MIN_GAMES or attempt == 1:
            break
    if not data:
        return []
    if 0 < best_n < S365_DAY_MIN_GAMES:
        log(f"  365 day {day:%Y-%m-%d}: only {best_n} games after a retry — "
            f"the endpoint looks truncated, some fixtures may be missed")
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=MATCH_AGE_MINUTES)
    out: list[dict] = []
    for g in data.get("games") or []:
        status = str(g.get("statusText") or "").lower()
        group = g.get("statusGroup")
        # statusGroup 4 / statusText "Ended" is the finished state; both are
        # checked because neither is documented.
        if status not in ("ended", "finished", "after penalties", "after extra time") and group != 4:
            continue
        start = _parse_iso(g.get("startTime"))
        if start is None or start > cutoff or not g.get("id"):
            continue
        out.append({
            "id": g.get("id"),
            "startTimestamp": int(start.timestamp()),
            "status": {"type": "finished"},
            "homeTeam": {"name": (g.get("homeCompetitor") or {}).get("name", "")},
            "awayTeam": {"name": (g.get("awayCompetitor") or {}).get("name", "")},
        })
    return out


def _s365_rows(data: dict) -> dict:
    """{statistic name -> (home value, away value)} using the response's own
    home/away competitor ids. Values arrive as strings."""
    games = data.get("games") or []
    if not games:
        return {}
    g = games[0]
    home_id = (g.get("homeCompetitor") or {}).get("id")
    away_id = (g.get("awayCompetitor") or {}).get("id")
    agg: dict = {}
    for row in data.get("statistics") or []:
        name = row.get("name")
        cid = row.get("competitorId")
        val = _to_int(row.get("value"))
        if name is None or val is None:
            continue
        slot = 0 if cid == home_id else 1 if cid == away_id else None
        if slot is None:
            continue
        pair = agg.setdefault(name, [None, None])
        pair[slot] = val
    return agg


def _s365_side(rows: dict, name: str) -> Optional[tuple[int, int]]:
    pair = rows.get(name)
    if not pair or pair[0] is None or pair[1] is None:
        return None
    return pair[0], pair[1]


def s365_payload_stats(pool: ProxyPool, gid: Any) -> Optional[tuple[dict, Optional[dict]]]:
    """Corners + cards (FT and 1st half) for one fixture, or None if unavailable.

    Three requests: FT stats, 1st-half stats, and the match detail (for status +
    the goal timeline). Any family we cannot read is returned as null — never 0.

    Returns (stats, card_events). `card_events` is the same match read from
    365Scores' own timeline, which the cross-check uses to test whether this
    source's summary row is self-consistent — no extra request, since the detail
    call is already made for the goal timeline.
    """
    ft_raw = fetch_json(pool, f"{S365}/game/stats/?games={gid}", f"365 stats {gid}", referer=S365_REFERER)
    if not ft_raw or not (ft_raw.get("games") or []):
        return None
    g = ft_raw["games"][0]
    if str(g.get("statusText") or "").lower() not in ("ended", "finished", "after penalties", "after extra time") \
            and g.get("statusGroup") != 4:
        return None
    ft = _s365_rows(ft_raw)
    if not ft:
        return None

    ht_raw = fetch_json(pool, f"{S365}/game/stats/?games={gid}&filterId=6",
                        f"365 stats {gid} 1H", referer=S365_REFERER)
    ht = _s365_rows(ht_raw) if ht_raw else {}
    # An empty 1st-half response means the split is unsupported for this match,
    # NOT that everything was zero.
    ht_supported = bool(ht)

    def ht_or_none(name: str) -> Optional[tuple[int, int]]:
        return _s365_side(ht, name) if ht_supported else None

    corners_ft = _s365_side(ft, "Corners")
    y_ft, r_ft = _s365_side(ft, "Yellow Cards"), _s365_side(ft, "Red Cards")
    corners_ht, y_ht, r_ht = ht_or_none("Corners"), ht_or_none("Yellow Cards"), ht_or_none("Red Cards")

    # Goals: FT from the detail payload's score, HT from the goal timeline, but
    # only when the timeline reconciles with the score (same rule as FotMob).
    detail = fetch_json(pool, f"{S365}/game/?gameId={gid}&appTypeId=5&langId=1&timezoneName=UTC",
                        f"365 game {gid}", referer=S365_REFERER)
    goals = _s365_goals(detail, g)

    def pair(p: Optional[tuple[int, int]]) -> dict:
        return {"home": p[0] if p else None, "away": p[1] if p else None}

    def cards(p_ft, p_ht) -> dict:
        out: dict = {}
        out["ft"] = {
            "homeYellows": p_ft[0][0] if p_ft[0] else None,
            "awayYellows": p_ft[0][1] if p_ft[0] else None,
            "homeReds": p_ft[1][0] if p_ft[1] else None,
            "awayReds": p_ft[1][1] if p_ft[1] else None,
        }
        out["ht"] = {
            "homeYellows": p_ht[0][0] if p_ht[0] else None,
            "awayYellows": p_ht[0][1] if p_ht[0] else None,
            "homeReds": p_ht[1][0] if p_ht[1] else None,
            "awayReds": p_ht[1][1] if p_ht[1] else None,
        }
        return out

    return ({
        "corners": {"ft": pair(corners_ft), "ht": pair(corners_ht)},
        "goals": goals,
        "cards": cards((y_ft, r_ft), (y_ht, r_ht)),
    }, s365_card_events(detail))


def _s365_goals(detail: Optional[dict], game: dict) -> dict:
    """FT from the score; HT from the goal timeline only when it reconciles."""
    ft_home = _to_int((game.get("homeCompetitor") or {}).get("score"))
    ft_away = _to_int((game.get("awayCompetitor") or {}).get("score"))
    ht = None
    if detail and ft_home is not None and ft_away is not None:
        g = detail.get("game") or {}
        home_id = (g.get("homeCompetitor") or {}).get("id", (game.get("homeCompetitor") or {}).get("id"))
        goals = [e for e in (g.get("events") or []) if (e.get("eventType") or {}).get("name") == "Goal"]
        h = a = 0
        for e in goals:
            if (e.get("gameTime") or 0) <= 45:
                if e.get("competitorId") == home_id:
                    h += 1
                else:
                    a += 1
        if ft_home == 0 and ft_away == 0:
            ht = (0, 0)
        elif len(goals) == ft_home + ft_away:
            ht = (h, a)
    return {
        "ht": {"home": ht[0] if ht else None, "away": ht[1] if ht else None},
        "ft": {"home": ft_home, "away": ft_away},
    }


def s365_process(pool: ProxyPool, ev: dict) -> bool:
    res = s365_payload_stats(pool, ev.get("id"))
    if not res:
        log(f"  365scores {ev.get('id')}: no statistics — skipping (no partial send)")
        return False
    stats, _events = res
    return _send(pool, ev, stats, "365scores", f"{S365}/game/stats/?games={ev.get('id')}")


# ─────────────────────────── cross-check (2 sources) ─────────────────────────
#
# FotMob is the coverage leader and 365Scores is an independent keyless source.
# They are the free substitute for the SLA you are not buying: where they agree
# the number is almost certainly right; where they disagree, the family is sent
# as null so those markets land in the manual review queue instead of paying out
# on one source's guess.


def _same(a: Optional[int], b: Optional[int]) -> bool:
    return a is not None and b is not None and a == b


def _agree_pair(a: dict, b: dict) -> Optional[dict]:
    """Return the agreed {home,away} or None when the sources differ/are missing."""
    if _same(a.get("home"), b.get("home")) and _same(a.get("away"), b.get("away")):
        return {"home": a["home"], "away": a["away"]}
    return None


CARD_KEYS = ("homeYellows", "awayYellows", "homeReds", "awayReds")


NULL_PAIR = {"home": None, "away": None}
NULL_CARDS = {"homeYellows": None, "awayYellows": None, "homeReds": None, "awayReds": None}


def _decide_card(key, av, bv, ea, eb, tv) -> tuple[object, Optional[str]]:
    """Decide ONE card field: agreement, then self-consistency, then a third source.

    Order matters — each rung is cheaper and more trustworthy than the next:
      1. FotMob and 365Scores agree                -> settled, done.
      2. One of them contradicts its OWN timeline  -> discard that source; the
         other one is settled. Costs nothing (both timelines are already read).
      3. A third source resolves the split         -> settled on the majority.
      4. Otherwise                                 -> null, to manual review.

    `ea`/`eb` are that source's event-derived count for this field, or None when
    it published no timeline. A source is only judged against its own timeline
    when it actually reported a number, so "no data" is never a verdict.
    """
    if av is not None and bv is not None and av == bv:
        return av, None

    ca = None if (ea is None or av is None) else (av == ea)
    cb = None if (eb is None or bv is None) else (bv == eb)
    # "corroborated" beats "contradicted" OR "unverifiable": a source whose own
    # minute-level timeline backs its summary is stronger evidence than a bare
    # number nobody can check. Which of the two it was is named in the note, so
    # the weaker case can be counted and gated separately.
    if ca is True and cb is not True:
        other = f"365 contradicts its own ({eb})" if cb is False else "365 published no timeline"
        return av, f"SELF-CHECK fm={av} matches its own timeline; {other} -> settled on fm"
    if cb is True and ca is not True:
        other = f"fm contradicts its own ({ea})" if ca is False else "fm published no timeline"
        return bv, f"SELF-CHECK 365={bv} matches its own timeline; {other} -> settled on 365"

    if tv is not None:
        if av is not None and av == tv:
            return av, f"TIEBREAK fm={av} == third={tv} (365={bv}) -> settled"
        if bv is not None and bv == tv:
            return bv, f"TIEBREAK 365={bv} == third={tv} (fm={av}) -> settled"
        if av is not None and bv is not None:
            return None, f"3-WAY CONFLICT fm={av} 365={bv} third={tv} -> review"

    if av is not None and bv is not None:
        both = " (both match their own timeline)" if ca is True and cb is True else ""
        return None, f"fm={av} 365={bv} disagree{both} -> review"
    only = "fm" if av is not None else "365" if bv is not None else None
    if only:
        return None, f"only {only} reported it -> review (single-source)"
    return None, None


def _decide3(av, bv, tv) -> tuple[object, Optional[str]]:
    """Decide ONE card field from up to three independent readings.

    Returns (value, note). A field is settled only on agreement:
      * FotMob and 365Scores agree            -> that value (no tiebreak needed)
      * they differ, and the tiebreak source
        agrees with one of them               -> the agreed value
      * they differ and the tiebreak source
        agrees with neither / is missing      -> None (review)
      * only one source reported anything     -> None (never single-source cards)

    0 vs None is NOT a conflict: 365Scores omits zero-valued rows from a half
    filter, so a first half with no reds arrives as None while FotMob says 0 —
    treating that as a disagreement would send every HT card market to review.
    """
    if av is not None and bv is not None and av == bv:
        return av, None
    if tv is not None:
        if av is not None and av == tv:
            return av, f"TIEBREAK fm={av} == third={tv} (365={bv}) -> settled"
        if bv is not None and bv == tv:
            return bv, f"TIEBREAK 365={bv} == third={tv} (fm={av}) -> settled"
        if av is not None and bv is not None:
            return None, f"3-WAY CONFLICT fm={av} 365={bv} third={tv} -> review"
    if av is not None and bv is not None:
        return None, f"fm={av} 365={bv} disagree -> review"
    only = "fm" if av is not None else "365" if bv is not None else None
    if only:
        return None, f"only {only} reported it -> review (single-source)"
    return None, None


def reconcile(fm: dict, so: Optional[dict], require: set,
              tb: Optional[dict] = None,
              ev: Optional[dict] = None) -> tuple[dict, list[str]]:
    """Merge two independent readings of one match.

    `require` families must be confirmed by BOTH sources, else their numbers are
    sent as null so the markets go to review. Families not in `require` use the
    FotMob reading, but a mismatch is still reported — an unflagged silent
    disagreement is how a wrong payout passes unnoticed.

    `ev` carries each source's OWN event-timeline card counts ("fm"/"365"). It is
    the free tiebreak: a source whose summary row contradicts its own timeline is
    self-inconsistent and gets discarded, with no third party involved.

    `tb` is an optional THIRD reading (cards only) used to break a disagreement:
    if it sides with one source, that value is used; if it sides with neither,
    the field stays null. A third source never manufactures agreement — two
    sources that already agree are trusted as-is, so the extra request is only
    spent on a real conflict.
    """
    notes: list[str] = []
    out: dict = {
        "corners": {"ft": dict(NULL_PAIR), "ht": dict(NULL_PAIR)},
        "goals": {"ft": dict(NULL_PAIR), "ht": dict(NULL_PAIR)},
        "cards": {"ft": dict(NULL_CARDS), "ht": dict(NULL_CARDS)},
    }

    def note(msg: str) -> None:
        notes.append(msg)

    for fam in ("corners", "goals"):
        for bucket in ("ft", "ht"):
            a = (fm.get(fam) or {}).get(bucket) or {}
            b = ((so or {}).get(fam) or {}).get(bucket) or {}
            agreed = _agree_pair(a, b)
            if agreed:
                out[fam][bucket] = agreed
            elif fam in require:
                if a or b:
                    note(f"{fam}.{bucket} MISMATCH fm={a} 365={b} -> review")
            else:
                # not required to agree: use FotMob, but say so loudly
                if a.get("home") is not None:
                    out[fam][bucket] = {"home": a.get("home"), "away": a.get("away")}
                if b and (a != b):
                    note(f"{fam}.{bucket} differs (fm={a} 365={b}) — settled on fotmob")

    ev_fm = (ev or {}).get("fm")
    ev_365 = (ev or {}).get("365")
    for bucket in ("ft", "ht"):
        a = (fm.get("cards") or {}).get(bucket) or {}
        b = ((so or {}).get("cards") or {}).get(bucket) or {}
        t = ((tb or {}).get(bucket) or {}) if tb else {}
        ea = ((ev_fm or {}).get(bucket) or {}) if ev_fm else {}
        eb = ((ev_365 or {}).get(bucket) or {}) if ev_365 else {}
        if "cards" in require:
            merged: dict = {}
            for k in CARD_KEYS:
                value, why = _decide_card(k, a.get(k), b.get(k), ea.get(k), eb.get(k), t.get(k))
                merged[k] = value
                if why:
                    note(f"cards.{bucket} {k}: {why}")
            out["cards"][bucket] = merged
        else:
            if a.get("homeYellows") is not None:
                out["cards"][bucket] = {k: a.get(k) for k in CARD_KEYS}
            if b and a != b:
                note(f"cards.{bucket} differs (fm={a} 365={b}) — settled on fotmob")

    if so is None:
        note("365scores event not found/unreadable — every required family is null")
    return out, notes


def _as_pending(ev: dict) -> dict:
    """Reshape one source's event into the work-list shape match_event expects,
    so the SAME team-name matcher resolves across sources (no second matcher)."""
    return {
        "homeName": (ev.get("homeTeam") or {}).get("name", ""),
        "awayName": (ev.get("awayTeam") or {}).get("name", ""),
        "kickoff": datetime.fromtimestamp(int(ev["startTimestamp"]), tz=timezone.utc).isoformat(),
    }


class Tiebreaker:
    """A KEYLESS third opinion for disputed card fields.

    Uses the existing SofaScore scrape over the proxy pool. No API key means no
    account to get suspended mid-settlement — which is precisely why an
    API-keyed tiebreak source is the wrong tool here. It is consulted only for a
    fixture whose card fields actually conflict (rare), so the extra requests are
    a rounding error against a whole-day scrape.
    """

    def __init__(self, pool: ProxyPool, days: list):
        self.pool = pool
        self.days = days
        self.enabled = bool(pool.proxies)
        self.index: Optional[list[dict]] = None

    def _ensure_index(self) -> None:
        if self.index is not None:
            return
        idx: list[dict] = []
        for day in self.days:
            idx += find_finished_events(self.pool, day)
        self.index = idx
        log(f"tiebreak: sofa index {len(idx)} event(s)")

    def cards(self, pend: dict) -> Optional[dict]:
        """Third card reading ({ft:{...}, ht:{...}}) or None if unavailable."""
        if not self.enabled:
            return None
        self._ensure_index()
        ev = align_event(pend, self.index or [])
        if not ev:
            log("  tiebreak: no sofa event matched this fixture")
            return None
        incidents = fetch_json(self.pool, f"{SOFASCORE}/event/{ev['id']}/incidents",
                               f"tiebreak incidents {ev['id']}")
        if incidents is None:
            return None
        return extract_cards(incidents)


def cross_process(pool: ProxyPool, ev: dict, s365_ev: Optional[dict],
                  tiebreak: Optional["Tiebreaker"] = None) -> bool:
    """Scrape FotMob + 365Scores for one fixture, reconcile, then send."""
    fb = fotmob_page(pool, ev.get("id"))
    fm = fotmob_stats(fb) if fb else None
    if not fm:
        log(f"  cross {ev.get('id')}: fotmob page unusable — skipping (no partial send)")
        return False
    # s365_payload_stats returns None when the fixture has no usable stats, so
    # unpack defensively — a bare `so, ev = ...` raised TypeError and killed the
    # whole run the moment one fixture lacked stats.
    res = s365_payload_stats(pool, s365_ev["id"]) if s365_ev else None
    so, so_events = res if res else (None, None)
    ev_readings = {"fm": fotmob_card_events(fb), "365": so_events}
    stats, notes = reconcile(fm, so, CROSS_REQUIRE, ev=ev_readings)
    # Spend a third request ONLY on a genuine conflict. Single-source and
    # missing-fixture cases are not disagreements, and the work-list retry loop
    # already handles those — a tiebreak would add cost without adding certainty.
    if tiebreak is not None and any("disagree" in n for n in notes):
        third = tiebreak.cards(_as_pending(ev))
        if third:
            stats, notes = reconcile(fm, so, CROSS_REQUIRE, third, ev_readings)
        else:
            notes.append("disputed, but no third source available -> review")
    for n in notes:
        log(f"  CROSS-CHECK {ev.get('homeTeam', {}).get('name')} vs "
            f"{ev.get('awayTeam', {}).get('name')}: {n}")
    return _send(pool, ev, stats, "cross", f"{FOTMOB}/match/{ev.get('id')}")


def _send(pool: ProxyPool, ev: dict, stats: dict, source: str, url: str) -> bool:
    """Shared payload construction + POST for any source."""
    revision = hashlib.sha256(json.dumps(stats, sort_keys=True).encode()).hexdigest()[:12]
    payload = {
        "eventId": f"{source}-{ev.get('id')}-{revision}",
        "source": f"settle-worker-{source}",
        "match": {
            "externalId": str(ev.get("id")),
            "kickoff": datetime.fromtimestamp(int(ev["startTimestamp"]), tz=timezone.utc).isoformat(),
            "homeName": ev["homeTeam"]["name"],
            "awayName": ev["awayTeam"]["name"],
            "status": "FINISHED",
        },
        "stats": stats,
        "meta": {"scrapedAt": datetime.now(timezone.utc).isoformat(), "url": url},
    }
    ok, detail = post_payload(payload)
    label = f"{payload['match']['homeName']} vs {payload['match']['awayName']}"
    log(f"  {'OK  ' if ok else 'FAIL'} {label} corners FT {stats['corners']['ft']} "
        f"yellows FT {stats['cards']['ft'].get('homeYellows')}-{stats['cards']['ft'].get('awayYellows')} — {detail}")
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


def load_pending_file(path: str) -> list[dict]:
    """Read a work list from a file instead of the backend.

    Accepts either an exported /api/v1/settlement/pending payload
    ({ "games": [...] } or { "data": { "games": [...] } }) or a plain JSON array.
    Lets a shadow run measure the real thing against a saved list, with no
    webhook secret and no chance of touching a bet.
    """
    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, json.JSONDecodeError) as e:
        log(f"pending file {path}: unreadable ({type(e).__name__})")
        return []
    if isinstance(data, dict):
        entries = data.get("games")
        if entries is None and isinstance(data.get("data"), dict):
            entries = data["data"].get("games")
    else:
        entries = data
    out: list[dict] = []
    for e in entries or []:
        if not isinstance(e, dict):
            continue
        home = e.get("homeName") or e.get("home")
        away = e.get("awayName") or e.get("away")
        kick = e.get("kickoff") or e.get("startTime") or e.get("commence_time")
        if home and away and kick:
            out.append({"homeName": home, "awayName": away, "kickoff": kick,
                        "gameId": e.get("gameId")})
    log(f"pending file {path}: {len(out)} fixture(s)")
    return out


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


def align_score(a: str, b: str) -> float:
    """Name similarity for CROSS-SOURCE ALIGNMENT only — never for settlement.

    FotMob and 365Scores name one club differently: 'Marseille' vs 'Olympique de
    Marseille', 'Hobro' vs 'Hobro IK', 'Darmstadt' vs 'SV Darmstadt 98'. The
    settlement matcher (team_score) divides by the LONGER token set, so those
    land at 0.33-0.5 and fail its 0.6 bar. Alignment asks the different question:
    is the shorter name fully contained in the longer one? Dividing by min()
    makes that 1.0, while still refusing partial overlaps ('Manchester' alone)
    and genuinely different clubs ('Manchester United' vs 'Manchester City' = 0.5,
    'Austria Wien II' vs 'Austria Vienna Am' = 0.33).

    A wrong alignment can only ever produce a disagreement (-> review), never a
    wrong payout, because both sides of the fixture must still match.
    """
    xs, ys = set(normalize_team(a).split()), set(normalize_team(b).split())
    if not xs or not ys:
        return 0.0
    if xs == ys:
        return 1.0
    return len(xs & ys) / min(len(xs), len(ys))


ALIGN_MIN_SCORE = 1.0  # full containment of the shorter name


def align_event(pending: dict, events: list[dict]) -> Optional[dict]:
    """Find the same fixture in another source by names + kickoff.

    Same kickoff tolerance as match_event, but scored with align_score so
    abbreviated club names still resolve. Orientation (home/away swap) is
    tolerated, exactly like the settlement matcher.
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
        straight = min(align_score(home, want_home), align_score(away, want_away))
        swapped = min(align_score(home, want_away), align_score(away, want_home))
        score = max(straight, swapped)
        if score >= ALIGN_MIN_SCORE and score > best_score:
            best, best_score = ev, score
    return best


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
    ap.add_argument("--pending-file",
                    help="JSON work list to use instead of the backend (shadow runs / testing); "
                         "an exported /api/v1/settlement/pending response, or a plain array")
    ap.add_argument("--selftest", action="store_true",
                    help="run the parser/matching self-test offline and exit")
    ap.add_argument("--source", choices=("sofa", "fotmob", "365", "cross"), default=SOURCE,
                    help=f"upstream stats source (default: {SOURCE}; env SETTLE_SOURCE). "
                         f"'365' = 365Scores (keyless); 'cross' = fotmob + 365Scores agreement")
    args = ap.parse_args()

    if args.selftest:
        return selftest()

    global DRY_RUN
    if args.dry_run:
        DRY_RUN = True

    log(f"settlement worker start (source={args.source}, dry_run={DRY_RUN}, age>{MATCH_AGE_MINUTES}min)")
    pool = ProxyPool.from_env()
    if args.source in ("fotmob", "365", "cross"):
        # These read keyless, datacentre-reachable endpoints. Healthchecking
        # exits against a SofaScore URL would only burn them for nothing.
        log(f"source={args.source}: no key and no proxy required"
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
    if args.source == "fotmob":
        day_events, process = fotmob_day_events, fotmob_process
    elif args.source == "365":
        day_events, process = s365_day_events, s365_process
    elif args.source == "cross":
        # FotMob drives discovery (best coverage); 365Scores is the second opinion.
        day_events, process = fotmob_day_events, None
    else:
        day_events, process = find_finished_events, process_event

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
        pending = load_pending_file(args.pending_file) if args.pending_file else fetch_pending(pool)
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

    tiebreak: Optional[Tiebreaker] = None
    s365_index: list[dict] = []
    if args.source == "cross":
        seen365: set = set()
        for day in days:
            for ev in s365_day_events(pool, day):
                if ev.get("id") in seen365:
                    continue
                seen365.add(ev.get("id"))
                s365_index.append(ev)
        log(f"cross-check index: {len(s365_index)} 365scores event(s)")
        tiebreak = Tiebreaker(pool, days)
        if tiebreak.enabled:
            log("tiebreak: sofa (keyless) enabled for disputed card fields")
        else:
            log("tiebreak: no proxy pool configured — disputed cards go to review")

    sent = 0
    for ev in targets:
        if args.source == "cross":
            ok = cross_process(pool, ev, align_event(_as_pending(ev), s365_index), tiebreak)
        else:
            ok = process(pool, ev)
        if ok:
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

    # 8. 365Scores parsing. The fixture mirrors the live response for
    #    Sport Recife 2-0 Ponte Preta (2026-09-11) — and the competitors list is
    #    deliberately in the WRONG order, so a home/away mix-up fails the test
    #    instead of settling the wrong side.
    s365_ft = {
        "games": [{
            "homeCompetitor": {"id": 1226, "name": "Sport Recife", "score": 2.0},
            "awayCompetitor": {"id": 1266, "name": "Ponte Preta", "score": 0.0},
            "statusText": "Ended", "statusGroup": 4,
        }],
        "competitors": [{"id": 1266, "name": "Ponte Preta"}, {"id": 1226, "name": "Sport Recife"}],
        "statistics": [
            {"name": "Corners", "competitorId": 1226, "value": "7"},
            {"name": "Corners", "competitorId": 1266, "value": "3"},
            {"name": "Yellow Cards", "competitorId": 1226, "value": "2"},
            {"name": "Yellow Cards", "competitorId": 1266, "value": "2"},
            {"name": "Red Cards", "competitorId": 1226, "value": "0"},
            {"name": "Red Cards", "competitorId": 1266, "value": "0"},
        ],
    }
    rows365 = _s365_rows(s365_ft)
    check("365 corners keyed by competitor id, not list order", _s365_side(rows365, "Corners"), (7, 3))
    check("365 yellows", _s365_side(rows365, "Yellow Cards"), (2, 2))
    # A stat row for a competitor not in this fixture must be ignored, not
    # attributed to the wrong side (the BigBallsData contamination lesson).
    dirty = dict(s365_ft)
    dirty["statistics"] = s365_ft["statistics"] + [{"name": "Corners", "competitorId": 999, "value": "9"}]
    check("365 ignores foreign competitor rows", _s365_side(_s365_rows(dirty), "Corners"), (7, 3))

    # Goals: FT from the score, HT only when the timeline reconciles.
    detail_ok = {"game": {
        "homeCompetitor": {"id": 1226}, "awayCompetitor": {"id": 1266},
        "events": [
            {"eventType": {"name": "Goal"}, "gameTime": 25, "competitorId": 1226},
            {"eventType": {"name": "Goal"}, "gameTime": 60, "competitorId": 1226},
            {"eventType": {"name": "Yellow Card"}, "gameTime": 30, "competitorId": 1266},
        ],
    }}
    g365 = _s365_goals(detail_ok, s365_ft["games"][0])
    check("365 goals ft", g365["ft"], {"home": 2, "away": 0})
    check("365 goals ht", g365["ht"], {"home": 1, "away": 0})
    detail_bad = {"game": {"homeCompetitor": {"id": 1226}, "awayCompetitor": {"id": 1266},
                           "events": [{"eventType": {"name": "Goal"}, "gameTime": 25, "competitorId": 1226}]}}
    check("365 ht goals null when the timeline does not reconcile",
          _s365_goals(detail_bad, s365_ft["games"][0])["ht"], {"home": None, "away": None})

    # 9. Cross-check reconciliation. Cards are in `require`, so a disagreement
    #    must null the family (review) rather than pick a side; corners are not
    #    required to agree but a difference must be reported.
    fm_read = {
        "corners": {"ft": {"home": 7, "away": 3}, "ht": {"home": None, "away": None}},
        "goals": {"ft": {"home": 2, "away": 0}, "ht": {"home": 1, "away": 0}},
        "cards": {"ft": {"homeYellows": 2, "awayYellows": 2, "homeReds": 0, "awayReds": 0},
                  "ht": {"homeYellows": None, "awayYellows": None, "homeReds": None, "awayReds": None}},
    }
    s365_read = json.loads(json.dumps(fm_read))
    s365_read["cards"]["ft"]["homeYellows"] = 3          # genuine card disagreement
    s365_read["corners"]["ft"]["away"] = 4               # corners differ (not required)
    out, notes = reconcile(fm_read, s365_read, {"cards"})
    check("reconcile: agreed corners pass through", out["corners"]["ft"], {"home": 7, "away": 3})
    check("reconcile: agreed goals pass through", out["goals"]["ft"], {"home": 2, "away": 0})
    check("reconcile: a disputed card field is nulled, the agreed ones kept",
          out["cards"]["ft"], {"homeYellows": None, "awayYellows": 2, "homeReds": 0, "awayReds": 0})
    check("reconcile: card disagreement is reported", any("disagree" in n for n in notes), True)

    # 365Scores omits zero rows from a half filter, so 0-vs-None must NOT be read
    # as a disagreement — that would send every HT card market to review for nothing.
    fm_zero = json.loads(json.dumps(fm_read))
    fm_zero["cards"]["ht"] = {"homeYellows": 1, "awayYellows": 0, "homeReds": 0, "awayReds": 0}
    so_sparse = json.loads(json.dumps(fm_zero))
    so_sparse["cards"]["ht"]["homeReds"] = None
    so_sparse["cards"]["ht"]["awayReds"] = None
    z, _zn = reconcile(fm_zero, so_sparse, {"cards"})
    check("reconcile: HT yellows survive 365 omitting zero reds",
          [z["cards"]["ht"]["homeYellows"], z["cards"]["ht"]["awayYellows"]], [1, 0])
    check("reconcile: unreported HT reds are null, not 0",
          [z["cards"]["ht"]["homeReds"], z["cards"]["ht"]["awayReds"]], [None, None])

    # 10. Cross-source alignment: abbreviated club names must still resolve, but
    #     partial overlaps and genuine rivals must NOT.
    check("align: Marseille vs Olympique de Marseille",
          align_score("Olympique de Marseille", "Marseille"), 1.0)
    check("align: Hobro vs Hobro IK", align_score("Hobro IK", "Hobro"), 1.0)
    check("align: Darmstadt vs SV Darmstadt 98", align_score("SV Darmstadt 98", "Darmstadt"), 1.0)
    check("align: Hacken vs BK Hacken", align_score("BK Häcken", "Häcken"), 1.0)
    if align_score("Manchester United", "Manchester City") >= ALIGN_MIN_SCORE:
        failures.append("align matched Manchester United vs Manchester City")
    if align_score("Austria Wien II", "Austria Vienna Am") >= ALIGN_MIN_SCORE:
        failures.append("align matched a reserve team to the wrong reserve team")

    # 11. Three-way card decision: a third reading may break a tie, but never
    #     manufacture agreement, and a 3-way conflict must stay in review.
    # 12. Event-derived card counts + the free self-consistency tiebreak.
    fm_card_pp = {"content": {"matchFacts": {"events": {"events": [
        {"type": "Card", "card": "Yellow", "time": 45, "isHome": True},
        {"type": "Card", "card": "Yellow", "time": 74, "isHome": True},
        {"type": "Card", "card": "Yellow", "time": 79, "isHome": True},
        {"type": "Card", "card": "Yellow", "time": 90, "isHome": False},
        {"type": "Goal", "time": 20, "isHome": True},
    ]}}}}
    fce = fotmob_card_events(fm_card_pp)
    check("fotmob card events: ft", [fce["ft"]["homeYellows"], fce["ft"]["awayYellows"]], [3, 1])
    check("fotmob card events: ht split", [fce["ht"]["homeYellows"], fce["ht"]["awayYellows"]], [1, 0])
    check("fotmob card events: no timeline -> None", fotmob_card_events({"content": {}}), None)
    ty = fotmob_card_events({"content": {"matchFacts": {"events": {"events": [
        {"type": "Card", "card": "YellowRed", "time": 80, "isHome": True}]}}}})
    check("fotmob second yellow counts as a red", ty["ft"]["homeReds"], 1)

    sce = s365_card_events({"game": {"homeCompetitor": {"id": 1}, "awayCompetitor": {"id": 2}, "events": [
        {"eventType": {"name": "Yellow Card"}, "gameTime": 24, "competitorId": 1},
        {"eventType": {"name": "Yellow Card"}, "gameTime": 57, "competitorId": 2},
        {"eventType": {"name": "Red Card"}, "gameTime": 70, "competitorId": 2},
    ]}})
    check("365 card events: ft", [sce["ft"]["homeYellows"], sce["ft"]["awayYellows"], sce["ft"]["awayReds"]], [1, 1, 1])
    check("365 card events: ht split", [sce["ht"]["homeYellows"], sce["ht"]["awayYellows"]], [1, 0])
    check("365 card events: no timeline -> None", s365_card_events({"game": {}}), None)

    # The free tiebreak: fm says 2, 365 says 1; 365's own timeline backs 1 while
    # fm published none -> 365 wins, with no third party and no extra request.
    val, why = _decide_card("awayYellows", 2, 1, None, 1, None)
    check("self-check: the corroborated source wins", val, 1)
    check("self-check: the reason is named", "SELF-CHECK" in why, True)
    # Both corroborated but still disagreeing -> honest review, never a coin flip.
    check("self-check: both corroborated -> review",
          _decide_card("awayYellows", 2, 1, 2, 1, None)[0], None)
    # A source contradicted by its own timeline loses to a clean one.
    check("self-check: self-contradicting source loses",
          _decide_card("awayYellows", 9, 1, 2, 1, None)[0], 1)
    check("self-check: agreement still short-circuits",
          _decide_card("awayYellows", 2, 2, 1, 1, None), (2, None))

    check("decide3: agreement wins, tiebreak ignored", _decide3(2, 2, 1)[0], 2)
    check("decide3: tiebreak sides with fotmob", _decide3(2, 1, 2), (2, "TIEBREAK fm=2 == third=2 (365=1) -> settled"))
    check("decide3: tiebreak sides with 365", _decide3(2, 1, 1)[0], 1)
    check("decide3: 3-way conflict -> review", _decide3(2, 1, 3)[0], None)
    check("decide3: 3-way conflict is named", "3-WAY CONFLICT" in _decide3(2, 1, 3)[1], True)
    check("decide3: plain disagreement -> review", _decide3(2, 1, None)[0], None)
    check("decide3: only one source -> review", _decide3(2, None, None)[0], None)
    check("decide3: a real 0 is still single-source", "single-source" in _decide3(0, None, None)[1], True)
    check("decide3: neither reported -> silent", _decide3(None, None, None), (None, None))

    tb_read = {"ft": {"homeYellows": 2, "awayYellows": 2, "homeReds": 0, "awayReds": 0},
               "ht": {"homeYellows": None, "awayYellows": None, "homeReds": None, "awayReds": None}}
    tb_out, tb_notes = reconcile(fm_read, s365_read, {"cards"}, tb_read)
    check("reconcile+tiebreak: disputed field settles when a third source agrees",
          tb_out["cards"]["ft"]["homeYellows"], 2)
    check("reconcile+tiebreak: the tiebreak is reported",
          any("TIEBREAK" in n for n in tb_notes), True)
    bad_tb = {"ft": {"homeYellows": 0, "awayYellows": 0, "homeReds": 0, "awayReds": 0}}
    bad_out, bad_notes = reconcile(fm_read, s365_read, {"cards"}, bad_tb)
    check("reconcile+tiebreak: 3-way conflict stays null",
          bad_out["cards"]["ft"]["homeYellows"], None)

    check("reconcile: missing second source is reported",
          any("not found/unreadable" in n for n in reconcile(fm_read, None, {"cards"})[1]), True)
    agree_out, _ = reconcile(fm_read, json.loads(json.dumps(fm_read)), {"cards"})
    check("reconcile: identical sources settle cards",
          agree_out["cards"]["ft"], {"homeYellows": 2, "awayYellows": 2, "homeReds": 0, "awayReds": 0})

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
