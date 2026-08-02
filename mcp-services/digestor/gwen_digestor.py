#!/usr/bin/env python3
"""gwen-digestor MCP — conversation compression for AI context windows"""

import json
import os
import re
import sqlite3
import gzip
import time
from datetime import datetime
from pathlib import Path
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("gwen-digestor")

BASE_DIR = Path.home() / ".gwen-digestor"
CACHE_DB = BASE_DIR / "cache.db"
STATS_FILE = BASE_DIR / "stats.json"
BASE_DIR.mkdir(parents=True, exist_ok=True)


def _init_db():
    conn = sqlite3.connect(str(CACHE_DB))
    conn.execute(
        "CREATE TABLE IF NOT EXISTS cache "
        "(key TEXT PRIMARY KEY, content BLOB, created_at REAL, ttl_hours REAL DEFAULT 24)"
    )
    try:
        conn.execute("ALTER TABLE cache ADD COLUMN ttl_hours REAL DEFAULT 24")
    except sqlite3.OperationalError:
        pass
    conn.commit()
    return conn


def _load_stats():
    if STATS_FILE.exists():
        return json.loads(STATS_FILE.read_text())
    return {
        "session_start": datetime.now().isoformat(),
        "digest_calls": 0,
        "compress_calls": 0,
        "cache_stores": 0,
        "cache_hits": 0,
        "cache_misses": 0,
        "cache_expired": 0,
        "tokens_in_raw": 0,
        "tokens_in_after": 0,
        "tokens_out_raw": 0,
        "tokens_out_after": 0,
    }


def _save_stats(stats):
    STATS_FILE.write_text(json.dumps(stats, indent=2))


def _count_tokens(text):
    return max(1, len(text) // 4)


# ── content type detection ──────────────────────────

def _detect_content_type(text):
    if text.strip().startswith(("{", "[")):
        return "json"
    if re.search(
        r"\b(def |class |fn |func |function |import |from |"
        r"#include|let |const |var |pub fn|async |await )",
        text,
    ):
        return "code"
    return "prose"


def _smart_crush(text):
    """Strip nulls, truncate arrays >3, flatten nesting."""
    try:
        data = json.loads(text)
    except (json.JSONDecodeError, ValueError):
        return text

    def _crush(obj, depth=0):
        if depth > 5:
            return obj
        if isinstance(obj, dict):
            crushed = {}
            for k, v in obj.items():
                if k in (
                    "file_path", "timestamp", "st_mtime", "mtime",
                    "mode", "permissions", "owner",
                ):
                    continue
                if v is None or v == "" or v == [] or v == {}:
                    continue
                crushed[k] = _crush(v, depth + 1)
            return crushed
        if isinstance(obj, list):
            if len(obj) > 3:
                return _crush(obj[:3], depth) + [
                    f"... (+{len(obj) - 3} more)"
                ]
            return [_crush(item, depth + 1) for item in obj]
        return obj

    return json.dumps(_crush(data), ensure_ascii=False)


def _compress_code(text):
    """Strip comments and blank lines."""
    lines = text.split("\n")
    out = []
    for line in lines:
        s = line.strip()
        if s.startswith(("#", "//", "/*", "*", "--")):
            continue
        if not s:
            continue
        out.append(s)
    return "\n".join(out)


def _compress_with_type(text, content_type):
    if content_type == "json":
        return _smart_crush(text)
    if content_type == "code":
        return _compress_code(text)
    return text


# ── mode detection ──────────────────────────────────────

_CHECKIN_PATTERNS = re.compile(
    r"(pain|stomach|bloat|bowel|sleep|woke|wake|dream|"
    r"food|ate|eat|weight|stress|anxiety|mood|energy|"
    r"headache|dizzy|nausea|cramp)",
    re.IGNORECASE,
)

_TASK_PATTERNS = re.compile(
    r"\b(build|create|make|write|fix|change|update|add|remove|delete|"
    r"install|configure|setup|deploy|implement|refactor|"
    r"need (you|me) to|can you|please|i want you to)\b",
    re.IGNORECASE,
)


def _detect_mode(message):
    if len(message) > 300 and any(
        w in message.lower() for w in ["?", "feel", "worried", "concerned", "scared", "sad"]
    ):
        return "narrative"
    if _CHECKIN_PATTERNS.search(message):
        return "checkin"
    if _TASK_PATTERNS.search(message):
        return "task"
    return "casual"


def _get_level(mode):
    return {"checkin": 25, "task": 50, "narrative": 95, "casual": 75}.get(mode, 75)


# ── checkin extraction ──────────────────────────────────

_RE_PAIN = re.compile(r"pain\D*?(\d+)\s*(?:/10|out\s*of\s*10)?", re.IGNORECASE)
_RE_SLEEP = re.compile(
    r"(?:sleep|slept)\D*?(well|okay|poor|bad|great|fine|decent|terrible|better|worse)",
    re.IGNORECASE,
)
_RE_ENERGY = re.compile(
    r"(?:energy|mood)\D*?(\d+)\s*(?:/10|out\s*of\s*10)?", re.IGNORECASE,
)
_RE_STRESS = re.compile(
    r"stress\D*?(\d+)\s*(?:/10|out\s*of\s*10)?", re.IGNORECASE,
)
_RE_FOOD = re.compile(
    r"\b(?:ate|had|eat(?:en|ing)?)\s+(.+?)(?:\.|$|and\s+(?:then|after))",
    re.IGNORECASE,
)
_RE_WEIGHT = re.compile(r"(\d+\.?\d*)\s*(?:lbs?|pounds?|kg)", re.IGNORECASE)


def _extract_checkin(message):
    parts = []

    sleep_m = _RE_SLEEP.search(message)
    if sleep_m:
        parts.append(f"SLEEP:{sleep_m.group(1).lower()}")

    pain_m = _RE_PAIN.search(message)
    if pain_m:
        parts.append(f"PAIN:{pain_m.group(1)}/10")

    energy_m = _RE_ENERGY.search(message)
    if energy_m:
        parts.append(f"{energy_m.group(1).upper()}:{energy_m.group(2)}/10")

    stress_m = _RE_STRESS.search(message)
    if stress_m:
        parts.append(f"STRESS:{stress_m.group(1)}/10")

    food_matches = _RE_FOOD.findall(message)
    if food_matches:
        foods = [re.sub(r"^i\s+", "", f).strip().rstrip(".,")[:50] for f in food_matches if f.strip()]
        parts.append("FOOD:" + ",".join(foods))

    wt_m = _RE_WEIGHT.search(message)
    if wt_m:
        parts.append(f"WT:{wt_m.group(1)}")

    return "|".join(parts) if parts else None


# ── task stripping ──────────────────────────────────────

_FILLER = re.compile(
    r"\b(hey|hi|hello|good\s*morning|good\s*evening|"
    r"how\s+(are|do|did|about)|hope\s+you|thanks|thank you|"
    r"please|just|actually|basically|"
    r"really|very|quite|somewhat|kind\s*of|sort\s*of)\b",
    re.IGNORECASE,
)


def _strip_task(message):
    cleaned = _FILLER.sub("", message)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    cleaned = re.sub(r"^[\s,;:.!?'\"]+", "", cleaned)
    cleaned = re.sub(r"[\s,;:.!?'\"]+$", "", cleaned)
    return cleaned if cleaned else message


# ── MCP tools ───────────────────────────────────────────

@mcp.tool()
def digest_input(message: str, mode: str = "auto") -> str:
    """
    Strip a message to its essential signal.

    Args:
        message: Your natural-language message
        mode: 'auto' (default), 'checkin', 'task', 'narrative', 'casual'

    Returns:
        Compressed version with [MODE:x@y%] tag
    """
    if mode == "auto":
        mode = _detect_mode(message)

    level = _get_level(mode)
    raw_tokens = _count_tokens(message)

    if mode == "checkin":
        extracted = _extract_checkin(message)
        if extracted:
            result = f"[MODE:checkin@{level}%]\n{extracted}"
        else:
            result = f"[MODE:checkin@{level}%]\n{_strip_task(message)}"
    elif mode == "task":
        stripped = _strip_task(message)
        content_type = _detect_content_type(stripped)
        compressed = _compress_with_type(stripped, content_type)
        tag = f"|type:{content_type}" if content_type != "prose" else ""
        result = f"[MODE:task@{level}%{tag}]\n{compressed}"
    elif mode in ("narrative", "casual"):
        content_type = _detect_content_type(message)
        compressed = _compress_with_type(message, content_type)
        tag = f"|type:{content_type}" if content_type != "prose" else ""
        result = f"[MODE:{mode}@{level}%{tag}]\n{compressed}"
    else:
        result = f"[MODE:unknown@{level}%]\n{message}"

    stats = _load_stats()
    stats["digest_calls"] += 1
    stats["tokens_in_raw"] += raw_tokens
    stats["tokens_in_after"] += _count_tokens(result)
    _save_stats(stats)

    return result


@mcp.tool()
def compress_response(
    response: str, mode: str = "auto", terse: bool = True
) -> str:
    """
    Compress a response to the appropriate level, preserving voice.

    Args:
        response: The full-detail response text
        mode: 'auto', 'checkin', 'task', 'narrative', 'casual'
        terse: If True (default), apply stricter truncation bounds

    Returns:
        Compressed version with [MODE:x@y%] tag
    """
    if mode == "auto":
        mode = _detect_mode(response)

    level = _get_level(mode)
    raw_tokens = _count_tokens(response)

    if mode == "checkin" and level <= 25:
        sentences = re.split(r"(?<=[.!])\s+", response.strip())
        limit = 150 if terse else 250
        result = f"[MODE:checkin@{level}%]\n{sentences[0][:limit]}"
        if not terse and len(sentences) > 1:
            result += " " + sentences[1][:150]
    elif mode == "task" and level <= 50:
        sentences = re.split(r"(?<=[.!])\s+", response.strip())
        limit = 200 if terse else 300
        result = f"[MODE:task@{level}%]\n{sentences[0][:limit]}"
    else:
        result = f"[MODE:{mode}@{level}%]\n{response}"
        if terse:
            result += "\n[TERSE]"

    stats = _load_stats()
    stats["compress_calls"] += 1
    stats["tokens_out_raw"] += raw_tokens
    stats["tokens_out_after"] += _count_tokens(result)
    _save_stats(stats)

    return result


@mcp.tool()
def cache_reference(
    key: str, content: str = "", retrieve: bool = False, ttl_hours: float = 24
) -> str:
    """
    Store or retrieve large reference text with compression.

    Args:
        key: Unique identifier
        content: Text to cache (ignored if retrieve=True)
        retrieve: If True, returns cached content for key
        ttl_hours: Time-to-live in hours (default 24, 0=infinite)

    Returns:
        Status message or cached content (max 2000 chars)
    """
    conn = _init_db()
    cursor = conn.cursor()

    if retrieve or not content:
        if not key:
            conn.close()
            return "[CACHE:error] no content provided"
        cursor.execute(
            "SELECT content, created_at, ttl_hours FROM cache WHERE key = ?",
            (key,),
        )
        row = cursor.fetchone()
        if row:
            content_blob, created_at, ttl = row
            if ttl and time.time() - created_at > ttl * 3600:
                cursor.execute("DELETE FROM cache WHERE key = ?", (key,))
                conn.commit()
                conn.close()
                stats = _load_stats()
                stats["cache_expired"] = stats.get("cache_expired", 0) + 1
                _save_stats(stats)
                return f"[CACHE:expired] key '{key}' (>{ttl}h old)"
            decompressed = gzip.decompress(content_blob).decode("utf-8")
            conn.close()
            stats = _load_stats()
            stats["cache_hits"] = stats.get("cache_hits", 0) + 1
            _save_stats(stats)
            return f"[CACHE:hit] {decompressed[:2000]}"
        conn.close()
        stats = _load_stats()
        stats["cache_misses"] = stats.get("cache_misses", 0) + 1
        _save_stats(stats)
        return f"[CACHE:miss] key '{key}' not found"

    compressed = gzip.compress(content.encode("utf-8"))
    cursor.execute(
        "INSERT OR REPLACE INTO cache (key, content, created_at, ttl_hours) VALUES (?, ?, ?, ?)",
        (key, compressed, time.time(), ttl_hours),
    )
    stats = _load_stats()
    stats["cache_stores"] = stats.get("cache_stores", 0) + 1
    _save_stats(stats)

    conn.commit()
    conn.close()

    return f"[CACHE:stored] {key} — {len(content)}b → {len(compressed)}b ({len(compressed)/len(content):.1%})"


@mcp.tool()
def session_stats(reset: bool = False) -> str:
    """
    Show token savings for current session.

    Args:
        reset: Reset stats to zero (new session)

    Returns:
        Formatted report
    """
    if reset:
        stats = {
            "session_start": datetime.now().isoformat(),
            "digest_calls": 0,
            "compress_calls": 0,
            "cache_stores": 0,
            "cache_hits": 0,
            "cache_misses": 0,
            "cache_expired": 0,
            "tokens_in_raw": 0,
            "tokens_in_after": 0,
            "tokens_out_raw": 0,
            "tokens_out_after": 0,
        }
        _save_stats(stats)
        return "[STATS] Reset for new session"

    stats = _load_stats()

    d_raw = stats["tokens_in_raw"]
    d_aft = stats["tokens_in_after"]
    c_raw = stats["tokens_out_raw"]
    c_aft = stats["tokens_out_after"]

    total_raw = d_raw + c_raw
    total_aft = d_aft + c_aft
    total_saved = total_raw - total_aft
    pct = round((1 - total_aft / total_raw) * 100, 1) if total_raw > 0 else 0

    cache_hits = stats.get("cache_hits", 0)
    cache_misses = stats.get("cache_misses", 0)
    cache_stores = stats.get("cache_stores", 0)
    cache_expired = stats.get("cache_expired", 0)
    cache_line = ""
    if cache_hits or cache_misses or cache_stores or cache_expired:
        cache_line = (
            f"\n  Cache: {cache_stores} stored | {cache_hits} hit | "
            f"{cache_misses} miss | {cache_expired} expired"
        )

    return (
        f"[STATS] Session: {stats['session_start']}\n"
        f"  Calls: {stats['digest_calls']} digest | {stats['compress_calls']} compress{cache_line}\n"
        f"  Input:  {d_raw}t → {d_aft}t  (saved {d_raw - d_aft})\n"
        f"  Output: {c_raw}t → {c_aft}t  (saved {c_raw - c_aft})\n"
        f"  Total:  {total_raw}t → {total_aft}t  ({total_saved} saved, {pct}%)"
    )


if __name__ == "__main__":
    mcp.run(transport="stdio")
