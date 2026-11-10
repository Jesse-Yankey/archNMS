"""Demo mode: fake devices + generated configs so you can run without hardware.
Edit demo_configs/<DEVICE>.cfg (or run `python -m app.demo drift RUBY-SW4-APP`), then press 'Back up now' to see drift."""
import os, sys
from pathlib import Path
from .db import connect, init

DEMO_DIR = Path(os.environ.get("ARCH_DEMO_DIR", "demo_configs"))
DEVICES = [
    ("CORE-SW1-DC", "10.99.0.1", "huawei", "CloudEngine S6730-H", "Core switch"),
    ("ONYX-SW2-NW", "10.99.0.11", "cisco_ios", "SGS-6341-24T4X", "Distribution"),
    ("RUBY-SW4-APP", "10.99.0.14", "cisco_ios", "SGS-6341-24T4X", "Access"),
    ("DC-SW2-HRP", "10.99.0.22", "cisco_ios", "SGS-6341-24T4X", "Access"),
    ("EDGE-RTR1", "10.99.0.254", "cisco_ios", "ISR 4331", "Edge router"),
    ("OPAL-SW5-FIN", "10.99.0.25", "cisco_ios", "SGS-6341-24T4X", "Access"),
    ("JADE-SW6-WH", "10.99.0.26", "cisco_ios", "SGS-6341-24T4X", "Access"),
    ("WIFI-CTRL1", "10.99.0.40", "cisco_ios", "AirWave 8", "WLAN controller"),
]

def seed():
    with connect() as c:
        c.executemany("INSERT OR IGNORE INTO arch_devices(id,ip,vendor,model,role,added_by,added_at) VALUES(?,?,?,?,?,'demo seed',datetime('now'))", DEVICES)

def template(dev: dict) -> str:
    rtr = "router" in (dev.get("role") or "").lower()
    L = ["! Building configuration...", "!", "version 15.2", f"hostname {dev['id']}", "!",
         "aaa new-model", "aaa authentication login default group tacacs+ local",
         "username admin privilege 15 secret 9 $9$abcdef123456", "!"]
    if not rtr: L += ["vlan 10", " name Finance", "vlan 20", " name Engineering", "vlan 99", " name Management", "!"]
    L += ["interface GigabitEthernet1/0/1", " description uplink", " switchport mode trunk",
          " switchport trunk allowed vlan 10,20,99", "!", f"interface Vlan99", f" ip address {dev['ip']} 255.255.255.0", "!",
          "snmp-server community public123 RO", "logging host 10.99.0.50", "ntp server 10.99.0.1", "!",
          "line vty 0 4", " transport input ssh", "!", "end"]
    return "\n".join(L)

def config_for(dev: dict) -> str:
    p = DEMO_DIR / f"{dev['id']}.cfg"
    if p.exists(): return p.read_text()
    if dev["id"] == "JADE-SW6-WH": raise TimeoutError("SSH connection timed out")   # simulates a dead device
    return template(dev)

def fake_test(p: dict) -> dict:
    if int(p["ip"].split(".")[-1]) == 254:
        return {"ok": False, "lines": ["Device unreachable: connection timed out.", "Check routing, ACLs and management reachability."]}
    if not p.get("ssh_user") or not p.get("ssh_password"):
        return {"ok": False, "lines": ["SSH refused: device login credentials are incomplete."]}
    return {"ok": True, "lines": [f"Demo mode: {p['ip']} is simulated.", "SSH login accepted (simulated).", "SNMP was not tested: the poller is not built yet."]}

def drift(dev_id: str):
    with connect() as c:
        dev = dict(c.execute("SELECT * FROM arch_devices WHERE id=?", (dev_id,)).fetchone())
    DEMO_DIR.mkdir(exist_ok=True)
    t = template(dev).replace(" transport input ssh", " transport input ssh telnet").replace("ntp server 10.99.0.1", "ntp server 10.99.0.2")
    (DEMO_DIR / f"{dev_id}.cfg").write_text(t); print(f"Wrote drifted config for {dev_id}")

if __name__ == "__main__":
    init()
    if sys.argv[1:2] == ["drift"]: drift(sys.argv[2])
