/* Devices tab: the device list, Add device, Test connection and Remove now go through the backend.
   Telemetry (ports, CPU, uptime) comes from the poller, which isn't built yet, so devices added here
   show "Not polled yet". The 8 sample devices keep their demo telemetry so the other tabs still work. */
(() => {
  const { api } = ARCH, { S } = ARCH_APP, $ = id => document.getElementById(id), dlgAdd = $('dlg-add'), dlgRm = $('dlg-rm');
  const MOCK = new Map(S.devices.map(d => [d.id, d]));
  const MOCK_LINKS = S.links.slice(), MOCK_CHECKS = S.checks.slice(), MOCK_TARGETS = S.targets.slice();

  ARCH.loaders.push(async () => {
    const rows = await api('/devices'), ids = new Set(rows.map(r => r.id));
    S.devices = rows.map(r => {
      const m = MOCK.get(r.id);
      if (m) {
        Object.assign(m, {
          ip: r.ip,
          role: r.role || 'Access',
          site: r.site || undefined,
          driver: r.driver,
          poll_interval: r.poll_interval,
          snmp_version: r.snmp_version,
          ssh_user: r.ssh_user,
          has_ssh_password: r.has_ssh_password,
          has_snmp: r.has_snmp
        });
        return m;
      }
      return {
        id: r.id, role: r.role || 'Access', model: r.model || '—',
        ip: r.ip, site: r.site || undefined,
        driver: r.driver, poll_interval: r.poll_interval,
        snmp_version: r.snmp_version, ssh_user: r.ssh_user,
        has_ssh_password: r.has_ssh_password, has_snmp: r.has_snmp,
        state: 'pending', polled: false,
        cpu: 0, mem: 0, up: '—', sfp: 0, sfpUp: 0, ports: []
      };
    });
    // Sample topology/checks only make sense for devices that exist.
    S.links = MOCK_LINKS.filter(l => ids.has(l.a) && ids.has(l.b));
    S.checks = MOCK_CHECKS.filter(c => ids.has(c.host));
    S.targets = MOCK_TARGETS.filter(t => !t.dev || ids.has(t.dev));
    S.sessions = (S.sessions || []).filter(s => ids.has(s.dev));
  });

  const payload = () => ({
    host: $('a-host').value.trim(), ip: $('a-ip').value.trim(), driver: $('a-drv').value, role: $('a-role').value, site: $('a-site').value.trim(),
    poll_interval: $('a-poll').value, snmp_version: $('a-snmp').value, snmp_community: $('a-comm').value,
    snmp_v3_user: $('a-v3').value.trim(), snmp_v3_sec: $('a-v3-sec').value, snmp_v3_auth: $('a-v3-auth').value, snmp_v3_priv: $('a-v3-priv').value,
    snmp_v3_key: $('a-v3-key').value, snmp_v3_privkey: $('a-v3-privkey').value,
    ssh_user: $('a-user').value.trim(), ssh_password: $('a-pass').value, ssh_enable: $('a-enable').value,
  });

  const online = (id, real) => { const orig = $(id).onclick; $(id).onclick = e => ARCH.online ? real(e) : orig && orig.call($(id), e); };

  online('a-test', async () => {
    if (!ARCH_APP.validateAdd()) return;
    const editId = dlgAdd.dataset.mode === 'edit' ? dlgAdd.dataset.deviceId : null;
    const route = editId
      ? `/devices/${encodeURIComponent(editId)}/test`
      : '/devices/test';

    const b = $('a-test'); b.disabled = true;
    ARCH_APP.showResult(true, ['Testing connection…']);

    try {
      const r = await api(route, {
        method: 'POST',
        body: JSON.stringify(payload())
      });
      ARCH_APP.showResult(r.ok, r.lines);
    } catch (e) {
      ARCH_APP.showResult(false, [e.message]);
    } finally {
      b.disabled = false;
    }
  });

  online('a-save', async () => {
    const v = ARCH_APP.validateAdd();
    if (!v) return;

    const editId = dlgAdd.dataset.mode === 'edit' ? dlgAdd.dataset.deviceId : null;
    const b = $('a-save');
    b.disabled = true;

    try {
      if (editId) {
        await api(`/devices/${encodeURIComponent(editId)}`, {
          method: 'PUT',
          body: JSON.stringify(payload())
        });

        dlgAdd.close();
        ARCH_APP.toast(`${editId} updated. Configuration backup scheduled…`);
      } else {
        await api('/devices', {
          method: 'POST',
          body: JSON.stringify(payload())
        });

        dlgAdd.close();
        ARCH_APP.toast(`${v.host} added. Running the first configuration backup…`);
      }

      await ARCH.refresh();
      setTimeout(ARCH.refresh, 4000);
      setTimeout(ARCH.refresh, 12000);
    } catch (e) {
      ARCH_APP.showResult(false, [e.message]);
    } finally {
      b.disabled = false;
    }
  });

  online('rm-ok', async () => {
    const id = dlgRm.dataset.id, purge = $('rm-hist').checked;
    try {
      await api(`/devices/${encodeURIComponent(id)}?purge=${purge}`, { method: 'DELETE' });
      dlgRm.close(); ARCH_APP.toast(`${id} removed.`);
      await ARCH.refresh(); if (ARCH_APP.active === 'device') ARCH_APP.nav('devices');
    } catch (e) { ARCH_APP.toast(`Could not remove ${id}: ${e.message}`); }
  });
})();
