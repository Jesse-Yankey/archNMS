# ARCH Monitoring Station: web app

Tabs converted so far: **Devices**, **Configurations**, **Config drift**. Every other tab still runs on the demo data in `frontend/index.html`.

## Run (demo mode, no hardware)
    cd backend
    pip install -r requirements.txt
    uvicorn app.main:app --host 127.0.0.1 --port 8000     # open http://localhost:8000
    python -m app.demo drift RUBY-SW4-APP                 # then "Back up now" on that device, to see drift

## Run against your real network
    export ARCH_MODE=live ARCH_TZ=UTC
    uvicorn app.main:app --host 127.0.0.1 --port 8000
Then use **Devices > Add device**. Test connection checks TCP 22 and does a real SSH login; Add device stores the credentials
(encrypted) and runs the first backup in the background.
Optional fallback login for devices without their own: `ARCH_SSH_USER`, `ARCH_SSH_PASS`, `ARCH_SSH_ENABLE`.

**Do not expose the port to your network yet.** There is no login, and the API can save device credentials and accept baselines.
Keep `--host 127.0.0.1` until the auth step is done.

## Credentials
- Device passwords, enable passwords and SNMP secrets are encrypted with Fernet before they touch the database and are never returned by the API.
- The key is `ARCH_SECRET_KEY`, or else a file `arch.key` created next to the database (owner-only permissions) on first use.
  **Back this file up with the database.** Without it the stored credentials cannot be read and must be re-entered.

## Database
SQLite file `arch.db` (override with `ARCH_DB`). All tables are prefixed `arch_`. A database from the first release is upgraded
automatically on start (tables renamed, new columns added, nothing lost).

## Devices
- Vendor driver maps to a Netmiko `device_type`: Cisco IOS/IOS-XE = `cisco_ios`, Huawei VRP = `huawei`, PLANET = `cisco_ios` (check your model),
  Detect automatically = Netmiko autodetect (resolved at test time or first backup, then saved), Generic SNMP only = no config backups.
- Removing a device keeps its config history for 90 days (re-adding the same name brings it back); "also delete history" removes it at once.
- SNMP settings and poll interval are stored but not used yet. They need the Poller (Overview, Latency, Service checks tabs), so new devices show **Not polled yet**.

## API
    GET    /api/devices                       POST /api/devices/test      POST /api/devices      DELETE /api/devices/{id}?purge=false
    GET    /api/configs                       GET  /api/drift
    POST   /api/devices/{id}/backup           POST /api/backups/run       POST /api/devices/{id}/baseline

## How the frontend is wired
`api-core.js` (fetch helper + refresh), `api-devices.js`, `api-configs.js`. Each converted tab adds a loader and hooks into `index.html` through
`ARCH_APP` / `ARCH_HOOKS`. If the API can't be reached (for example the HTML opened as a file) the original demo behaviour still works.

## Known gaps
- No login/roles. Next gate before using this on a shared network.
- One credential set per device, no edit dialog yet (to change a password: remove and re-add, or re-add after a soft remove).
- A device whose first backup failed shows as "No backup yet" in the Configurations tab.
