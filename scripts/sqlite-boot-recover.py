#!/usr/bin/env python3
"""Boot-time SQLite unlock/recover for Railway volume prod.db. Exit 0 if usable."""
from __future__ import annotations

import os
import shutil
import sqlite3
import subprocess
import sys

DATA = "/app/data"
DB = os.path.join(DATA, "prod.db")


def log(*args: object) -> None:
    print("[db-recover]", *args, flush=True)


def db_ok(path: str) -> bool:
    try:
        c = sqlite3.connect(path, timeout=30)
        c.execute("PRAGMA busy_timeout=30000")
        r = c.execute("PRAGMA integrity_check").fetchone()
        n = c.execute("SELECT count(*) FROM sqlite_master").fetchone()[0]
        c.close()
        good = bool(r and r[0] == "ok" and n > 10)
        log("check", path, r, "tables", n, "good", good)
        return good
    except Exception as e:
        log("check_fail", path, type(e).__name__, e)
        return False


def clear_wal(path: str) -> None:
    for suf in ("-wal", "-shm"):
        wal = path + suf
        if os.path.exists(wal):
            try:
                os.remove(wal)
                log("removed", wal)
            except Exception as e:
                log("rm_fail", wal, e)


def main() -> int:
    os.makedirs(DATA, exist_ok=True)
    log("start")
    clear_wal(DB)

    if os.path.exists(DB) and db_ok(DB):
        # Ensure WAL mode for fewer lock storms (best-effort).
        try:
            c = sqlite3.connect(DB, timeout=30)
            c.execute("PRAGMA journal_mode=WAL")
            c.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            c.close()
            log("db healthy")
        except Exception as e:
            log("wal_tune_fail", e)
        return 0

    cands: list[str] = []
    if os.path.isdir(DATA):
        for name in sorted(os.listdir(DATA)):
            if name.startswith("prod.db") and name != "prod.db":
                cands.append(os.path.join(DATA, name))
    bdir = os.path.join(DATA, "backups")
    if os.path.isdir(bdir):
        for name in sorted(os.listdir(bdir)):
            if name.endswith(".db"):
                cands.append(os.path.join(bdir, name))
    log("candidates", cands)

    for cand in reversed(cands):
        if not db_ok(cand):
            continue
        broken = DB + ".malformed"
        if os.path.exists(DB):
            shutil.move(DB, broken)
        clear_wal(DB)
        shutil.copy2(cand, DB)
        log("restored_from", cand)
        if db_ok(DB):
            return 0

    if not os.path.exists(DB):
        log("no db file — prisma will create schema")
        return 0

    fixed = DB + ".recovered"
    try:
        if os.path.exists(fixed):
            os.remove(fixed)
        proc = subprocess.run(
            ["sqlite3", DB, ".recover"],
            capture_output=True,
            text=True,
            timeout=240,
        )
        if proc.returncode == 0 and proc.stdout.strip():
            subprocess.run(
                ["sqlite3", fixed],
                input=proc.stdout,
                text=True,
                capture_output=True,
                timeout=240,
                check=False,
            )
            if db_ok(fixed):
                if os.path.exists(DB):
                    shutil.move(DB, DB + ".malformed2")
                clear_wal(DB)
                shutil.move(fixed, DB)
                log("recover_ok")
                return 0
        log("recover_cli_fail", proc.returncode, (proc.stderr or "")[:300])
    except Exception as e:
        log("recover_cli_exc", e)

    # Last resort: iterdump (may drop bad pages).
    try:
        dumpfix = DB + ".dumpfix"
        if os.path.exists(dumpfix):
            os.remove(dumpfix)
        src = sqlite3.connect(f"file:{DB}?mode=ro", uri=True, timeout=60)
        dst = sqlite3.connect(dumpfix)
        for line in src.iterdump():
            try:
                dst.execute(line)
            except Exception:
                pass
        dst.commit()
        src.close()
        dst.close()
        if db_ok(dumpfix):
            if os.path.exists(DB):
                shutil.move(DB, DB + ".malformed3")
            clear_wal(DB)
            shutil.move(dumpfix, DB)
            log("dumpfix_ok")
            return 0
    except Exception as e:
        log("dumpfix_fail", e)

    log("FAILED — leaving file for manual rescue")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
