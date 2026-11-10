/* Shared by every converted tab. A tab registers a loader; ARCH.refresh() runs them in order, then redraws once.
   ARCH.online is false when the API can't be reached (e.g. the HTML opened as a file); the built-in demo behaviour then applies. */
window.ARCH = (() => {
  const loaders = [], self = { loaders, online: false };
  self.api = async (path, opts = {}) => {
    const r = await fetch('/api' + path, { ...opts, headers: { 'Content-Type': 'application/json', 'X-ARCH-User': 'nana', ...(opts.headers || {}) } });
    if (!r.ok) {
      const d = (await r.json().catch(() => ({}))).detail;
      throw new Error(typeof d === 'string' ? d : Array.isArray(d) ? d.map(x => x.msg).join('; ') : r.statusText);
    }
    return r.json();
  };
  self.refresh = async () => {
    let ok = true;
    for (const load of loaders) { try { await load(); } catch (e) { ok = false; console.warn('ARCH API unavailable, keeping built-in demo data:', e.message); } }
    self.online = ok; ARCH_APP.rerender();
  };
  return self;
})();
