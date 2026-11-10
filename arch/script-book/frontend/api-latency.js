/* ARCH Latency tab: real ICMP measurements from the backend. */
(() => {
  const { api } = ARCH;
  const state = {
    status: null,
    targets: [],
    history: [],
    selected: null,
    range: 24,
    loading: false,
    error: null
  };

  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;',
    '"': '&quot;', "'": '&#39;'
  })[ch]);

  const fmt = (value, digits = 2) =>
    value == null || !Number.isFinite(Number(value))
      ? '—'
      : `${Number(value).toFixed(digits)} ms`;

  const pct = value =>
    value == null || !Number.isFinite(Number(value))
      ? '—'
      : `${Number(value).toFixed(2)}%`;

  const dateText = value => {
    if (!value) return 'No measurement yet';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
  };

  const selectedTarget = () =>
    state.targets.find(t => t.id === state.selected) || state.targets[0] || null;

  async function loadData() {
    if (state.loading) return;
    state.loading = true;
    state.error = null;

    try {
      const [status, targets] = await Promise.all([
        api('/latency/status'),
        api('/latency/targets')
      ]);

      state.status = status;
      state.targets = targets || [];

      if (!state.targets.some(t => t.id === state.selected)) {
        state.selected = state.targets[0]?.id || null;
      }

      const target = selectedTarget();

      if (target) {
        const result = await api(
          `/latency/${encodeURIComponent(target.id)}/history?hours=${state.range}`
        );
        state.history = result.measurements || [];
      } else {
        state.history = [];
      }
    } catch (error) {
      state.error = error.message || 'Unable to load latency data.';
    } finally {
      state.loading = false;
      render();
    }
  }

  function chartMarkup(rows) {
    if (!rows.length) {
      return '<div class="lt-empty">No real ICMP measurements are available for this period.</div>';
    }

    const W = 900, H = 270;
    const left = 54, right = 18, top = 18, bottom = 42;
    const width = W - left - right;
    const height = H - top - bottom;

    const valid = rows.filter(r =>
      r.median_ms != null && Number.isFinite(Number(r.median_ms))
    );

    if (!valid.length) {
      return '<div class="lt-empty">No successful ICMP replies in this period.</div>';
    }

    const times = rows.map(r => new Date(r.collected_at).getTime());
    const first = Math.min(...times);
    const last = Math.max(...times);
    const span = Math.max(last - first, 1);

    const values = valid.flatMap(r =>
      [r.min_ms, r.p25_ms, r.median_ms, r.p75_ms, r.max_ms]
        .filter(v => v != null && Number.isFinite(Number(v)))
        .map(Number)
    );

    const maxValue = Math.max(5, ...values) * 1.15;
    const x = r => left + ((new Date(r.collected_at).getTime() - first) / span) * width;
    const y = value => top + height - (Number(value) / maxValue) * height;

    const line = key => valid.map((r, i) =>
      `${i ? 'L' : 'M'}${x(r).toFixed(1)},${y(r[key]).toFixed(1)}`
    ).join(' ');

    const band = (upper, lower) => {
      const topPath = valid.map((r, i) =>
        `${i ? 'L' : 'M'}${x(r).toFixed(1)},${y(r[upper] ?? r.median_ms).toFixed(1)}`
      ).join(' ');
      const bottomPath = [...valid].reverse().map(r =>
        `L${x(r).toFixed(1)},${y(r[lower] ?? r.median_ms).toFixed(1)}`
      ).join(' ');
      return `${topPath} ${bottomPath} Z`;
    };

    const grid = [0, .25, .5, .75, 1].map(f => {
      const yy = top + height * (1 - f);
      const value = maxValue * f;
      return `
        <line x1="${left}" y1="${yy}" x2="${W-right}" y2="${yy}" stroke="var(--line)" stroke-dasharray="3 4"/>
        <text x="${left-9}" y="${yy+4}" text-anchor="end" fill="var(--muted)" font-size="10">${value.toFixed(1)}</text>`;
    }).join('');

    const ticks = [0, .25, .5, .75, 1].map(f => {
      const d = new Date(first + span * f);
      const label = state.range <= 3
        ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
      return `<text x="${left + width*f}" y="${H-12}" text-anchor="middle" fill="var(--muted)" font-size="10">${esc(label)}</text>`;
    }).join('');

    const lossBars = rows.map(r => {
      const loss = Number(r.loss_pct ?? 100);
      const xx = x(r);
      const barHeight = Math.max(1, (loss / 100) * 24);
      return `<rect x="${xx-2}" y="${top+height-barHeight}" width="4" height="${barHeight}" rx="1" fill="${loss > 0 ? 'var(--warn)' : 'var(--up)'}" opacity=".75"/>`;
    }).join('');

    return `
      <div class="lt-chart-wrap">
        <svg class="lt-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Real ICMP latency history">
          ${grid}
          <path d="${band('max_ms','min_ms')}" fill="var(--accent)" opacity=".08"/>
          <path d="${band('p75_ms','p25_ms')}" fill="var(--accent)" opacity=".20"/>
          ${lossBars}
          <path d="${line('median_ms')}" fill="none" stroke="var(--accent)" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>
          ${valid.map(r => `<circle cx="${x(r)}" cy="${y(r.median_ms)}" r="2.5" fill="var(--accent)"/>`).join('')}
          ${ticks}
          <text x="8" y="14" fill="var(--muted)" font-size="10">RTT (ms)</text>
        </svg>
      </div>
      <div class="lt-legend">
        <span><i class="lt-key median"></i> Median RTT</span>
        <span><i class="lt-key band"></i> 25th–75th percentile</span>
        <span><i class="lt-key loss"></i> Packet loss</span>
      </div>`;
  }

  function render() {
    const view = document.getElementById('view-latency');
    if (!view) return;

    const target = selectedTarget();
    const rows = state.history;
    const latest = rows[rows.length - 1];

    const totalSent = rows.reduce((sum, r) => sum + Number(r.sent || 0), 0);
    const totalReceived = rows.reduce((sum, r) => sum + Number(r.received || 0), 0);
    const availability = totalSent ? totalReceived / totalSent * 100 : null;

    const statusLabel = t => {
      if (!t.collected_at) return ['Waiting for first measurement', 'pending'];
      if (t.status === 'up') return ['Up', 'ok'];
      if (t.status === 'degraded') return ['Degraded', 'warn'];
      if (t.status === 'down') return ['Down', 'bad'];
      return ['Unknown', 'pending'];
    };

    const banner = state.error
      ? `<div class="lt-banner bad">${esc(state.error)}</div>`
      : !state.status?.enabled
        ? '<div class="lt-banner pending"><strong>ICMP monitoring is disabled.</strong> No probes are being sent. Enable monitoring on the backend when you are ready.</div>'
        : '<div class="lt-banner ok"><strong>ICMP monitoring enabled.</strong> Measurements are collected automatically by the backend.</div>';

    const targetRows = state.targets.map(t => {
      const [label, cls] = statusLabel(t);
      return `
        <button class="lt-target ${t.id === target?.id ? 'selected' : ''}" data-device="${esc(t.id)}" type="button">
          <span class="lt-target-main">
            <strong>${esc(t.id)}</strong>
            <small>${esc(t.ip)} · ${esc(t.site || 'Unassigned site')}</small>
          </span>
          <span class="lt-target-stats">
            <strong>${fmt(t.median_ms)}</strong>
            <small>${pct(t.loss_pct)} loss</small>
          </span>
          <span class="lt-badge ${cls}">${esc(label)}</span>
        </button>`;
    }).join('');

    const ranges = [
      [3, '3 hours'], [24, '24 hours'], [168, '7 days']
    ].map(([hours, label]) =>
      `<button type="button" class="lt-range ${state.range === hours ? 'active' : ''}" data-range="${hours}">${label}</button>`
    ).join('');

    view.innerHTML = `
      <style id="arch-latency-styles">
        #view-latency .lt-banner{padding:12px 15px;border:1px solid var(--line);border-radius:10px;margin-bottom:15px;font-size:12px}
        #view-latency .lt-banner.pending{border-color:var(--warn);background:color-mix(in srgb,var(--warn) 8%,transparent)}
        #view-latency .lt-banner.ok{border-color:var(--up);background:color-mix(in srgb,var(--up) 8%,transparent)}
        #view-latency .lt-banner.bad{border-color:var(--down);color:var(--down)}
        #view-latency .lt-layout{display:grid;grid-template-columns:minmax(230px,.72fr) minmax(0,1.8fr);gap:15px}
        #view-latency .lt-panel{border:1px solid var(--line);border-radius:12px;padding:15px;min-width:0;background:var(--panel,transparent)}
        #view-latency .lt-panel h3{font-size:13px;margin:0 0 12px}
        #view-latency .lt-muted{color:var(--muted);font-size:11px}
        #view-latency .lt-targets{display:grid;gap:7px}
        #view-latency .lt-target{display:flex;align-items:center;gap:8px;text-align:left;width:100%;padding:10px;border:1px solid var(--line);border-radius:9px;background:transparent;color:var(--text);cursor:pointer}
        #view-latency .lt-target.selected{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 7%,transparent)}
        #view-latency .lt-target-main{min-width:0;flex:1}
        #view-latency .lt-target-main strong,#view-latency .lt-target-main small,#view-latency .lt-target-stats strong,#view-latency .lt-target-stats small{display:block}
        #view-latency .lt-target-main small,#view-latency .lt-target-stats small{color:var(--muted);font-size:10px;margin-top:3px}
        #view-latency .lt-target-stats{text-align:right}
        #view-latency .lt-target-stats strong{font-size:11px}
        #view-latency .lt-badge{font-size:9px;padding:4px 6px;border-radius:20px;white-space:nowrap;background:color-mix(in srgb,var(--warn) 12%,transparent)}
        #view-latency .lt-badge.ok{color:var(--up);background:color-mix(in srgb,var(--up) 12%,transparent)}
        #view-latency .lt-badge.warn{color:var(--warn)}
        #view-latency .lt-badge.bad{color:var(--down);background:color-mix(in srgb,var(--down) 12%,transparent)}
        #view-latency .lt-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px;margin-bottom:14px}
        #view-latency .lt-kpi{border:1px solid var(--line);border-radius:9px;padding:11px}
        #view-latency .lt-kpi small{display:block;color:var(--muted);font-size:10px}
        #view-latency .lt-kpi strong{display:block;font-size:18px;margin-top:5px}
        #view-latency .lt-toolbar{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:12px}
        #view-latency .lt-ranges{display:flex;gap:5px;flex-wrap:wrap}
        #view-latency .lt-range,#view-latency .lt-refresh{border:1px solid var(--line);background:transparent;color:var(--text);border-radius:7px;padding:7px 10px;font-size:11px;cursor:pointer}
        #view-latency .lt-range.active{border-color:var(--accent);color:var(--accent);background:color-mix(in srgb,var(--accent) 8%,transparent)}
        #view-latency .lt-chart-wrap{width:100%;overflow:hidden}
        #view-latency .lt-chart{width:100%;height:auto;display:block;overflow:visible}
        #view-latency .lt-legend{display:flex;gap:16px;flex-wrap:wrap;color:var(--muted);font-size:10px;margin-top:8px}
        #view-latency .lt-key{display:inline-block;width:12px;height:4px;border-radius:3px;background:var(--accent);margin-right:5px;vertical-align:middle}
        #view-latency .lt-key.band{height:8px;opacity:.3}
        #view-latency .lt-key.loss{background:var(--warn)}
        #view-latency .lt-empty{padding:30px 12px;text-align:center;color:var(--muted);font-size:12px}
        #view-latency .lt-details{display:flex;gap:16px;flex-wrap:wrap;color:var(--muted);font-size:10px;margin-top:12px}
        @media(max-width:850px){#view-latency .lt-layout{grid-template-columns:1fr}}
        @media(max-width:560px){#view-latency .lt-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}}
      </style>
      ${banner}
      <div class="lt-layout">
        <section class="lt-panel">
          <h3>Monitored devices</h3>
          <p class="lt-muted">Enabled ARCH devices are included automatically.</p>
          <div class="lt-targets">
            ${targetRows || '<div class="lt-empty">No enabled devices are available as latency targets.</div>'}
          </div>
        </section>
        <section class="lt-panel">
          <div class="lt-toolbar">
            <div>
              <h3>${target ? esc(target.id) : 'Latency history'}</h3>
              <div class="lt-muted">${target ? `${esc(target.ip)} · ${esc(target.site || 'Unassigned site')}` : 'Select a monitored device'}</div>
            </div>
            <div class="lt-ranges">${ranges}<button class="lt-refresh" type="button" data-refresh>Refresh</button></div>
          </div>
          <div class="lt-kpis">
            <div class="lt-kpi"><small>Latest median RTT</small><strong>${fmt(latest?.median_ms)}</strong></div>
            <div class="lt-kpi"><small>Latest packet loss</small><strong>${pct(latest?.loss_pct)}</strong></div>
            <div class="lt-kpi"><small>Latest jitter</small><strong>${fmt(latest?.jitter_ms)}</strong></div>
            <div class="lt-kpi"><small>Availability · selected period</small><strong>${pct(availability)}</strong></div>
          </div>
          ${chartMarkup(rows)}
          <div class="lt-details">
            <span>Last measurement: ${esc(dateText(latest?.collected_at))}</span>
            <span>Measurements: ${rows.length}</span>
            <span>Retention: ${state.status?.retention_days ?? 30} days</span>
          </div>
        </section>
      </div>`;

    if (!view.dataset.latencyEvents) {
      view.addEventListener('click', async event => {
        const deviceButton = event.target.closest('[data-device]');
        const rangeButton = event.target.closest('[data-range]');
        if (deviceButton) {
          state.selected = deviceButton.dataset.device;
          await loadData();
        } else if (rangeButton) {
          state.range = Number(rangeButton.dataset.range);
          await loadData();
        } else if (event.target.closest('[data-refresh]')) {
          await loadData();
        }
      });
      view.dataset.latencyEvents = '1';
    }
  }

  ARCH.loaders.push(loadData);
  ARCH_APP.RENDER.latency = render;

  // Refresh measurements from the API while this view is active.
  // This only performs GET requests; it never starts an ICMP collection.
  setInterval(() => {
    if (ARCH_APP.active === 'latency') loadData();
  }, 60000);
})();
