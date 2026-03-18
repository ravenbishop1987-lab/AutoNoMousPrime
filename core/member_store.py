from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any


class MemberStore:
    def __init__(self, db_path: str | Path = "data/members.db") -> None:
        self._db_path = Path(db_path)
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self._db_path))
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        conn = self._connect()
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS members (
                id TEXT PRIMARY KEY,
                email TEXT NOT NULL,
                display_name TEXT DEFAULT '',
                org_name TEXT DEFAULT '',
                onboarded INTEGER DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now'))
            );
            """
        )
        conn.commit()
        conn.close()

    def ensure_member(self, user_id: str, email: str) -> dict[str, Any]:
        conn = self._connect()
        conn.execute(
            """
            INSERT INTO members (id, email)
            VALUES (?, ?)
            ON CONFLICT(id) DO UPDATE SET
              email = excluded.email,
              updated_at = datetime('now')
            """,
            (user_id, email),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM members WHERE id = ?", (user_id,)).fetchone()
        conn.close()
        return dict(row) if row else {}

    def get_member(self, user_id: str) -> dict[str, Any] | None:
        conn = self._connect()
        row = conn.execute("SELECT * FROM members WHERE id = ?", (user_id,)).fetchone()
        conn.close()
        return dict(row) if row else None

    def save_profile(self, user_id: str, email: str, display_name: str = "", org_name: str = "") -> dict[str, Any]:
        conn = self._connect()
        conn.execute(
            """
            INSERT INTO members (id, email, display_name, org_name, onboarded)
            VALUES (?, ?, ?, ?, 1)
            ON CONFLICT(id) DO UPDATE SET
              email = excluded.email,
              display_name = CASE
                WHEN excluded.display_name != '' THEN excluded.display_name
                ELSE members.display_name
              END,
              org_name = CASE
                WHEN excluded.org_name != '' THEN excluded.org_name
                ELSE members.org_name
              END,
              onboarded = CASE
                WHEN excluded.display_name != '' OR excluded.org_name != '' THEN 1
                ELSE members.onboarded
              END,
              updated_at = datetime('now')
            """,
            (user_id, email, display_name, org_name),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM members WHERE id = ?", (user_id,)).fetchone()
        conn.close()
        return dict(row) if row else {}
