/* Configurations and Config drift tabs. */
(() => {
  const { api } = ARCH, { S, toast } = ARCH_APP;

  ARCH.loaders.push(async () => {
    const data = await api('/configs');
    S.cfg = {};
    // The existing renderers expect an entry only when at least one backup exists.
    data.filter(c => c.versions.length && S.devices.some(d => d.id === c.id))
        .forEach(c => { S.cfg[c.id] = { baseline: c.baseline, versions: c.versions, fail: c.fail }; });
  });

  ARCH_HOOKS.backupNow = (id, statusEl) => {
    if (!ARCH.online) return false;                 // offline: let the built-in demo handle it
    run(id, statusEl);
  };
  const run = async (id, statusEl) => {
    if (statusEl) statusEl.textContent = 'Backing up…';
    try {
      const r = await api(`/devices/${encodeURIComponent(id)}/backup`, { method: 'POST', body: JSON.stringify({ trigger: 'Manual backup' }) });
      toast(r.ok ? (r.changed ? `Backed up ${id}. The configuration changed.` : `Backed up ${id}. No changes since the last backup.`) : `Backup failed for ${id}: ${r.error}`);
    } catch (e) { toast(`Backup failed for ${id}: ${e.message}`); }
    ARCH.refresh();
  };

  ARCH_HOOKS.acceptBaseline = id => {
    if (!ARCH.online) return false;
    accept(id);
  };
  const accept = async id => {
    try { await api(`/devices/${encodeURIComponent(id)}/baseline`, { method: 'POST' }); toast(`Baseline updated for ${id}.`); }
    catch (e) { toast(`Could not update the baseline: ${e.message}`); }
    ARCH.refresh();
  };
})();
