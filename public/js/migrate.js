// One-time carry-over from the pre-rebrand (Lantern) browser storage, so players
// keep their offline downloads, queued saves and settings after the rename to
// Vibe-Games. Safe to run on every boot: it only acts when old keys exist.
export async function migrateLegacyStorage() {
  try {
    for (const k of Object.keys(localStorage)) {
      if (!k.startsWith('lantern.')) continue;
      const nk = `vibe.${k.slice('lantern.'.length)}`;
      if (localStorage.getItem(nk) === null) localStorage.setItem(nk, localStorage.getItem(k));
      localStorage.removeItem(k);
    }
    const ck = sessionStorage.getItem('lantern.checkout');
    if (ck !== null) { sessionStorage.setItem('vibe.checkout', ck); sessionStorage.removeItem('lantern.checkout'); }
  } catch { /* storage blocked: nothing to migrate */ }

  // Downloaded game files live in Cache Storage, keyed by content hash.
  try {
    if (typeof caches === 'undefined' || !(await caches.has('lantern-packages-v1'))) return;
    const from = await caches.open('lantern-packages-v1');
    const to = await caches.open('vibe-packages-v1');
    for (const req of await from.keys()) {
      const res = await from.match(req);
      if (res) await to.put(new URL(req.url).pathname.replace('/__lantern/', '/__vibe/'), res);
    }
    await caches.delete('lantern-packages-v1');
  } catch { /* best effort — games can always be downloaded again */ }
}
