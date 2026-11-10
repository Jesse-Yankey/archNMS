/* ARCH Interface Monitoring
   Live interface statistics and historical traffic.
*/
(() => {
  const { api } = ARCH;
  const { S, RENDER } = ARCH_APP;

  let selectedDevice = null;
  let selectedInterface = null;
  let summary = null;
  let monitoring = null;
  let history = null;
  let hours = 24;
  let loading = false;
  let error = '';

  const $ = id => document.getElementById(id);

  const formatRate = value =>
    value == null ? '—' : `${Number(value).toFixed(3)} Mbps`;

  const formatCount = value =>
    value == null ? '—' : Number(value).toLocaleString();

  const statusText = value =>
    value === 1 ? 'Up' : value === 2 ? 'Down' : 'Unknown';

  const statusClass = value =>
    value === 1 ? 'up' : value === 2 ? 'down' : '';

  async function loadDevice(deviceId) {
    if (!deviceId) return;

    selectedDevice = deviceId;
    selectedInterface = null;
    summary = null;
    monitoring = null;
    history = null;
    error = '';
    loading = true;
    render();

    try {
      const id = encodeURIComponent(deviceId);

      const [s, m] = await Promise.all([
        api(`/devices/${id}/interface-summary`),
        api(`/devices/${id}/interface-monitoring`)
      ]);

      summary = s;
      monitoring = m;

      if (monitoring.interfaces?.length) {
        selectedInterface = monitoring.interfaces[0].interface_index;
        await loadHistory();
      }
    } catch (e) {
      error = e.message;
    } finally {
      loading = false;
      render();
    }
  }

  async function loadHistory() {
    if (!selectedDevice || selectedInterface == null) return;

    try {
      const id = encodeURIComponent(selectedDevice);
      history = await api(
        `/devices/${id}/interfaces/${selectedInterface}/history?hours=${hours}`
      );
    } catch (e) {
      history = null;
      error = e.message;
    }
  }

  function render() {
    const view = $('view-interfaces');
    if (!view) return;

    const devices = S.devices || [];

    if (!devices.length) {
      view.innerHTML = '<p class="empty">No registered devices available.</p>';
      return;
    }

    if (!selectedDevice || !devices.some(d => d.id === selectedDevice)) {
      selectedDevice = devices[0].id;
    }

    const device = devices.find(d => d.id === selectedDevice);

    view.innerHTML = `
      <div class="toolbar">
        <label>
          <span class="note">Select device</span><br>
          <select class="ctl" id="if-device">
            ${devices.map(d => `
              <option value="${escapeHTML(d.id)}"
                ${d.id === selectedDevice ? 'selected' : ''}>
                ${escapeHTML(d.id)} — ${escapeHTML(d.ip || '—')}
              </option>
            `).join('')}
          </select>
        </label>
        <span class="grow"></span>
        <button class="ghost" id="if-refresh" ${loading ? 'disabled' : ''}>
          ${loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <div class="sectionhead">
        <div>
          <h2>${escapeHTML(device.id)}</h2>
          <p>${escapeHTML(device.model || '—')} · ${escapeHTML(device.ip || '—')}</p>
        </div>
        <div class="right">
          <span class="pill ${monitoring ? 'ok' : ''}">
            ${monitoring ? 'Interface data loaded' : 'Waiting for telemetry'}
          </span>
        </div>
      </div>

      ${error ? `<p class="empty">${escapeHTML(error)}</p>` : ''}

      ${loading ? '<p class="empty">Loading interface telemetry…</p>' : ''}

      <div id="if-summary"></div>
      <div id="if-table"></div>
      <div id="if-history"></div>
    `;

    $('if-device').addEventListener('change', e => loadDevice(e.target.value));
    $('if-refresh').addEventListener('click', () => loadDevice(selectedDevice));

    renderSummary();
    renderTable();
    renderHistory();
  }

  function renderSummary() {
    const target = $('if-summary');
    if (!target || !summary) return;

    const items = [
      ['Total interfaces', summary.interface_count],
      ['Physical up', summary.physical_up],
      ['Physical down', summary.physical_down],
      ['Logical interfaces', summary.logical_interfaces],
      ['Inbound traffic', formatRate(summary.physical_inbound_mbps)],
      ['Outbound traffic', formatRate(summary.physical_outbound_mbps)]
    ];

    target.innerHTML = `
      <div class="stats">
        ${items.map(([label, value]) => `
          <div class="stat">
            <div class="n mono">${escapeHTML(String(value ?? '—'))}</div>
            <div class="l">${escapeHTML(label)}</div>
          </div>
        `).join('')}
      </div>
    `;
  }

  function renderTable() {
    const target = $('if-table');
    if (!target || !monitoring) return;

    const rows = monitoring.interfaces || [];

    target.innerHTML = `
      <div class="sectionhead">
        <h2>Interface status</h2>
        <p>${rows.length} interfaces discovered</p>
      </div>

      <div class="card scroll">
        <table>
          <thead>
            <tr>
              <th>Interface</th>
              <th>Description</th>
              <th>Admin</th>
              <th>Operational</th>
              <th class="num">Inbound</th>
              <th class="num">Outbound</th>
              <th class="num">Cumulative errors</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(p => {
              const errors = Number(p.in_errors || 0) +
                             Number(p.out_errors || 0);

              return `
                <tr class="clickable ${p.interface_index === selectedInterface ? 'sel' : ''}"
                    data-interface="${p.interface_index}">
                  <td><span class="name">${escapeHTML(p.name)}</span></td>
                  <td>${escapeHTML(p.description || '—')}</td>
                  <td><span class="pill ${statusClass(p.admin_status)}">
                    ${statusText(p.admin_status)}
                  </span></td>
                  <td><span class="pill ${statusClass(p.oper_status)}">
                    ${statusText(p.oper_status)}
                  </span></td>
                  <td class="num">${p.oper_status === 1 ? formatRate(p.in_mbps) : '—'}</td>
                  <td class="num">${p.oper_status === 1 ? formatRate(p.out_mbps) : '—'}</td>
                  <td class="num">${formatCount(errors)}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;

    target.querySelectorAll('[data-interface]').forEach(row => {
      row.addEventListener('click', async () => {
        selectedInterface = Number(row.dataset.interface);
        history = null;
        renderTable();
        await loadHistory();
        renderHistory();
      });
    });
  }

  function renderHistory() {
    const target = $('if-history');
    if (!target) return;

    const samples = history?.history || [];

    const validSamples = samples.filter(p =>
      (p.in_mbps != null && Number.isFinite(Number(p.in_mbps))) ||
      (p.out_mbps != null && Number.isFinite(Number(p.out_mbps)))
    );

    const datedSamples = samples
      .map(p => ({
        ...p,
        timestamp: new Date(p.collected_at).getTime()
      }))
      .filter(p => Number.isFinite(p.timestamp));

    const latestTime = datedSamples.length
      ? Math.max(...datedSamples.map(p => p.timestamp))
      : null;

    const windowStart = latestTime == null
      ? null
      : latestTime - hours * 3600000;

    const windowEnd = latestTime;

    const W = 1000, H = 260;
    const left = 65, right = 20, top = 18, bottom = 42;
    const plotW = W - left - right;
    const plotH = H - top - bottom;

    const values = validSamples.flatMap(p =>
      [p.in_mbps, p.out_mbps]
        .filter(v => v != null && Number.isFinite(Number(v)))
        .map(Number)
    );

    // Scale to the actual traffic range, including very small rates.
    const maxValue = Math.max(0.001, ...values);
    const scaleMax = maxValue * 1.15;

    const x = timestamp => {
      if (windowStart == null || windowEnd <= windowStart) {
        return left + plotW / 2;
      }

      return left +
        ((timestamp - windowStart) / (windowEnd - windowStart)) * plotW;
    };

    const y = value =>
      top + plotH - (Number(value) / scaleMax) * plotH;

    function makePath(key) {
      const paths = [];
      let current = [];

      datedSamples.forEach(p => {
        const value = p[key];

        if (value == null || !Number.isFinite(Number(value))) {
          if (current.length) paths.push(current);
          current = [];
          return;
        }

        current.push(
          `${current.length ? 'L' : 'M'}${x(p.timestamp).toFixed(1)},${y(value).toFixed(1)}`
        );
      });

      if (current.length) paths.push(current);

      return paths.map(points => points.join(' '));
    }

    const inboundPaths = makePath('in_mbps');
    const outboundPaths = makePath('out_mbps');

    const grid = Array.from({ length: 5 }, (_, i) => {
      const value = scaleMax * (i / 4);
      const yy = y(value);

      return `
        <line x1="${left}" x2="${W - right}"
          y1="${yy}" y2="${yy}"
          stroke="var(--line-soft)" stroke-width="1"/>

        <text x="${left - 10}" y="${yy + 4}"
          text-anchor="end"
          fill="var(--ink-3)"
          font-size="7">
          ${value.toFixed(3)}
        </text>
      `;
    }).join('');

    const timeLabels = [0, 0.5, 1].map(position => {
      const timestamp = windowStart +
        (windowEnd - windowStart) * position;

      const label = new Date(timestamp).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit'
      });

      return `
        <text x="${left + plotW * position}" y="${H - 12}"
          text-anchor="middle"
          fill="var(--ink-3)"
          font-size="7">
          ${escapeHTML(label)}
        </text>
      `;
    }).join('');

    const coverageHours = datedSamples.length > 1
      ? (windowEnd - Math.min(...datedSamples.map(p => p.timestamp))) / 3600000
      : 0;

    const formatDuration = value => {
      const totalMinutes = Math.round(value * 60);
      const h = Math.floor(totalMinutes / 60);
      const m = totalMinutes % 60;

      return h ? `${h}h ${m}m` : `${m}m`;
    };

    const firstDate = datedSamples.length
      ? new Date(Math.min(...datedSamples.map(p => p.timestamp)))
      : null;

    const lastDate = datedSamples.length
      ? new Date(windowEnd)
      : null;

    const dateRange = firstDate && lastDate
      ? `${firstDate.toLocaleString()} – ${lastDate.toLocaleString()}`
      : 'No timestamp data available';

    const chart = validSamples.length ? `
      <svg viewBox="0 0 ${W} ${H}" role="img"
        aria-label="Historical inbound and outbound interface traffic"
        style="width:100%;height:auto;display:block">

        ${grid}

        <line x1="${left}" x2="${left}"
          y1="${top}" y2="${top + plotH}"
          stroke="var(--line-soft)"/>

        ${inboundPaths.map(d => `
          <path d="${d}" fill="none"
            stroke="var(--accent)"
            stroke-width="2.5"
            stroke-linejoin="round"
            stroke-linecap="round"/>
        `).join('')}

        ${outboundPaths.map(d => `
          <path d="${d}" fill="none"
            stroke="var(--up)"
            stroke-width="2.5"
            stroke-linejoin="round"
            stroke-linecap="round"/>
        `).join('')}

        ${timeLabels}
      </svg>
    ` : `
      <p class="empty">
        No valid traffic-rate samples are available for this period yet.
      </p>
    `;

    target.innerHTML = `
      <div class="card" style="margin-top:18px">

        <h2>
          Traffic history
          <span class="count">${hours} ${hours === 1 ? 'hour' : 'hours'}</span>
        </h2>

        <div style="padding:12px 16px">

          <div class="toolbar">
            <label class="note">
              Interface
              <select class="ctl" id="if-history-interface">
                ${(monitoring?.interfaces || []).map(p => `
                  <option value="${p.interface_index}"
                    ${p.interface_index === selectedInterface ? 'selected' : ''}>
                    ${escapeHTML(p.name)}
                  </option>
                `).join('')}
              </select>
            </label>

            <div class="seg" id="if-period">
              ${[[1,'1h'],[6,'6h'],[24,'24h'],[168,'7d']].map(([h,label]) => `
                <button type="button" data-hours="${h}"
                  aria-pressed="${hours === h}">
                  ${label}
                </button>
              `).join('')}
            </div>
          </div>

          <div class="legend" style="margin:8px 0 10px">
            <span><i style="background:var(--accent)"></i>Inbound Mbps</span>
            <span><i style="background:var(--up)"></i>Outbound Mbps</span>
          </div>

          ${chart}

          <div style="padding:8px 0 2px">
            <p class="note">
              ${samples.length} historical samples ·
              ${validSamples.length} valid traffic samples
            </p>

            <p class="note" style="margin-top:5px">
              Data coverage: ${formatDuration(coverageHours)}
              of the requested ${formatDuration(hours)} window.
            </p>

            <p class="note" style="margin-top:5px;line-height:1.5">
              ${escapeHTML(dateRange)}
            </p>
          </div>

        </div>
      </div>
    `;

    $('if-history-interface')?.addEventListener('change', async e => {
      selectedInterface = Number(e.target.value);
      history = null;
      await loadHistory();
      renderTable();
      renderHistory();
    });

    $('if-period')?.querySelectorAll('button').forEach(button => {
      button.addEventListener('click', async () => {
        hours = Number(button.dataset.hours);
        history = null;
        await loadHistory();
        renderHistory();
      });
    });
  }

  function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[ch]);
  }

  RENDER.interfaces = render;

  ARCH.loaders.push(async () => {
    const devices = S.devices || [];

    if (!devices.length) return;

    if (!selectedDevice || !devices.some(d => d.id === selectedDevice)) {
      selectedDevice = devices[0].id;
    }

    await loadDevice(selectedDevice);
  });
})();
