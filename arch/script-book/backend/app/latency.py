"""Real ICMP latency monitoring for ARCH Monitoring Station."""

import concurrent.futures
import re
import statistics
import subprocess

from datetime import datetime, timedelta, timezone

from .db import connect


PROBES = 10
TIMEOUT = 1
PING_INTERVAL = 1.0
RETENTION_DAYS = 30


def utcnow():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def percentile(values, percent):
    """Calculate a linearly interpolated percentile."""
    if not values:
        return None

    values = sorted(values)

    if len(values) == 1:
        return round(values[0], 3)

    position = (len(values) - 1) * percent / 100
    lower = int(position)
    upper = min(lower + 1, len(values) - 1)
    fraction = position - lower

    result = values[lower] + fraction * (
        values[upper] - values[lower]
    )

    return round(result, 3)


def collect_device(device_id):
    """Collect one ICMP measurement round and save it."""

    with connect() as c:
        device = c.execute(
            """
            SELECT id, ip
            FROM arch_devices
            WHERE id = ?
              AND enabled = 1
              AND removed_at IS NULL
            """,
            (device_id,)
        ).fetchone()

    if not device:
        return {
            "ok": False,
            "device_id": device_id,
            "error": "Device not found, disabled, or removed."
        }

    target_ip = device["ip"]
    collected_at = utcnow()

    command = [
        "/usr/bin/ping",
        "-n",
        "-c", str(PROBES),
        "-W", str(TIMEOUT),
        "-i", str(PING_INTERVAL),
        "-w", "12",
        target_ip
    ]

    error = None
    output = ""
    received_times = []

    try:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=13,
            check=False
        )

        output = result.stdout + "\n" + result.stderr

        received_times = [
            float(value)
            for value in re.findall(
                r"time[=<]([\d.]+)\s*ms",
                output
            )
        ]

        if result.returncode not in (0, 1):
            error = output.strip()[-1000:] or (
                f"ping exited with code {result.returncode}"
            )

    except subprocess.TimeoutExpired:
        error = "ICMP measurement timed out."

    except OSError as exc:
        error = str(exc)

    received = len(received_times)
    loss_pct = round(
        ((PROBES - received) / PROBES) * 100, 2
    )

    if received:
        times = sorted(received_times)

        min_ms = round(times[0], 3)
        p25_ms = percentile(times, 25)
        median_ms = percentile(times, 50)
        p75_ms = percentile(times, 75)
        max_ms = round(times[-1], 3)

        differences = [
            abs(received_times[i] - received_times[i - 1])
            for i in range(1, received)
        ]

        jitter_ms = (
            round(statistics.mean(differences), 3)
            if differences else 0.0
        )

        status = "up" if received == PROBES else "degraded"

    else:
        min_ms = None
        p25_ms = None
        median_ms = None
        p75_ms = None
        max_ms = None
        jitter_ms = None
        status = "down"

        if not error:
            error = "No ICMP replies received."

    with connect() as c:
        c.execute(
            """
            INSERT INTO arch_latency_stats (
                device_id, target_ip, collected_at,
                sent, received,
                min_ms, p25_ms, median_ms, p75_ms, max_ms,
                jitter_ms, loss_pct, status, error
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                device_id, target_ip, collected_at,
                PROBES, received,
                min_ms, p25_ms, median_ms, p75_ms, max_ms,
                jitter_ms, loss_pct, status, error
            )
        )

    return {
        "ok": received > 0,
        "device_id": device_id,
        "ip": target_ip,
        "sent": PROBES,
        "received": received,
        "loss_pct": loss_pct,
        "status": status,
        "median_ms": median_ms,
        "jitter_ms": jitter_ms,
        "error": error
    }


def collect_all():
    """Poll every enabled, non-removed device concurrently."""

    with connect() as c:
        devices = c.execute(
            """
            SELECT id
            FROM arch_devices
            WHERE enabled = 1
              AND removed_at IS NULL
            ORDER BY id
            """
        ).fetchall()

    if not devices:
        return []

    with concurrent.futures.ThreadPoolExecutor(
        max_workers=min(10, len(devices))
    ) as executor:
        futures = [
            executor.submit(collect_device, device["id"])
            for device in devices
        ]

        return [future.result() for future in futures]


def purge_expired():
    """Delete latency measurements older than 30 days."""

    cutoff = (
        datetime.now(timezone.utc) - timedelta(days=RETENTION_DAYS)
    ).isoformat(timespec="seconds")

    with connect() as c:
        result = c.execute(
            """
            DELETE FROM arch_latency_stats
            WHERE collected_at < ?
            """,
            (cutoff,)
        )

        return result.rowcount


def history(device_id, hours=24):
    """Return real latency measurements for a device."""

    with connect() as c:
        device = c.execute(
            """
            SELECT id, ip
            FROM arch_devices
            WHERE id = ? AND removed_at IS NULL
            """,
            (device_id,)
        ).fetchone()

        if not device:
            raise KeyError(device_id)

        rows = c.execute(
            """
            SELECT *
            FROM arch_latency_stats
            WHERE device_id = ?
              AND collected_at >= ?
            ORDER BY collected_at ASC
            """,
            (
                device_id,
                (
                    datetime.now(timezone.utc)
                    - timedelta(hours=hours)
                ).isoformat(timespec="seconds")
            )
        ).fetchall()

    return {
        "device_id": device_id,
        "ip": device["ip"],
        "hours": hours,
        "measurements": [dict(row) for row in rows]
    }


def targets():
    """Return enabled devices and their latest latency measurement."""

    with connect() as c:
        rows = c.execute(
            """
            SELECT
                d.id,
                d.ip,
                d.site,
                d.role,
                l.collected_at,
                l.status,
                l.sent,
                l.received,
                l.loss_pct,
                l.min_ms,
                l.median_ms,
                l.max_ms,
                l.jitter_ms
            FROM arch_devices AS d
            LEFT JOIN arch_latency_stats AS l
                ON l.id = (
                    SELECT MAX(x.id)
                    FROM arch_latency_stats AS x
                    WHERE x.device_id = d.id
                )
            WHERE d.enabled = 1
              AND d.removed_at IS NULL
            ORDER BY d.id
            """
        ).fetchall()

    return [dict(row) for row in rows]
