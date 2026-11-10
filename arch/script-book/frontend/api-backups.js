/* ARCH Backups tab: live backup status, history and monthly calendar. */
(() => {
  const { api } = ARCH;
  const { S, toast } = ARCH_APP;

  const state = {
    devices: [],
    configs: [],
    events: [],
    month: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    selectedDay: new Date().toISOString().slice(0, 10),
    loading: false
  };

  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;',
    '"': '&quot;', "'": '&#39;'
  })[ch]);

  const dateKey = value => {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return [
      d.getFullYear(),
      String(d.getMonth() + 1).padStart(2, '0'),
      String(d.getDate()).padStart(2, '0')
    ].join('-');
  };

  const dateText = value => {
    if (!value) return 'Never';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
  };

  const eligibleDevices = () => state.devices.filter(d => {
    const driver = String(d.driver || d.vendor || '').toLowerCase();
    return d.enabled !== false && d.enabled !== 0 && driver !== 'snmp_only';
  });

  const configFor = id => state.configs.find(c => c.id === id);

  const backupStatus = config => {
    if (!config || !config.last_attempt) {
      return { label: 'Never backed up', cls: 'pending' };
    }

    if (config.fail) {
      return { label: 'Failed', cls: 'bad' };
    }

    if (config.last_ok) {
      return { label: 'Successful', cls: 'ok' };
    }

    return { label: 'Attempt recorded', cls: 'pending' };
  };

  const styles = `
    <style id="arch-backups-styles">
      #view-backups .bk-toolbar{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:16px}
      #view-backups .bk-actions{display:flex;gap:8px;flex-wrap:wrap}
      #view-backups .bk-grid{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(280px,.75fr);gap:16px}
      #view-backups .bk-panel{border:1px solid var(--line);border-radius:12px;padding:16px;background:var(--panel,transparent);min-width:0}
      #view-backups .bk-panel h3{margin:0 0 12px;font-size:14px}
      #view-backups .bk-muted{color:var(--muted);font-size:12px}
      #view-backups .bk-table-wrap{overflow-x:auto}
      #view-backups table{width:100%;border-collapse:collapse;font-size:12px}
      #view-backups th,#view-backups td{text-align:left;padding:10px 9px;border-bottom:1px solid var(--line);white-space:nowrap}
      #view-backups th{color:var(--muted);font-weight:600}
      #view-backups .bk-status{display:inline-flex;align-items:center;gap:7px}
      #view-backups .bk-dot{width:8px;height:8px;border-radius:50%;background:var(--warn)}
      #view-backups .bk-status.ok .bk-dot{background:var(--up)}
      #view-backups .bk-status.bad .bk-dot{background:var(--down)}
      #view-backups .bk-calendar-head{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:12px}
      #view-backups .bk-calendar{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:5px}
      #view-backups .bk-weekday{text-align:center;color:var(--muted);font-size:10px;padding:5px 0}
      #view-backups .bk-day{min-height:43px;border:1px solid var(--line);border-radius:7px;background:transparent;color:var(--text);cursor:pointer;font-size:11px;position:relative}
      #view-backups .bk-day.empty{border-color:transparent;cursor:default}
      #view-backups .bk-day.success{background:color-mix(in srgb,var(--up) 12%,transparent);border-color:color-mix(in srgb,var(--up) 50%,var(--line))}
      #view-backups .bk-day.failed{background:color-mix(in srgb,var(--down) 12%,transparent);border-color:color-mix(in srgb,var(--down) 55%,var(--line))}
      #view-backups .bk-day.mixed{background:color-mix(in srgb,var(--warn) 13%,transparent);border-color:color-mix(in srgb,var(--warn) 55%,var(--line))}
      #view-backups .bk-day.selected{outline:2px solid var(--accent);outline-offset:1px}
      #view-backups .bk-day small{display:block;font-size:9px;color:var(--muted)}
      #view-backups .bk-events{margin-top:14px;max-height:260px;overflow:auto}
      #view-backups .bk-event{padding:9px 0;border-bottom:1px solid var(--line);font-size:12px}
      #view-backups .bk-event strong{display:block;margin-bottom:3px}
      #view-backups .bk-empty{padding:18px;text-align:center;color:var(--muted);font-size:12px}
      #view-backups .bk-error{color:var(--down)}
      @media(max-width:850px){#view-backups .bk-grid{grid-template-columns:1fr}}
    </style>`;

  if (!document.getElementById('arch-backups-styles')) {
    document.head.insertAdjacentHTML('beforeend', styles);
  }

  ARCH.loaders.push(async () => {
    const [devices, configs, events] = await Promise.all([
      api('/devices'),
      api('/configs'),
      api('/backups/events?days=365')
    ]);

    state.devices = devices;
    state.configs = configs;
    state.events = events;
  });

  function renderCalendar() {
    const year = state.month.getFullYear();
    const month = state.month.getMonth();
    const first = new Date(year, month, 1);
    const days = new Date(year, month + 1, 0).getDate();
    const offset = first.getDay();

    const grouped = new Map();

    state.events.forEach(event => {
      const key = dateKey(event.ts);
      if (!key) return;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(event);
    });

    const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
      .map(day => `<div class="bk-weekday">${day}</div>`).join('');

    let cells = '';

    for (let i = 0; i < offset; i++) {
      cells += '<div class="bk-day empty"></div>';
    }

    for (let day = 1; day <= days; day++) {
      const key = [
        year,
        String(month + 1).padStart(2, '0'),
        String(day).padStart(2, '0')
      ].join('-');

      const events = grouped.get(key) || [];
      const successes = events.filter(e => e.status === 'success').length;
      const failures = events.filter(e => e.status === 'failed').length;

      let cls = '';
      if (successes && failures) cls = 'mixed';
      else if (failures) cls = 'failed';
      else if (successes) cls = 'success';

      if (state.selectedDay === key) cls += ' selected';

      cells += `
        <button type="button" class="bk-day ${cls}" data-bk-day="${key}">
          ${day}
          ${events.length ? `<small>${successes} ✓ ${failures} ✕</small>` : ''}
        </button>`;
    }

    return `
      <div class="bk-calendar-head">
        <button class="btn sm" data-bk-month="-1" type="button">‹</button>
        <strong>${state.month.toLocaleString(undefined, { month: 'long', year: 'numeric' })}</strong>
        <button class="btn sm" data-bk-month="1" type="button">›</button>
      </div>
      <div class="bk-calendar">${weekdays}${cells}</div>`;
  }

  function renderSelectedEvents() {
    const events = state.events.filter(e => dateKey(e.ts) === state.selectedDay);

    if (!events.length) {
      return '<div class="bk-empty">No recorded backup attempts for this date.</div>';
    }

    return events.map(event => `
      <div class="bk-event">
        <strong class="${event.status === 'failed' ? 'bk-error' : ''}">
          ${event.status === 'success' ? '✓ Successful' : '✕ Failed'}
          — ${esc(event.device_id)}
        </strong>
        <span class="bk-muted">${esc(dateText(event.ts))}</span>
        <div>${esc(event.text)}</div>
      </div>`).join('');
  }

  function renderDevices() {
    const devices = eligibleDevices();

    if (!devices.length) {
      return '<div class="bk-empty">No eligible backup devices found.</div>';
    }

    return devices.map(device => {
      const config = configFor(device.id);
      const status = backupStatus(config);

      return `
        <tr>
          <td><strong>${esc(device.id)}</strong><br><span class="bk-muted">${esc(device.site || '—')} · ${esc(device.ip)}</span></td>
          <td><span class="bk-status ${status.cls}"><i class="bk-dot"></i>${status.label}</span></td>
          <td>${esc(dateText(config?.last_ok))}</td>
          <td>${esc(dateText(config?.last_attempt))}</td>
          <td><button type="button" class="btn sm" data-bk-run="${esc(device.id)}">Back up now</button></td>
        </tr>`;
    }).join('');
  }

  function render() {
    const root = document.getElementById('view-backups');
    if (!root) return;

    const devices = eligibleDevices();
    const successCount = devices.filter(d => backupStatus(configFor(d.id)).cls === 'ok').length;
    const failedCount = devices.filter(d => backupStatus(configFor(d.id)).cls === 'bad').length;

    root.innerHTML = `
      <div class="bk-toolbar">
        <div>
          <h2 style="margin:0">Backup management</h2>
          <div class="bk-muted">Live backup status, attempt history and monthly records.</div>
        </div>
        <div class="bk-actions">
          <button class="btn" type="button" data-bk-refresh>Refresh</button>
          <button class="btn primary" type="button" data-bk-all>Run backup for all</button>
        </div>
      </div>

      <div class="tiles" style="margin-bottom:16px">
        <div class="tile"><span>Eligible devices</span><strong>${devices.length}</strong></div>
        <div class="tile"><span>Last known success</span><strong>${successCount}</strong></div>
        <div class="tile"><span>Last attempt failed</span><strong>${failedCount}</strong></div>
      </div>

      <div class="bk-grid">
        <section class="bk-panel">
          <h3>Device backup status</h3>
          <div class="bk-table-wrap">
            <table>
              <thead><tr><th>Device</th><th>Status</th><th>Last successful backup</th><th>Last attempt</th><th>Action</th></tr></thead>
              <tbody>${renderDevices()}</tbody>
            </table>
          </div>
        </section>

        <section class="bk-panel">
          <h3>Backup history calendar</h3>
          ${renderCalendar()}
          <div class="bk-events">
            <strong>Events — ${esc(state.selectedDay)}</strong>
            ${renderSelectedEvents()}
          </div>
        </section>
      </div>`;

    root.querySelectorAll('[data-bk-month]').forEach(button => {
      button.addEventListener('click', () => {
        state.month.setMonth(state.month.getMonth() + Number(button.dataset.bkMonth));
        render();
      });
    });

    root.querySelectorAll('[data-bk-day]').forEach(button => {
      button.addEventListener('click', () => {
        state.selectedDay = button.dataset.bkDay;
        render();
      });
    });

    root.querySelectorAll('[data-bk-run]').forEach(button => {
      button.addEventListener('click', () => {
        const id = button.dataset.bkRun;
        if (ARCH_HOOKS.backupNow) ARCH_HOOKS.backupNow(id, null);
      });
    });

    root.querySelector('[data-bk-all]')?.addEventListener('click', async buttonEvent => {
      const button = buttonEvent.currentTarget;
      button.disabled = true;
      button.textContent = 'Starting backups…';

      try {
        const result = await api('/backups/run', { method: 'POST' });
        toast(`Backup run completed: ${result.ok} of ${result.total} devices succeeded.`);
        await ARCH.refresh();
      } catch (error) {
        toast(`Could not run backups: ${error.message}`);
      } finally {
        button.disabled = false;
        button.textContent = 'Run backup for all';
      }
    });

    root.querySelector('[data-bk-refresh]')?.addEventListener('click', async () => {
      try {
        await ARCH.refresh();
        toast('Backup information refreshed.');
      } catch (error) {
        toast(`Refresh failed: ${error.message}`);
      }
    });
  }

  ARCH_APP.RENDER.backups = render;
})();
