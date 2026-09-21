from __future__ import annotations

import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
STATE = REPO / "bots" / "elon-musk" / "board-state.json"
BOARD = REPO / "shared" / "board" / "elon-musk.md"
BEGIN = "<!-- ELON_STATUS:BEGIN -->"
END = "<!-- ELON_STATUS:END -->"
REQUIRED = ("progress", "blockers", "decisions")


def fail(message: str) -> int:
    print(f"BOARD_SYNC_ERROR: {message}", file=sys.stderr)
    return 1


def parse_time(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def validate(data: dict) -> None:
    updated = parse_time(data["updated_at"])
    if updated.tzinfo is None:
        raise ValueError("updated_at must include timezone")
    max_age = int(data.get("stale_after_hours", 168))
    age = datetime.now(timezone.utc) - updated.astimezone(timezone.utc)
    if age.total_seconds() > max_age * 3600:
        raise ValueError(f"board-state is stale ({age.days}d; limit {max_age}h)")
    for key in REQUIRED:
        items = data.get(key)
        if not isinstance(items, list) or not items:
            raise ValueError(f"{key} must be a non-empty list")
        for item in items:
            if not isinstance(item, dict) or not item.get("text") or not item.get("source"):
                raise ValueError(f"{key} items require text and source")


def lines(title: str, items: list[dict]) -> list[str]:
    out = [f"### {title}"]
    out.extend(f'- {item["text"]}  _(근거: `{item["source"]}`)_' for item in items)
    return out


def main() -> int:
    try:
        data = json.loads(STATE.read_text(encoding="utf-8"))
        validate(data)
        original = BOARD.read_text(encoding="utf-8")
        if original.count(BEGIN) != 1 or original.count(END) != 1:
            return fail("board markers missing or duplicated")
        canonical = json.dumps(
            {key: data[key] for key in ("updated_at", *REQUIRED)},
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        )
        digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:16]
        body = [
            BEGIN,
            f'**상태 기준시각:** {data["updated_at"]}',
            f"**본문 해시:** `{digest}`",
            "",
            *lines("진행 중", data["progress"]),
            "",
            *lines("블로커", data["blockers"]),
            "",
            *lines("부자아빠님 결정·입력 대기", data["decisions"]),
            END,
        ]
        before, tail = original.split(BEGIN, 1)
        _, after = tail.split(END, 1)
        rendered = before.rstrip() + "\n\n" + "\n".join(body) + after
        if rendered != original:
            BOARD.write_text(rendered, encoding="utf-8", newline="\n")
            print(f"board updated hash={digest}")
        else:
            print(f"board current hash={digest}")
        return 0
    except Exception as exc:
        return fail(str(exc))


if __name__ == "__main__":
    raise SystemExit(main())
