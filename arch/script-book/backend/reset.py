"""Wipe every record (devices, backups, baselines, events). Keeps the tables and arch.key.
    python -m app.reset --yes
Stop the server first. Also removes demo_configs/*.cfg so a re-added device starts clean."""
import sys
from .db import DB_PATH, connect, init
from .demo import DEMO_DIR

TABLES = ["arch_baselines", "arch_config_versions", "arch_backup_status", "arch_events", "arch_devices"]   # children first

if __name__ == "__main__":
    if "--yes" not in sys.argv:
        sys.exit(f"This deletes ALL records in {DB_PATH}. Stop the server, then run:  python -m app.reset --yes")
    init()
    with connect() as c:
        for t in TABLES:
            print(f"{t}: {c.execute(f'DELETE FROM {t}').rowcount} rows deleted")
        try: c.execute("DELETE FROM sqlite_sequence")
        except Exception: pass
    for f in DEMO_DIR.glob("*.cfg"): f.unlink(); print(f"removed {f}")
    print("Done.")
