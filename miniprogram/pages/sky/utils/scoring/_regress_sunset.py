#!/usr/bin/env python3
"""One-off: regress our sunset score against Afterglow on Open-Meteo archive."""

from __future__ import annotations

import json
import math
from collections import Counter
from datetime import datetime
from pathlib import Path

WEATHER = Path(
    "/Users/admin/.cursor/projects/Users-admin-WeChatProjects-cat-world/agent-tools/14942efa-fe09-478d-bdc1-48769258e03e.txt"
)
AIR = Path(
    "/Users/admin/.cursor/projects/Users-admin-WeChatProjects-cat-world/agent-tools/d9ce2a93-a1c0-487f-a272-1e54944250c3.txt"
)
BEIJING = Path(
    "/Users/admin/.cursor/projects/Users-admin-WeChatProjects-cat-world/agent-tools/38ba3e61-7cec-42f1-986b-5779218e57f4.txt"
)
CHENGDU = Path(
    "/Users/admin/.cursor/projects/Users-admin-WeChatProjects-cat-world/agent-tools/1d8b80d7-cac8-46a5-977b-0b2452d45b67.txt"
)


def gauss(x: float, mu: float, sigma: float) -> float:
    return math.exp(-((x - mu) ** 2) / (2 * sigma * sigma))


def ramp(x: float, x0: float, x1: float, y0: float, y1: float) -> float:
    t = max(0.0, min(1.0, (x - x0) / (x1 - x0)))
    return y0 + (y1 - y0) * t


def clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def afterglow(m: dict) -> int:
    low, mid, high = m["low"] or 0, m["mid"] or 0, m["high"] or 0
    score = 25 + 48 * gauss(high, 42, 24) + 16 * gauss(mid, 35, 22)
    if low > 15:
        score -= 0.75 * (low - 15)
    if low > 85 and mid > 70:
        score = min(score, 10)
    rh, vis, aod = m.get("rh"), m.get("vis"), m.get("aod")
    if rh is not None:
        if rh > 65:
            score -= min(14, (rh - 65) * 0.4)
        elif rh < 40:
            score += 5
    if vis is not None:
        if vis >= 30000:
            score += 6
        elif vis < 10000:
            score -= min(12, (10000 - vis) / 800)
    if aod is not None:
        if 0.06 <= aod <= 0.3:
            score += 7
        elif aod > 0.5:
            score -= min(12, (aod - 0.5) * 25)
    return int(clamp(round(score), 2, 99))


def ours(m: dict) -> int:
    low, mid, high = m["low"] or 0, m["mid"] or 0, m["high"] or 0
    score = 25 + 48 * gauss(high, 42, 24) + 16 * gauss(mid, 35, 22)
    if low > 15:
        score -= 0.75 * (low - 15)
    score *= ramp(mid, 80, 100, 1, 0.75)
    crush = ramp(low, 70, 95, 0, 1) * ramp(mid, 70, 95, 0, 1)
    if crush > 0:
        score = score * (1 - crush) + min(score, 10) * crush
    vis_m = m.get("vis")
    vis_km = (vis_m / 1000) if vis_m is not None else 10
    if vis_km < 10:
        score += ramp(vis_km, 4, 10, -12, 0)
    else:
        score += ramp(vis_km, 10, 20, 0, 6)
    rh = m.get("rh")
    if rh is not None:
        if rh < 40:
            score += ramp(rh, 20, 40, 5, 0)
        elif rh > 80 and vis_km < 12:
            score += ramp(rh, 80, 95, 0, -6)
    aod = m.get("aod")
    if aod is not None:
        if aod <= 0.18:
            score += ramp(aod, 0, 0.18, 0, 7)
        elif aod <= 0.5:
            score += ramp(aod, 0.18, 0.5, 7, 0)
        else:
            score += ramp(aod, 0.5, 1, 0, -12)
    elif m.get("pm25") is not None:
        score += ramp(m["pm25"], 35, 150, 0, -12)
    precip = m.get("precip") or 0
    code = m.get("code") or 0
    if code >= 95:
        score *= 0.3
    elif precip > 0.2:
        score *= ramp(precip, 0.2, 3, 1, 0.48)
    return int(clamp(round(score), 2, 99))


def grade(score: int) -> str:
    for mn, g in (
        (88, "A+"),
        (76, "A"),
        (66, "B+"),
        (56, "B"),
        (47, "C+"),
        (38, "C"),
        (26, "D"),
        (-1, "F"),
    ):
        if score >= mn:
            return g
    return "F"


def coarse(g: str) -> str:
    if g in ("A+", "A"):
        return "A"
    if g in ("B+", "B"):
        return "B"
    if g in ("C+", "C"):
        return "C"
    return "DF"


def parse_iso(s: str) -> datetime:
    return datetime.fromisoformat(s)


def hourly_at(times: list[str], vals: list, t: datetime):
    ts = [parse_iso(x) for x in times]
    if not ts:
        return None
    i = 0
    while i < len(ts) and ts[i] <= t:
        i += 1
    i1 = min(i, len(ts) - 1)
    i0 = max(0, i - 1)
    a, b = vals[i0], vals[i1]
    if a is None and b is None:
        return None
    if a is None or i0 == i1:
        return b if b is not None else a
    if b is None:
        return a
    span = (ts[i1] - ts[i0]).total_seconds()
    f = 0 if span == 0 else (t - ts[i0]).total_seconds() / span
    return a + (b - a) * f


def pearson(xs: list[float], ys: list[float]) -> float:
    n = len(xs)
    mx, my = sum(xs) / n, sum(ys) / n
    num = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    den = math.sqrt(sum((x - mx) ** 2 for x in xs) * sum((y - my) ** 2 for y in ys))
    return num / den if den else 0


def spearman(xs: list[float], ys: list[float]) -> float:
    def ranks(vs: list[float]) -> list[float]:
        order = sorted(range(len(vs)), key=lambda i: vs[i])
        r = [0.0] * len(vs)
        i = 0
        while i < len(order):
            j = i
            while j + 1 < len(order) and vs[order[j + 1]] == vs[order[i]]:
                j += 1
            avg = (i + j) / 2 + 1
            for k in range(i, j + 1):
                r[order[k]] = avg
            i = j + 1
        return r

    return pearson(ranks(xs), ranks(ys))


def linreg(xs: list[float], ys: list[float]) -> tuple[float, float, float]:
    n = len(xs)
    mx, my = sum(xs) / n, sum(ys) / n
    varx = sum((x - mx) ** 2 for x in xs)
    slope = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / varx if varx else 0
    intercept = my - slope * mx
    pred = [slope * x + intercept for x in xs]
    ss_res = sum((y - p) ** 2 for y, p in zip(ys, pred))
    ss_tot = sum((y - my) ** 2 for y in ys)
    r2 = 1 - ss_res / ss_tot if ss_tot else 0
    return slope, intercept, r2


def score_city(weather_path: Path, air_path: Path | None, name: str) -> list[dict]:
    weather = json.loads(weather_path.read_text())
    air = json.loads(air_path.read_text()) if air_path else None
    h = weather["hourly"]
    rows = []
    for sunset in weather["daily"]["sunset"]:
        if not sunset:
            continue
        t = parse_iso(sunset)
        m = {
            "low": hourly_at(h["time"], h["cloud_cover_low"], t),
            "mid": hourly_at(h["time"], h["cloud_cover_mid"], t),
            "high": hourly_at(h["time"], h["cloud_cover_high"], t),
            "rh": hourly_at(h["time"], h["relative_humidity_2m"], t),
            "vis": hourly_at(h["time"], h["visibility"], t),
            "precip": hourly_at(h["time"], h["precipitation"], t),
            "code": hourly_at(h["time"], h["weather_code"], t),
            "aod": None,
            "pm25": None,
        }
        if any(m[k] is None for k in ("low", "mid", "high")):
            continue
        if air:
            m["aod"] = hourly_at(air["hourly"]["time"], air["hourly"]["aerosol_optical_depth"], t)
            m["pm25"] = hourly_at(air["hourly"]["time"], air["hourly"]["pm2_5"], t)
        ag, ou = afterglow(m), ours(m)
        rows.append(
            {
                "city": name,
                "date": sunset[:10],
                "afterglow": ag,
                "ours": ou,
                "diff": ou - ag,
                "ag_grade": grade(ag),
                "our_grade": grade(ou),
                "high": round(m["high"], 1),
                "mid": round(m["mid"], 1),
                "low": round(m["low"], 1),
                "aod": None if m["aod"] is None else round(m["aod"], 2),
            }
        )
    return rows


def summarize(rows: list[dict], label: str) -> dict:
    xs = [r["afterglow"] for r in rows]
    ys = [r["ours"] for r in rows]
    diffs = [r["diff"] for r in rows]
    slope, intercept, r2 = linreg(xs, ys)
    mae = sum(abs(d) for d in diffs) / len(diffs)
    bias = sum(diffs) / len(diffs)
    within5 = sum(1 for d in diffs if abs(d) <= 5) / len(diffs)
    within10 = sum(1 for d in diffs if abs(d) <= 10) / len(diffs)
    exact = sum(1 for r in rows if r["ag_grade"] == r["our_grade"]) / len(rows)
    coarse_hit = sum(1 for r in rows if coarse(r["ag_grade"]) == coarse(r["our_grade"])) / len(rows)
    invert = 0
    for i, a in enumerate(rows):
        for b in rows[i + 1 :]:
            if a["afterglow"] == b["afterglow"]:
                continue
            ag_order = a["afterglow"] > b["afterglow"]
            our_order = a["ours"] > b["ours"]
            if ag_order != our_order and abs(a["afterglow"] - b["afterglow"]) >= 8:
                invert += 1
    pairs = len(rows) * (len(rows) - 1) / 2
    buckets = Counter()
    for r in rows:
        buckets[coarse(r["ag_grade"])] += 1
    confusion = Counter()
    for r in rows:
        confusion[f"{coarse(r['ag_grade'])}->{coarse(r['our_grade'])}"] += 1
    worst = sorted(rows, key=lambda r: -abs(r["diff"]))[:8]
    return {
        "label": label,
        "n": len(rows),
        "r": round(pearson(xs, ys), 3),
        "rho": round(spearman(xs, ys), 3),
        "r2": round(r2, 3),
        "slope": round(slope, 3),
        "intercept": round(intercept, 2),
        "mae": round(mae, 2),
        "bias": round(bias, 2),
        "within5": round(within5, 3),
        "within10": round(within10, 3),
        "grade_exact": round(exact, 3),
        "grade_coarse": round(coarse_hit, 3),
        "pair_invert": round(invert / pairs, 3) if pairs else 0,
        "ours_mean": round(sum(ys) / len(ys), 1),
        "ag_mean": round(sum(xs) / len(xs), 1),
        "buckets": dict(buckets),
        "confusion": dict(confusion),
        "worst": worst,
        "series": [{"date": r["date"], "afterglow": r["afterglow"], "ours": r["ours"]} for r in rows],
    }


def main() -> None:
    hz = score_city(WEATHER, AIR, "杭州")
    bj = score_city(BEIJING, None, "北京")
    cd = score_city(CHENGDU, None, "成都")
    all_rows = hz + bj + cd
    out = {
        "hangzhou": summarize(hz, "杭州 2026-07-01 至 2026-10-12，含 AOD"),
        "beijing": summarize(bj, "北京同期，无 AOD"),
        "chengdu": summarize(cd, "成都同期，无 AOD"),
        "all": summarize(all_rows, "三城合计"),
    }
    print(json.dumps({k: {kk: vv for kk, vv in v.items() if kk not in ("series", "worst")} for k, v in out.items()}, ensure_ascii=False, indent=2))
    print("\n杭州偏差最大的几天:")
    for r in out["hangzhou"]["worst"]:
        print(f"  {r['date']} 官网{r['afterglow']}{r['ag_grade']} 我们{r['ours']}{r['our_grade']} 差{r['diff']:+} 高{r['high']} 中{r['mid']} 低{r['low']} AOD{r['aod']}")
    Path("/tmp/sunset_regress.json").write_text(json.dumps(out, ensure_ascii=False))


if __name__ == "__main__":
    main()
