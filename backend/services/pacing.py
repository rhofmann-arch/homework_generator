from __future__ import annotations
"""
Reads the pacing guide Excel and returns the context needed
to generate one week (or one day) of homework.
"""

import pandas as pd
from pathlib import Path
from datetime import datetime, timedelta
from dataclasses import dataclass

_REPO_ROOT = Path(__file__).parent.parent.parent
PACING_DIR = (
    Path("/pacing_guides")
    if Path("/pacing_guides").exists()
    else _REPO_ROOT / "pacing_guides"
)

GUIDE_FILES = {
    "6":          "grade_6.xlsx",
    "6_advanced": "grade_6_advanced.xlsx",
}

COLS = ["day_num", "date", "dow", "notes", "lesson", "topic",
        "hw_front", "hw_back", "extensions", "hm"]


@dataclass
class WeekContext:
    grade: str
    week_start: str
    hw_days: list           # each dict now includes "topic"
    current_lessons: list
    current_topic: str      # topic string for the current week's lesson (for Pool D / Option C)
    covered_lessons: list
    covered_topics: list
    lesson_title: str
    hw_numbers: list


def _load_sheet(xl: pd.ExcelFile, sheet_name: str) -> pd.DataFrame:
    raw = pd.read_excel(xl, sheet_name=sheet_name, header=None)
    has_header = any(
        isinstance(v, str) and v.strip() == "Lesson"
        for v in raw.iloc[0].tolist()
    )
    if has_header:
        raw = raw.iloc[1:].reset_index(drop=True)

    n_cols = raw.shape[1]
    if n_cols >= 10:
        col_map = {0: "day_num", 1: "date", 2: "dow", 3: "notes",
                   4: "lesson", 5: "topic", 6: "hw_front",
                   7: "hw_back", 8: "extensions", 9: "hm"}
    else:
        col_map = {0: "day_num", 1: "date", 2: "dow", 3: "notes",
                   4: "lesson", 6: "hw_front"}

    raw = raw.rename(columns=col_map)
    keep = [c for c in COLS if c in raw.columns]
    df = raw[keep].copy()
    for c in COLS:
        if c not in df.columns:
            df[c] = None
    return df[COLS]


def _load_full_df(grade: str) -> pd.DataFrame:
    guide_file = PACING_DIR / GUIDE_FILES[grade]
    if not guide_file.exists():
        raise FileNotFoundError(f"Pacing guide not found: {guide_file}")
    xl = pd.ExcelFile(guide_file)
    frames = []
    for sheet_name in xl.sheet_names:
        if sheet_name.lower() == "sheet1":  # skip empty placeholder sheets
            continue
        df = _load_sheet(xl, sheet_name)
        df["_sheet"] = sheet_name
        frames.append(df)
    df = pd.concat(frames, ignore_index=True)
    df["date"] = pd.to_datetime(df["date"], errors="coerce").dt.date
    df = df.dropna(subset=["date"])
    return df


def get_week_context(week_start: str, grade: str,
                     specific_date: str | None = None) -> WeekContext:
    """
    Returns context for a full week, or for a single day if specific_date
    (YYYY-MM-DD) is provided.  Spiral review always draws on all prior topics.
    """
    monday = datetime.strptime(week_start, "%Y-%m-%d").date()
    friday = monday + timedelta(days=4)

    df = _load_full_df(grade)

    week_mask  = (df["date"] >= monday) & (df["date"] <= friday)
    week_rows  = df[week_mask].copy()
    prior_rows = df[df["date"] <= friday].dropna(subset=["lesson"])

    # If a specific day was requested, narrow week_rows to just that date
    if specific_date:
        target = datetime.strptime(specific_date, "%Y-%m-%d").date()
        week_rows = week_rows[week_rows["date"] == target].copy()

    hw_week = week_rows[week_rows["hw_front"].notna()].copy()

    hw_days = [
        {
            "date":    str(row["date"]),
            "day_num": str(row["hw_front"]),
            "lesson":  str(row["lesson"]) if pd.notna(row["lesson"]) else "",
            "topic":   str(row["topic"])  if pd.notna(row["topic"])  else "",
            "dow":     str(row["dow"])    if pd.notna(row["dow"])    else "",
        }
        for _, row in hw_week.iterrows()
    ]

    SKIP = ("test", "review", "wrap", "opener", "assessment", "flex", "catch")

    def _clean(rows):
        seen, out = set(), []
        for _, r in rows.iterrows():
            val = str(r["lesson"]) if pd.notna(r["lesson"]) else ""
            if not val or val == "nan":
                continue
            if any(w in val.lower() for w in SKIP):
                continue
            if val not in seen:
                seen.add(val)
                out.append(val)
        return out

    current_lessons = _clean(week_rows)
    covered_lessons = _clean(prior_rows)

    covered_topics = []
    seen_t = set()
    for _, r in prior_rows.iterrows():
        val = str(r["topic"]) if pd.notna(r["topic"]) else ""
        if val and val not in ("nan", "None") and val not in seen_t:
            seen_t.add(val)
            covered_topics.append(val)

    if not covered_topics:
        covered_topics = covered_lessons[:]

    # current_topic: the topic(s) being taught this week, for Pool D prompt
    current_week_topics = []
    seen_ct = set()
    for _, r in week_rows.iterrows():
        val = str(r["topic"]) if pd.notna(r["topic"]) else ""
        if val and val not in ("nan", "None") and val not in seen_ct:
            seen_ct.add(val)
            current_week_topics.append(val)
    # Fall back to lesson names if topics not filled in
    if not current_week_topics:
        current_week_topics = current_lessons[:]

    # For review/test weeks: current_lessons is empty (SKIP-filtered), but we
    # still have school days with homework. Use raw lesson names as context so
    # Claude knows to generate review problems rather than a random lesson.
    if not current_week_topics and not current_lessons:
        for _, r in week_rows.iterrows():
            raw = str(r["lesson"]) if pd.notna(r["lesson"]) else ""
            if raw and raw not in ("nan", "None") and raw not in seen_ct:
                seen_ct.add(raw)
                current_week_topics.append(raw)

    # Final fallback: use most recently covered topic
    if not current_week_topics and covered_topics:
        current_week_topics = [f"{covered_topics[-1]} (review)"]

    current_topic = "; ".join(current_week_topics) if current_week_topics else "Lesson Practice"

    lesson_title = covered_topics[-1] if covered_topics else "Lesson Practice"

    hw_numbers = []
    for d in hw_days:
        try:
            hw_numbers.append(int(str(d["day_num"]).replace("Day", "").strip()))
        except ValueError:
            pass

    return WeekContext(
        grade=grade,
        week_start=week_start,
        hw_days=hw_days,
        current_lessons=current_lessons,
        current_topic=current_topic,
        covered_lessons=covered_lessons,
        covered_topics=covered_topics,
        lesson_title=lesson_title,
        hw_numbers=hw_numbers,
    )


def get_all_weeks(grade: str) -> dict:
    """
    Returns every week in the pacing guide that has at least one homework day,
    along with the individual school days within that week.
    Used by the frontend to populate and filter the week picker.
    """
    df = _load_full_df(grade)
    hw_rows = df[df["hw_front"].notna()].copy()

    def _to_monday(d):
        return d - timedelta(days=d.weekday())

    hw_rows["week_start"] = hw_rows["date"].apply(_to_monday)

    weeks = []
    for week_start, group in hw_rows.groupby("week_start"):
        days = []
        for _, row in group.sort_values("date").iterrows():
            days.append({
                "date":    str(row["date"]),
                "dow":     str(row["dow"]) if pd.notna(row["dow"]) else "",
                "day_num": str(row["hw_front"]),
            })
        weeks.append({
            "week_start": str(week_start),
            "days": days,
        })

    weeks.sort(key=lambda w: w["week_start"])
    return {"weeks": weeks}
