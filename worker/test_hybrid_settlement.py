#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
test_hybrid_settlement.py — BigBallsData + TotalCorner merged settlement probe
==============================================================================

Builds the settlement payload for a day's finished fixtures from two APIs:

  * BigBallsData  -> goals (FT + HT), cards, match completion
  * TotalCorner   -> corners (FT + HT), plus goals/cards as a cross-check

This is a STANDALONE TEST SCRIPT. It does not touch the database, does not
settle bets, and does not import the Next.js app. Run it, read
``test_result.json``, and decide whether the merged numbers hold up.

Why stdlib only (urllib, not requests/httpx)
--------------------------------------------
Same reason as ``settle_worker.py``: the target host is cPanel, where there is
no reliable ``pip install`` and no virtualenv. Both scripts must run with a bare
``python3``. If you ever move this to Railway (where deps are installable),
swapping ``_http_json`` for ``requests`` is a 10-line change.

Usage
-----
    export BIGBALLSDATA_KEY=bbs_...
    export TOTALCORNER_TOKEN=...
    python3 worker/test_hybrid_settlement.py                      # today
    python3 worker/test_hybrid_settlement.py --date 2026-09-11
    python3 worker/test_hybrid_settlement.py --limit 5 --verbose
    python3 worker/test_hybrid_settlement.py --no-totalcorner      # BigBallsData only
    python3 worker/test_hybrid_settlement.py --selftest            # no network, no keys

Notes for whoever picks this up
-------------------------------
* ``test_*.py`` is a pytest-collectable name. There is no pytest in this repo
  today (the JS suite is vitest), but if one is ever added, rename this file or
  pytest will try to import it during CI.
* Secrets are read from the environment ONLY. Nothing is written to disk, and
  the key is never echoed into logs or into ``test_result.json``.
"""

from __future__ import annotations

import argparse
import difflib
import json
import os
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

BB_BASE = "https://api.bigballsdata.com/v1"
TC_BASE = "https://api.totalcorner.com/v1"

# TotalCorner documents 30 requests/minute, but the figure that matters is the
# one in the response header: an unentitled token advertises 5. The client reads
# X-Rate-Limit-Limit on the first response and throttles to the real value.
TC_MIN_INTERVAL = 2.05          # starting guess (=30/min) until a header says otherwise
TC_NAME_THRESHOLD = 0.72        # min name similarity to accept a fixture
TC_AMBIGUITY_MARGIN = 0.03      # if top two are this close, refuse to merge
TC_MAX_KICKOFF_DELTA_H = 6      # TotalCorner `start` has no timezone: stay generous

# TotalCorner `status` is a NUMERIC CODE and the docs do not publish the map.
# "79" is the value seen on the documented finished sample. Anything else is
# reported as-is rather than guessed at, and a match only counts as finished if
# the code is known OR the clock says so. VERIFY THIS against a live token.
TC_FINISHED_STATUS = {"79"}


def log(level: str, msg: str) -> None:
    print(f"[{level:<5}] {msg}", file=sys.stderr)


# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------

def _http_json(url: str, headers: dict | None = None, timeout: int = 25,
               retries: int = 2) -> tuple[int, dict | None, dict]:
    """GET -> (status, parsed_json_or_None, response_headers). Never raises on HTTP."""
    last_err = None
    for attempt in range(retries + 1):
        req = urllib.request.Request(url, headers=headers or {})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                raw = r.read().decode("utf-8", "replace")
                hdrs = {k.lower(): v for k, v in r.headers.items()}
                try:
                    return r.status, json.loads(raw), hdrs
                except json.JSONDecodeError:
                    log("WARN", f"non-JSON response from {url.split('?')[0]}: {raw[:120]!r}")
                    return r.status, None, hdrs
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", "replace")[:200]
            hdrs = {k.lower(): v for k, v in (e.headers or {}).items()}
            last_err = f"HTTP {e.code}: {body}"
            # 4xx other than 429 will not fix themselves — do not retry.
            if e.code != 429 and 400 <= e.code < 500:
                return e.code, None, hdrs
            if e.code == 429:
                wait = float(hdrs.get("retry-after") or 0) or (attempt + 1) * 3
                log("WARN", f"429 from {url.split('?')[0]} — backing off {wait:.0f}s")
                time.sleep(wait)
                continue
        except Exception as e:  # noqa: BLE001 - DNS/timeout/TLS all land here
            last_err = f"{type(e).__name__}: {e}"
        time.sleep(1.5 * (attempt + 1))
    log("WARN", f"giving up on {url.split('?')[0]} after {retries + 1} tries ({last_err})")
    return 0, None, {}


# ---------------------------------------------------------------------------
# Name matching
# ---------------------------------------------------------------------------

# Club-type noise. Dropped so "1. FC Union Berlin" and "Union Berlin" collapse.
_NOISE = {
    "fc", "cf", "sc", "ac", "afc", "cfc", "cd", "ud", "rc", "sv", "vfl", "vfb",
    "tsg", "bsc", "fsv", "ss", "ssc", "us", "as", "sl", "cs", "ca", "ec", "se",
    "club", "de", "the", "if", "sk", "fk", "bk", "ic", "kf", "nk", "hk", "mc",
}


def normalize_name(name: str) -> str:
    """Accent-fold, lowercase, strip punctuation and club-type noise."""
    if not name:
        return ""
    s = unicodedata.normalize("NFKD", name)
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r"[^a-z0-9 ]+", " ", s.lower())
    toks = [t for t in s.split() if t and t not in _NOISE]
    # Leading bare numbers are league-position noise ("1. FC Union Berlin",
    # "1899 Hoffenheim"), never the club's identity. Trailing ones are kept:
    # "Schalke 04" is genuinely distinguished by the 04 on some feeds.
    while toks and toks[0].isdigit():
        toks.pop(0)
    return " ".join(toks) or s.strip()


def name_similarity(a: str, b: str, aliases: dict | None = None) -> float:
    """Blend of token-set overlap and character ratio, in [0, 1].

    Deliberately CONSERVATIVE: it is tuned to miss rather than to mis-merge.
    A missed fixture costs the operator one manual review; a wrong fixture
    settles the wrong bet. Those costs are not symmetric, so the matcher is not
    either.

    The rule that carries the weight is the "both sides distinguish" guard.
    Clubs share cities, so a shared first token means almost nothing:
    "manchester united" vs "manchester city" share "manchester"; "inter milan"
    vs "milan" share "milan". When each name owns a token the other lacks, that
    is treated as evidence of DIFFERENT clubs and the score is capped, whatever
    the character ratio says.
    """
    na, nb = normalize_name(a), normalize_name(b)
    if not na or not nb:
        return 0.0
    if na == nb:
        return 1.0
    if aliases and _alias_hit(na, nb, aliases):
        return 1.0

    ratio = difflib.SequenceMatcher(None, na, nb).ratio()
    ta, tb = set(na.split()), set(nb.split())
    jac = len(ta & tb) / len(ta | tb) if (ta | tb) else 0.0
    base = 0.6 * jac + 0.4 * ratio

    only_a, only_b = ta - tb, tb - ta
    if only_a and only_b:
        # Each side carries a distinguishing token -> assume different clubs.
        base = min(base, 0.45)
    elif only_a or only_b:
        # One side is a strict subset. Only forgive the difference when the
        # extra tokens look like a suffix ("schalke 04" vs "schalke",
        # "koln" vs "1. fc koln"). An extra WORD is a different club
        # ("milan" vs "inter milan"), so it gets no bonus.
        extra = only_a or only_b
        if all(t.isdigit() or len(t) <= 2 for t in extra):
            base = max(base, 0.85)
    return base


def _alias_hit(na: str, nb: str, aliases: dict) -> bool:
    """Operator-confirmed mappings: {"bigballs name": ["totalcorner name", ...]}.

    Keys and values are normalized here rather than at load time, so an aliases
    file written the way a human reads it ("Bayern Munich") still works.
    """
    for key, wants in aliases.items():
        if not isinstance(wants, (list, tuple, set)):
            wants = [wants]
        k = normalize_name(str(key))
        vals = [normalize_name(str(w)) for w in wants]
        if k == na and nb in vals:
            return True
        if k == nb and na in vals:
            return True
    return False


def fixture_similarity(home_a: str, away_a: str, home_b: str, away_b: str,
                       aliases: dict | None = None) -> float:
    """Score a whole fixture, keeping home/away orientation meaningful."""
    straight = (name_similarity(home_a, home_b, aliases)
                + name_similarity(away_a, away_b, aliases)) / 2
    flipped = (name_similarity(home_a, away_b, aliases)
               + name_similarity(away_a, home_b, aliases)) / 2
    # A flipped match is possible when a feed disagrees on venue, so allow it
    # but dock it slightly — flag rather than merge wrong.
    return max(straight, flipped * 0.97)


# ---------------------------------------------------------------------------
# BigBallsData
# ---------------------------------------------------------------------------

class BigBallsSource:
    """Goals (FT + HT) via the match object, cards via team_id-filtered players."""

    def __init__(self, key: str, timeout: int = 25):
        self.key = key
        self.timeout = timeout
        self.calls = 0

    def _get(self, path: str) -> dict | None:
        url = f"{BB_BASE}{path}"
        self.calls += 1
        status, body, hdrs = _http_json(url, {"Authorization": f"Bearer {self.key}"}, self.timeout)
        if status != 200 or not isinstance(body, dict):
            log("WARN", f"bigballs {path.split('?')[0]} -> HTTP {status}")
            return None
        remaining = hdrs.get("x-ratelimit-remaining")
        if remaining is not None and remaining.isdigit() and int(remaining) < 10:
            log("WARN", f"bigballs rate limit low: {remaining} left this minute")
        if body.get("error"):
            log("WARN", f"bigballs error envelope: {str(body['error'])[:160]}")
            return None
        return body

    def finished_matches(self, date: str | None, limit: int) -> list[dict]:
        q = {"sport": "football", "status": "finished", "limit": str(limit)}
        if date:
            q["date"] = date
        body = self._get("/matches?" + urllib.parse.urlencode(q))
        data = (body or {}).get("data") or []
        return data if isinstance(data, list) else []

    def stat_rows(self, match_id: str) -> dict:
        """Return {'players': [...], 'team_stats': [...]} — never raises."""
        body = self._get(f"/stored/matches/{match_id}/stats")
        data = (body or {}).get("data") or {}
        return {
            "players": data.get("players") or [],
            "team_stats": data.get("team_stats") or [],
        }

    def events(self, match_id: str) -> list[dict]:
        body = self._get(f"/matches/{match_id}/events?sport=football")
        data = (body or {}).get("data")
        return [e for e in data if isinstance(e, dict)] if isinstance(data, list) else []

    # -- parsing ----------------------------------------------------------

    @staticmethod
    def _linescore(match: dict) -> dict:
        """Half-time + full-time goals.

        `linescore` is PER-PERIOD, not cumulative — proven on Venezia 2-4
        Fiorentina (goals 22/29/30 and 66/84/86 -> home [1,1] away [2,2];
        cumulative would have read [1,2]/[2,4]). So index 0 IS half time.
        """
        ls = match.get("linescore") or {}
        def series(side: str) -> list:
            v = ls.get(side)
            if isinstance(v, dict):          # tolerate {"1": x, "2": y}
                v = [v.get(k) for k in sorted(v, key=lambda k: str(k))]
            return v if isinstance(v, list) else []
        h, a = series("home"), series("away")
        score = match.get("score") or {}
        ft = {"home": _int(score.get("home")), "away": _int(score.get("away"))}
        ht = None
        if h and a and h[0] is not None and a[0] is not None:
            ht = {"home": _int(h[0]), "away": _int(a[0])}
        return {"HT": ht, "FT": ft}

    @staticmethod
    def cards_from_players(players: list[dict], home_id: str, away_id: str) -> dict | None:
        """Sum yellow/red over players FILTERED BY team_id.

        The players[] array is NOT match-scoped: a Bundesliga match carried rows
        for Pisa and Wolverhampton, plus two rows with team_id = null — and one
        of those nulls held a yellow card. Summing it unfiltered silently adds
        bookings from players who were never on the pitch. Filter by team_id,
        never by team_name (names differ per endpoint: "Stade Rennais" vs
        "Rennes").
        """
        if not players or not home_id or not away_id:
            return None
        out = {"yellow_cards": {"home": 0, "away": 0}, "red_cards": {"home": 0, "away": 0}}
        seen = False
        for p in players:
            tid = p.get("team_id")
            if tid not in (home_id, away_id):
                continue
            seen = True
            side = "home" if tid == home_id else "away"
            stats = p.get("stats") or {}
            for metric, bucket in (("yellow_cards", "yellow_cards"), ("red_cards", "red_cards")):
                val = _int((stats.get(metric) or {}).get("value"))
                out[bucket][side] += val or 0
        return out if seen else None


def _int(v) -> int | None:
    """APIs return numbers, numeric strings, or None. Never guess at empty."""
    if v is None or v == "":
        return None
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None


# ---------------------------------------------------------------------------
# TotalCorner
# ---------------------------------------------------------------------------

class TotalCornerSource:
    """Corners (FT + HT) plus goals/cards, for cross-checking BigBallsData.

    Documented field names (https://www.totalcorner.com/page/api):
        hc / ac      home / away corners (FT)
        hf_hc / hf_ac  half-time corners
        hg / ag      goals,  hf_hg / hf_ag half-time goals
        hyc / ayc    yellow cards,  hrc / arc  red cards
        h / a        team names,  h_id / a_id  team ids
        start        kickoff,  status  numeric code
    All values arrive as STRINGS.
    """

    def __init__(self, token: str, timeout: int = 25):
        self.token = token
        self.timeout = timeout
        self.calls = 0
        self._last_call = 0.0
        self.blocked = False       # set once the token is rejected — stop trying
        # The docs advertise 30 requests/minute, but the advertised figure is
        # for entitled accounts: a token without VIP returns
        # `X-Rate-Limit-Limit: 5`. Start at the documented value and correct
        # from the response header on the first call.
        self.min_interval = TC_MIN_INTERVAL

    def _throttle(self) -> None:
        gap = time.monotonic() - self._last_call
        if gap < self.min_interval:
            time.sleep(self.min_interval - gap)
        self._last_call = time.monotonic()

    def _observe_rate_limit(self, hdrs: dict) -> None:
        """Self-throttle from the account's OWN limit, not the documented one."""
        limit = (hdrs or {}).get("x-rate-limit-limit")
        if limit and str(limit).isdigit() and int(limit) > 0:
            self.min_interval = max(60.0 / int(limit), 0.5)
        rem = (hdrs or {}).get("x-rate-limit-remaining")
        if rem is not None and str(rem).isdigit() and int(rem) <= 1:
            log("WARN", f"totalcorner: {rem} request(s) left in this window "
                        f"(limit {limit or '?'}/min)")

    def _get(self, path: str, params: dict) -> tuple[dict | None, str | None]:
        """Return (data, error_code). TotalCorner wraps payloads in
        {"success": 1, "data": ...} or {"success": 0, "error": {code, message}}."""
        if self.blocked:
            return None, "BLOCKED"
        params = {"token": self.token, **params}
        url = f"{TC_BASE}{path}?{urllib.parse.urlencode(params)}"
        self._throttle()
        self.calls += 1
        status, body, hdrs = _http_json(url, {"Accept": "application/json"}, self.timeout)
        self._observe_rate_limit(hdrs)

        if status == 429:
            return None, "TOO_MANY_REQUEST"
        if not isinstance(body, dict):
            return None, f"HTTP_{status}"

        if str(body.get("success")) in ("0", "False", "false"):
            err = body.get("error") or {}
            code = err.get("code") or "UNKNOWN"
            msg = err.get("message") or ""
            # These do not fix themselves; stop hammering the endpoint.
            if code == "NO_PERMISSION":
                self.blocked = True
                log("WARN", "totalcorner: this token is NOT a VIP member. The API is a VIP "
                            "privilege (https://www.totalcorner.com/membership), so every "
                            "endpoint returns NO_PERMISSION. Corners will be null.")
                return None, code
            if code == "TOKEN_ERROR":
                self.blocked = True
                log("WARN", f"totalcorner: token rejected ({msg}) — check the user centre "
                            f"at https://www.totalcorner.com")
                return None, code
            if code == "TOO_MANY_REQUEST":
                # Recoverable: wait out the window rather than disabling the source.
                reset = hdrs.get("x-rate-limit-reset")
                wait = float(reset) if (reset and str(reset).replace(".", "").isdigit()) else self.min_interval
                wait = max(1.0, min(wait, 60.0))
                log("WARN", f"totalcorner rate limited — waiting {wait:.0f}s "
                            f"(limit {hdrs.get('x-rate-limit-limit', '?')}/min)")
                time.sleep(wait)
                return None, code
            log("WARN", f"totalcorner {path.split('/')[1]} -> {code}: {msg}")
            return None, code
        data = body.get("data")
        return (data if isinstance(data, list) else [data]) if data is not None else [], None

    def schedule(self, date: str) -> tuple[list[dict], str | None]:
        data, err = self._get("/match/schedule", {
            "date": date,
            "columns": "events",
            "page": "1",
        })
        return (data or []), err

    def match_view(self, match_id: str) -> tuple[dict | None, str | None]:
        data, err = self._get(f"/match/view/{match_id}", {"columns": "events"})
        if not data:
            return None, err
        return (data[0] if isinstance(data, list) else data), err

    @staticmethod
    def parse(m: dict) -> dict:
        hc, ac = _int(m.get("hc")), _int(m.get("ac"))
        corners_ft = None
        if hc is not None and ac is not None:
            corners_ft = {"home": hc, "away": ac, "total": hc + ac}
        hfh, hfa = _int(m.get("hf_hc")), _int(m.get("hf_ac"))
        corners_ht = None
        if hfh is not None and hfa is not None:
            corners_ht = {"home": hfh, "away": hfa, "total": hfh + hfa}
        return {
            "id": str(m.get("id") or ""),
            "home": m.get("h") or "",
            "away": m.get("a") or "",
            "home_id": str(m.get("h_id") or ""),
            "away_id": str(m.get("a_id") or ""),
            "league": m.get("l") or "",
            "start": m.get("start") or "",
            "status": str(m.get("status") or ""),
            "corners": {"FT": corners_ft, "HT": corners_ht},
            "goals": {"HT": _pair(m.get("hf_hg"), m.get("hf_ag")),
                      "FT": _pair(m.get("hg"), m.get("ag"))},
            "yellow_cards": _pair(m.get("hyc"), m.get("ayc")),
            "red_cards": _pair(m.get("hrc"), m.get("arc")),
        }


def _pair(h, a) -> dict | None:
    hi, ai = _int(h), _int(a)
    if hi is None or ai is None:
        return None
    return {"home": hi, "away": ai}


def _parse_tc_start(s: str) -> datetime | None:
    """TotalCorner's `start` carries NO timezone. Parse it as UTC-with-caveat:
    the absolute offset is unknown, so kickoff is only ever used as a soft
    signal, never as the sole basis for a match."""
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M"):
        try:
            return datetime.strptime(s, fmt).replace(tzinfo=timezone.utc)
        except (ValueError, TypeError):
            continue
    return None


# ---------------------------------------------------------------------------
# Merge
# ---------------------------------------------------------------------------

def pick_totalcorner_match(bb: dict, tc_rows: list[dict], verbose: bool = False,
                           aliases: dict | None = None):
    """Best TotalCorner fixture for a BigBallsData match, or (None, reason)."""
    home, away = bb["home"]["name"], bb["away"]["name"]
    bb_kick = _parse_iso(bb.get("kickoff_utc"))
    scored = []
    for row in tc_rows:
        parsed = TotalCornerSource.parse(row)
        if not parsed["home"] or not parsed["away"]:
            continue
        sim = fixture_similarity(home, away, parsed["home"], parsed["away"], aliases)
        delta_h = None
        tc_kick = _parse_tc_start(parsed["start"])
        if bb_kick and tc_kick:
            delta_h = abs((bb_kick - tc_kick).total_seconds()) / 3600.0
        score = sim
        if delta_h is not None and delta_h > TC_MAX_KICKOFF_DELTA_H:
            score *= 0.5                       # wrong day / wrong fixture
        elif delta_h is not None:
            score = min(1.0, score + 0.05)     # mild corroboration
        scored.append((score, sim, delta_h, parsed))

    if not scored:
        return None, "no TotalCorner fixtures for that date"
    scored.sort(key=lambda t: t[0], reverse=True)
    if verbose:
        for s, sim, d, p in scored[:3]:
            print(f"      candidate {p['home']} vs {p['away']:<28} "
                  f"score={s:.3f} name={sim:.3f} kick_delta={'-' if d is None else f'{d:.1f}h'}")
    best, bsim, bdelta, bparsed = scored[0]
    if bsim < TC_NAME_THRESHOLD:
        return None, f"no fixture above threshold (best {bsim:.2f})"
    if len(scored) > 1 and scored[1][0] >= best - TC_AMBIGUITY_MARGIN:
        return None, (f"ambiguous — top two within {TC_AMBIGUITY_MARGIN}: "
                      f"{bparsed['home']} vs {scored[1][3]['home']}")
    return bparsed, None


def build_payload(bb: dict, bb_stats: dict, tc: dict | None, include_ht_corners: bool) -> dict:
    scores = BigBallsSource._linescore(bb)
    home_id = (bb.get("home") or {}).get("id")
    away_id = (bb.get("away") or {}).get("id")
    cards = BigBallsSource.cards_from_players(bb_stats.get("players") or [], home_id, away_id)

    corners_block = None
    if tc and tc.get("corners", {}).get("FT"):
        corners_block = {"FT": tc["corners"]["FT"]}
        if include_ht_corners and tc["corners"].get("HT"):
            corners_block["HT"] = tc["corners"]["HT"]

    return {
        "event_id": f"bb_{bb.get('id')}",
        "totalcorner_id": f"tc_{tc['id']}" if tc and tc.get("id") else None,
        "match_status": "FT",
        "home_team": (bb.get("home") or {}).get("name") or "",
        "away_team": (bb.get("away") or {}).get("name") or "",
        "scores": scores,
        "cards": cards,
        "corners": corners_block,
    }


def cross_check(payload: dict, tc: dict | None) -> list[str]:
    """Compare the two sources. Disagreement is the signal worth watching."""
    notes: list[str] = []
    if not tc:
        return notes
    ft, ht = payload["scores"]["FT"], payload["scores"]["HT"]
    if tc.get("goals", {}).get("FT") and ft != tc["goals"]["FT"]:
        notes.append(f"FT goals differ: bigballs {ft} vs totalcorner {tc['goals']['FT']}")
    if tc.get("goals", {}).get("HT") and ht != tc["goals"]["HT"]:
        notes.append(f"HT goals differ: bigballs {ht} vs totalcorner {tc['goals']['HT']}")
    cards = payload.get("cards")
    if cards and tc.get("yellow_cards") and cards["yellow_cards"] != tc["yellow_cards"]:
        notes.append(f"yellow cards differ: bigballs {cards['yellow_cards']} "
                     f"vs totalcorner {tc['yellow_cards']}")
    if cards and tc.get("red_cards") and cards["red_cards"] != tc["red_cards"]:
        notes.append(f"red cards differ: bigballs {cards['red_cards']} "
                     f"vs totalcorner {tc['red_cards']}")
    return notes


def _parse_iso(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        return datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except ValueError:
        return None


def load_aliases(path: str | None) -> dict:
    """Known-equivalent team names, for pairs the matcher refuses on purpose.

    The matcher is conservative: "bayern munich" vs "bayern munchen" scores low
    and is NOT auto-merged, because the same rule that rejects it is the rule
    that stops "manchester united" merging into "manchester city". Confirm a
    pair once, in a file, and it is trusted from then on:

        {"Bayern Munich": ["Bayern München"], "Koln": ["1. FC Köln"]}
    """
    if not path:
        return {}
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
        if not isinstance(data, dict):
            raise ValueError("aliases file must be a JSON object")
        log("INFO", f"loaded {len(data)} alias entr{'y' if len(data) == 1 else 'ies'} from {path}")
        return data
    except Exception as e:  # noqa: BLE001
        log("WARN", f"could not read aliases from {path}: {type(e).__name__}: {e}")
        return {}


# ---------------------------------------------------------------------------
# Selftest — no network, no keys
# ---------------------------------------------------------------------------

# A TotalCorner match object exactly as documented, plus a BigBallsData match
# shaped like the real ones measured on 2026-09-12 (Union Berlin 1-3 Schalke).
TC_SAMPLE = {
    "id": "61421382", "h": "Hue", "h_id": "13367", "a": "Dak Lak", "a_id": "10523",
    "l": "World Club Friendlies", "l_id": "167", "start": "2017-01-13 08:00:00",
    "status": "79", "hc": "6", "ac": "1", "hg": "1", "ag": "1",
    "hrc": "0", "arc": "0", "hyc": "1", "ayc": "1",
    "hf_hc": "4", "hf_ac": "0", "hf_hg": "0", "hf_ag": "1",
}

BB_SAMPLE = {
    "id": "48b6053d-545c-46e6-a559-56210e11516d", "status": "finished",
    "kickoff_utc": "2026-09-11T20:30:00.000Z",
    "home": {"id": "26e7bf26-51b5-42ed-a394-f9c14992f0a8", "name": "1. FC Union Berlin"},
    "away": {"id": "1ebe8afb-0211-4b7f-ae3a-b63dbfd88c0d", "name": "Schalke 04"},
    "score": {"home": 1, "away": 3},
    "linescore": {"home": [0, 1], "away": [1, 2]},
}

BB_PLAYERS = [
    # real shape: two fixture teams, plus contamination that MUST be excluded
    {"name": "A", "team_id": "26e7bf26-51b5-42ed-a394-f9c14992f0a8", "team_name": "1. FC Union Berlin",
     "stats": {"yellow_cards": {"value": "2"}, "red_cards": {"value": "0"}}},
    {"name": "B", "team_id": "1ebe8afb-0211-4b7f-ae3a-b63dbfd88c0d", "team_name": "Schalke 04",
     "stats": {"yellow_cards": {"value": "1"}, "red_cards": {"value": "0"}}},
    {"name": "Foreign", "team_id": "c362d9b2-0000-0000-0000-000000000000", "team_name": "Pisa",
     "stats": {"yellow_cards": {"value": "5"}, "red_cards": {"value": "5"}}},
    {"name": "NullTeam", "team_id": None, "team_name": None,
     "stats": {"yellow_cards": {"value": "1"}, "red_cards": {"value": "0"}}},
]


def selftest() -> int:
    failures = []

    def check(label, got, want):
        if got != want:
            failures.append(f"{label}: got {got!r}, want {want!r}")
            print(f"  FAIL {label}: {got!r} != {want!r}")
        else:
            print(f"  ok   {label}")

    print("name matching (conservative by design)")
    check("FC noise stripped", name_similarity("1. FC Union Berlin", "Union Berlin") > 0.9, True)
    check("accents folded", name_similarity("Venezia FC", "Venezia") > 0.9, True)
    check("exact match", name_similarity("Schalke 04", "Schalke 04"), 1.0)
    check("numeric suffix forgiven", name_similarity("Schalke 04", "Schalke") >= TC_NAME_THRESHOLD, True)
    check("city-sharers rejected: Man Utd vs Man City",
          name_similarity("Manchester United", "Manchester City") < TC_NAME_THRESHOLD, True)
    check("city-sharers rejected: Inter vs AC Milan",
          name_similarity("Inter Milan", "AC Milan") < TC_NAME_THRESHOLD, True)
    check("renamed club rejected: Stade Rennais vs Rennes",
          name_similarity("Stade Rennais", "Rennes") < TC_NAME_THRESHOLD, True)
    check("alias overrides the guard",
          name_similarity("Bayern Munich", "Bayern Munchen",
                          {"Bayern Munich": ["Bayern München"]}), 1.0)

    print("BigBallsData parsing")
    sc = BigBallsSource._linescore(BB_SAMPLE)
    check("HT from per-period linescore", sc["HT"], {"home": 0, "away": 1})
    check("FT from score", sc["FT"], {"home": 1, "away": 3})

    print("card extraction (team_id filter)")
    cards = BigBallsSource.cards_from_players(
        BB_PLAYERS, BB_SAMPLE["home"]["id"], BB_SAMPLE["away"]["id"])
    check("contamination excluded", cards["yellow_cards"], {"home": 2, "away": 1})
    check("reds excluded too", cards["red_cards"], {"home": 0, "away": 0})
    check("no team ids -> None",
          BigBallsSource.cards_from_players(BB_PLAYERS, None, None), None)

    print("TotalCorner parsing (all values are strings)")
    tc = TotalCornerSource.parse(TC_SAMPLE)
    check("FT corners + total", tc["corners"]["FT"], {"home": 6, "away": 1, "total": 7})
    check("HT corners", tc["corners"]["HT"], {"home": 4, "away": 0, "total": 4})
    check("HT goals", tc["goals"]["HT"], {"home": 0, "away": 1})
    check("yellow cards (hyc/ayc)", tc["yellow_cards"], {"home": 1, "away": 1})
    check("red cards (hrc/arc)", tc["red_cards"], {"home": 0, "away": 0})

    print("fixture matching")
    tc_rows = [dict(TC_SAMPLE, h="1. FC Union Berlin", a="Schalke 04", start="2026-09-11 20:30:00",
                    h_id=BB_SAMPLE["home"]["id"], a_id=BB_SAMPLE["away"]["id"])]
    picked, reason = pick_totalcorner_match(BB_SAMPLE, tc_rows)
    check("picks the right fixture", (picked or {}).get("home"), "1. FC Union Berlin")
    picked, reason = pick_totalcorner_match(
        BB_SAMPLE, [dict(TC_SAMPLE, h="Bayern Munich", a="Hoffenheim")])
    check("refuses an unrelated fixture", picked, None)

    print("merged payload")
    payload = build_payload(BB_SAMPLE, {"players": BB_PLAYERS}, tc, include_ht_corners=False)
    check("event_id", payload["event_id"],
          "bb_48b6053d-545c-46e6-a559-56210e11516d")
    check("totalcorner_id", payload["totalcorner_id"], "tc_61421382")
    check("scores", payload["scores"], {"HT": {"home": 0, "away": 1},
                                        "FT": {"home": 1, "away": 3}})
    check("corners FT only by default", payload["corners"],
          {"FT": {"home": 6, "away": 1, "total": 7}})
    check("corners gain HT on request",
          build_payload(BB_SAMPLE, {"players": BB_PLAYERS}, tc, True)["corners"]["HT"],
          {"home": 4, "away": 0, "total": 4})
    check("exact key set", sorted(payload.keys()),
          ["away_team", "cards", "corners", "event_id", "home_team", "match_status",
           "scores", "totalcorner_id"])

    print("degradation: TotalCorner missing")
    lonely = build_payload(BB_SAMPLE, {"players": BB_PLAYERS}, None, False)
    check("corners null", lonely["corners"], None)
    check("totalcorner_id null", lonely["totalcorner_id"], None)
    check("goals + cards survive", (lonely["scores"]["FT"], lonely["cards"]["yellow_cards"]),
          ({"home": 1, "away": 3}, {"home": 2, "away": 1}))

    print("cross-check flags disagreement")
    tc_consistent = dict(tc, goals={"HT": {"home": 0, "away": 1},
                                    "FT": {"home": 1, "away": 3}},
                         yellow_cards={"home": 2, "away": 1},
                         red_cards={"home": 0, "away": 0})
    bad = dict(tc_consistent, goals={"HT": {"home": 0, "away": 1},
                                     "FT": {"home": 2, "away": 3}})
    check("FT mismatch reported", any("FT goals differ" in n for n in cross_check(payload, bad)), True)
    check("agreement is silent", cross_check(payload, tc_consistent), [])

    print()
    if failures:
        print(f"selftest: {len(failures)} FAILED")
        return 1
    print("selftest: all parser + matching + merge checks passed")
    return 0


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--date", help="YYYY-MM-DD (default: today, UTC)")
    ap.add_argument("--limit", type=int, default=10, help="max BigBallsData fixtures (default 10)")
    ap.add_argument("--out", default="test_result.json", help="output file (default test_result.json)")
    ap.add_argument("--no-totalcorner", action="store_true", help="BigBallsData only; corners stay null")
    ap.add_argument("--include-ht-corners", action="store_true",
                    help="also emit corners.HT (TotalCorner has it; off to keep the payload exact)")
    ap.add_argument("--verbose", action="store_true", help="print match candidates")
    ap.add_argument("--aliases", help="JSON file of confirmed team-name equivalents")
    ap.add_argument("--selftest", action="store_true", help="run offline checks and exit")
    args = ap.parse_args()

    if args.selftest:
        return selftest()

    date = args.date or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    tc_date = date.replace("-", "")

    bb_key = os.environ.get("BIGBALLSDATA_KEY", "").strip()
    tc_token = os.environ.get("TOTALCORNER_TOKEN", "").strip()
    if not bb_key:
        log("ERROR", "BIGBALLSDATA_KEY is not set — cannot fetch goals or cards")
        return 2
    if not tc_token and not args.no_totalcorner:
        log("WARN", "TOTALCORNER_TOKEN is not set — corners will be null for every fixture")

    bb = BigBallsSource(bb_key)
    tc_src = None if (args.no_totalcorner or not tc_token) else TotalCornerSource(tc_token)
    aliases = load_aliases(args.aliases)

    # Record the reason corners will be empty in the payload itself, not just on
    # stderr: a consumer reading test_result.json must not have to guess whether
    # "corners": null means "no corners in the match" or "no corner source".
    warnings: list[str] = []
    if tc_src is None:
        why = "--no-totalcorner" if args.no_totalcorner else "TOTALCORNER_TOKEN not set"
        warnings.append(f"TotalCorner unavailable ({why}): corners are null for every fixture")

    log("INFO", f"date={date}  limit={args.limit}  totalcorner={'off' if tc_src is None else 'on'}")

    matches = bb.finished_matches(date, args.limit)
    log("INFO", f"bigballs: {len(matches)} finished fixtures")
    if not matches:
        log("WARN", "no finished fixtures — try another --date")

    tc_rows: list[dict] = []
    tc_error = None
    if tc_src is not None:
        try:
            tc_rows, tc_error = tc_src.schedule(tc_date)
            log("INFO", f"totalcorner: {len(tc_rows)} fixtures on {tc_date}"
                        + (f" (error: {tc_error})" if tc_error else ""))
        except Exception as e:  # noqa: BLE001 - never let the corner source kill the run
            tc_error = f"{type(e).__name__}: {e}"
            log("WARN", f"totalcorner schedule failed: {tc_error}")
        if tc_error and not tc_rows:
            warnings.append(f"TotalCorner returned {tc_error}: corners are null for every fixture")

    results = []
    for m in matches:
        home = (m.get("home") or {}).get("name", "?")
        away = (m.get("away") or {}).get("name", "?")
        log("INFO", f"  {home} vs {away}")
        if m.get("status") != "finished":
            log("WARN", f"    skipping: status={m.get('status')!r} is not finished")
            continue

        stats = bb.stat_rows(m["id"])
        tc_match, reason = (None, "totalcorner disabled")
        if tc_rows:
            tc_match, reason = pick_totalcorner_match(m, tc_rows, args.verbose, aliases)
        if tc_match is None and tc_rows:
            log("WARN", f"    no confident TotalCorner fixture: {reason}")
            warnings.append(f"{home} vs {away}: corners unavailable ({reason})")

        payload = build_payload(m, stats, tc_match, args.include_ht_corners)
        for note in cross_check(payload, tc_match):
            log("WARN", f"    CROSS-CHECK {note}")
            warnings.append(f"{home} vs {away}: {note}")
        results.append(payload)

    envelope = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "date": date,
        "sources": {
            "bigballsdata": {"base": BB_BASE, "calls": bb.calls, "status": "ok"},
            "totalcorner": {
                "base": TC_BASE,
                "calls": tc_src.calls if tc_src else 0,
                "status": ("disabled" if tc_src is None
                           else ("error" if tc_error else "ok")),
                "error": tc_error,
            },
        },
        "count": len(results),
        "matches": results,
        "warnings": warnings,
    }

    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(envelope, fh, indent=2, ensure_ascii=False)
        fh.write("\n")

    print(json.dumps(envelope, indent=2, ensure_ascii=False))
    log("INFO", f"wrote {args.out} ({len(results)} fixtures, {len(warnings)} warning(s))")
    return 0


if __name__ == "__main__":
    sys.exit(main())
