// Store media tests: trailer upload (streamed, validated, Range-served), the trailer as the
// first gallery slot, the muted trailer in the store's featured slot, and reordering
// screenshots from Edit store page. Starts its own server on a spare port.
//   node scripts/test-media.mjs
import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-media-'));
const PORT = 5391;
const BASE = `http://localhost:${PORT}`;

// A tiny WebM (VP8) trailer. Playwright's Chromium has no H.264, so the browser checks use WebM.
function makeWebm(file, seconds = 3) {
  try {
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=size=640x360:rate=24:duration=${seconds}`, '-c:v', 'libvpx', '-b:v', '300k', file]);
    return fs.readFileSync(file);
  } catch { return null; }
}
const webm = makeWebm(path.join(tmp, 't.webm'), 20); // long enough to still be playing while the carousel is clicked
const webm2 = makeWebm(path.join(tmp, 't2.webm'), 2);
// Fake MP4 header ("ftyp" box) — enough for the server's type sniffing.
const fakeMp4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(4000, 1)]);

function zip(files) {
  const locals = [], centrals = []; let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text), nameBuf = Buffer.from(name), comp = zlib.deflateRawSync(data), crc = zlib.crc32(data);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nameBuf.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nameBuf.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, nameBuf, comp); centrals.push(ch, nameBuf); offset += 30 + nameBuf.length + comp.length;
  }
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]).toString('base64');
}
const pkg = { filename: 'g.zip', dataBase64: zip({ 'manifest.json': JSON.stringify({ name: 'Reel Test', version: '1.0.0', entry: 'index.html', sdk: '1' }), 'index.html': '<!doctype html><p>hi</p>' }) };
// Solid-colour 16×9 PNGs so screenshots are distinguishable.
function png(r, g, b) {
  const w = 16, h = 9, raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set([r, g, b], y * (w * 3 + 1) + 1 + x * 3);
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td)); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return `data:image/png;base64,${Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]).toString('base64')}`;
}

const server = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(PORT), DATA_DIR: path.join(tmp, 'data'), TRAILER_MAX_MB: '2', REQUIRE_APPROVAL: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; server.stdout.on('data', (d) => { log += d; }); server.stderr.on('data', (d) => { log += d; });
for (let i = 0; i < 80 && !log.includes('running'); i++) await wait(100);

const b = await chromium.launch({ channel: 'chromium' }); // full Chromium (new headless): more faithful media playback
try {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  const api = (m, p, d, headers = {}) => page.request.fetch(BASE + p, { method: m, headers: { 'X-Vibe-Client': 'platform', 'Content-Type': 'application/json', ...headers }, data: d, failOnStatusCode: false }).then(async (r) => ({ status: r.status(), body: await r.json().catch(() => null) }));
  const put = (p, buf, type) => page.request.fetch(BASE + p, { method: 'PUT', headers: { 'X-Vibe-Client': 'platform', 'Content-Type': type }, data: buf, failOnStatusCode: false }).then(async (r) => ({ status: r.status(), body: await r.json().catch(() => null) }));

  await api('POST', '/api/auth/signup', { email: `reel-${Date.now()}@example.com`, password: 'password123', displayName: 'Reel' });
  await api('POST', '/api/creator/join', { agree: true });
  const shots = [png(255, 0, 0), png(0, 255, 0), png(0, 0, 255)];
  const pub = await api('POST', '/api/publish', { title: 'Reel Test', priceCents: 0, tags: ['Arcade'], builtWith: ['claude-code'], package: pkg, screenshots: shots });
  check('Test game publishes', pub.status === 200, pub.body?.error);
  const gid = pub.body.gameId;
  const T = `/api/creator/games/${gid}/trailer`;

  // ---------- upload rules ----------
  check('Trailers must be MP4 or WebM (by type)', (await put(T, Buffer.from('hello'), 'video/quicktime')).status === 415);
  check('A file that isn’t really a video is refused', (await put(T, Buffer.alloc(2000, 7), 'video/mp4')).status === 415);
  check('Trailers over the size limit are refused', (await put(T, Buffer.concat([fakeMp4, Buffer.alloc(2.2 * 1024 * 1024)]), 'video/mp4')).status === 413);
  check('Uploading needs a signed-in creator', await (async () => {
    const r = await fetch(BASE + T, { method: 'PUT', headers: { 'X-Vibe-Client': 'platform', 'Content-Type': 'video/mp4' }, body: fakeMp4 });
    return r.status === 401;
  })());
  const up1 = await put(T, fakeMp4, 'video/mp4');
  check('An MP4 trailer uploads', up1.status === 200 && /\/trailer-\w+\.mp4$/.test(up1.body.trailer), up1.body?.error);
  const f1 = path.join(tmp, 'data', 'media', gid, path.basename(up1.body.trailer));
  check('It is stored on disk', fs.existsSync(f1) && fs.statSync(f1).size === fakeMp4.length);
  check('No partial upload files are left behind', !fs.readdirSync(path.join(tmp, 'data', 'media', gid)).some((f) => f.endsWith('.part')));

  // ---------- serving with Range ----------
  const full = await fetch(BASE + up1.body.trailer);
  check('Trailer is served as video/mp4 and advertises ranges', full.status === 200 && full.headers.get('content-type') === 'video/mp4' && full.headers.get('accept-ranges') === 'bytes');
  const part = await fetch(BASE + up1.body.trailer, { headers: { Range: 'bytes=4-11' } });
  check('Range requests return 206 with the right bytes', part.status === 206 && part.headers.get('content-range') === `bytes 4-11/${fakeMp4.length}` && Buffer.from(await part.arrayBuffer()).toString('latin1') === 'ftypisom');
  const tail = await fetch(BASE + up1.body.trailer, { headers: { Range: 'bytes=-10' } });
  check('Suffix ranges work', tail.status === 206 && (await tail.arrayBuffer()).byteLength === 10);
  check('Out-of-range requests get 416', (await fetch(BASE + up1.body.trailer, { headers: { Range: `bytes=${fakeMp4.length + 5}-` } })).status === 416);

  if (!webm) { check('ffmpeg is available to make a test WebM', false); throw new Error('no ffmpeg'); }
  const up2 = await put(T, webm, 'video/webm');
  check('Replacing the trailer works and removes the old file', up2.status === 200 && up2.body.trailer.endsWith('.webm') && !fs.existsSync(f1));
  check('The game page lists the trailer', (await api('GET', `/api/games/${gid}`)).body.media.trailer === up2.body.trailer);

  // ---------- game page: trailer is the first slot ----------
  await page.goto(`${BASE}/app/${gid}`);
  await page.waitForSelector('#stage video');
  const gp = await page.evaluate(async () => {
    const v = document.querySelector('#stage video');
    for (let i = 0; i < 50 && v.currentTime === 0; i++) await new Promise((r) => setTimeout(r, 100));
    const thumbs = [...document.querySelectorAll('#thumbs button')];
    return { first: thumbs[0].classList.contains('thumb-video') && thumbs[0].classList.contains('on'), muted: v.muted, controls: v.controls, playing: v.currentTime > 0, count: thumbs.length };
  });
  check('Game page: the trailer is the first gallery slot and is selected', gp.first && gp.count === 5, JSON.stringify(gp));
  check('Game page: it autoplays muted with controls', gp.muted && gp.controls && gp.playing, JSON.stringify(gp));
  await page.click('#thumbs button[data-i="2"]');
  check('Picking a screenshot replaces the video', await page.evaluate(() => !document.querySelector('#stage video') && !document.querySelector('#stage').classList.contains('is-video')));

  // ---------- store home: featured slot plays the trailer muted ----------
  await page.goto(`${BASE}/store`);
  await page.waitForSelector('#featMain');
  const feat = await page.evaluate(async (gid) => {
    const main = document.querySelector('#featMain');
    const v = main.querySelector('video.feat-video');
    if (!v) return { href: main.getAttribute('href') };
    for (let i = 0; i < 50 && v.currentTime === 0; i++) await new Promise((r) => setTimeout(r, 100));
    const btn = document.querySelector('#featSound');
    return { href: main.getAttribute('href'), muted: v.muted, playing: v.currentTime > 0, btn: !btn.hidden, label: btn.getAttribute('aria-label'), bg: main.style.backgroundImage.length > 0, gid };
  }, gid);
  check('Store home: the featured game with a trailer plays it in place of the banner', feat.href === `/app/${gid}` && feat.playing, JSON.stringify(feat));
  check('Store home: the trailer starts muted, with a sound button', feat.muted === true && feat.btn && /sound on/i.test(feat.label), JSON.stringify(feat));
  // Arrows must stay clickable over a playing trailer (a short timeout catches them being covered).
  await page.hover('#feat'); await page.click('.feat-arrow.next', { timeout: 3000 });
  const next = await page.evaluate(() => ({ video: !!document.querySelector('.feat-video'), btnHidden: document.querySelector('#featSound').hidden }));
  check('Moving to a game without a trailer shows its banner and hides the sound button', !next.video && next.btnHidden, JSON.stringify(next));
  await page.click('.feat-arrow.prev', { timeout: 3000 });
  check('Coming back plays the trailer again, muted', await page.evaluate(() => document.querySelector('.feat-video')?.muted === true));
  // The carousel moves on when the trailer ends (not on the 7s timer).
  await page.mouse.move(5, 5);
  const advanced = await page.evaluate(async (gid) => {
    const v = document.querySelector('.feat-video');
    if (!(v.duration > 0)) await new Promise((r) => v.addEventListener('loadedmetadata', r, { once: true }));
    v.currentTime = Math.max(0, v.duration - 0.2);
    for (let i = 0; i < 40; i++) { if (document.querySelector('#featMain').getAttribute('href') !== `/app/${gid}`) return true; await new Promise((r) => setTimeout(r, 100)); }
    return false;
  }, gid);
  check('When the trailer ends, the carousel moves to the next game', advanced);
  await page.goto(`${BASE}/store`); await page.waitForSelector('.feat-video');
  await page.click('#featSound');
  check('Sound button unmutes (and says so)', await page.evaluate(() => document.querySelector('.feat-video').muted === false && /Mute/.test(document.querySelector('#featSound').getAttribute('aria-label'))));
  await page.click('#featSound');
  check('…and mutes again', await page.evaluate(() => document.querySelector('.feat-video').muted === true && /sound on/i.test(document.querySelector('#featSound').getAttribute('aria-label'))));
  await page.evaluate(() => { window.__featVideo = document.querySelector('.feat-video'); });
  await page.click('#featMain');
  await page.waitForSelector('.game-page');
  check('Leaving the store stops the trailer', await page.evaluate(() => window.__featVideo.paused && !document.querySelector('.feat-video')));

  // Reduced motion: banner only.
  const rm = await b.newContext({ reducedMotion: 'reduce' }); const rmp = await rm.newPage();
  await rmp.goto(`${BASE}/store`); await rmp.waitForSelector('#featMain');
  check('Reduced-motion visitors get the banner, not autoplaying video', await rmp.evaluate(() => !document.querySelector('.feat-video')));
  await rm.close();

  // ---------- a trailer whose file has gone missing (e.g. a server that lost its disk) ----------
  const trailerUrl = (await api('GET', `/api/games/${gid}`)).body.media.trailer;
  const trailerFile = path.join(tmp, 'data', 'media', gid, path.basename(trailerUrl));
  fs.renameSync(trailerFile, `${trailerFile}.away`);
  const miss = (await api('GET', '/api/admin/settings')).body.missingFiles ?? [];
  check('Admin settings report the missing trailer', miss.some((m) => m.id === gid && m.missing.includes('trailer')), JSON.stringify(miss));
  // A fresh browser profile, so the earlier download isn't replayed from the HTTP cache.
  const fresh = await b.newContext({ viewport: { width: 1280, height: 900 } }); const fp = await fresh.newPage();
  fp.on('pageerror', (e) => errors.push(e.message));
  await fp.goto(`${BASE}/store`); await fp.waitForSelector('#featMain');
  await fp.mouse.move(5, 5);
  const broken = await fp.evaluate(async (gid) => {
    for (let i = 0; i < 50 && document.querySelector('.feat-video'); i++) await new Promise((r) => setTimeout(r, 100));
    const main = document.querySelector('#featMain');
    return { video: !!document.querySelector('.feat-video'), href: main.getAttribute('href'), bg: main.style.backgroundImage.length > 0, btnHidden: document.querySelector('#featSound').hidden, gid };
  }, gid);
  check('Store home: a missing trailer falls back to the banner', !broken.video && broken.href === `/app/${gid}` && broken.bg && broken.btnHidden, JSON.stringify(broken));
  const rotated = await fp.evaluate(async (gid) => {
    for (let i = 0; i < 90; i++) { if (document.querySelector('#featMain').getAttribute('href') !== `/app/${gid}`) return true; await new Promise((r) => setTimeout(r, 100)); }
    return false;
  }, gid);
  check('…and the carousel keeps rotating', rotated);
  await fp.goto(`${BASE}/app/${gid}`);
  check('Game page: a missing trailer shows the banner with a note, not a black box', await fp.waitForSelector('#stage .gp-video-error', { timeout: 5000 }).then(() => true).catch(() => false));
  check('Admin console shows a missing-files warning', await page.goto(`${BASE}/admin`).then(() => page.waitForSelector('.adm-alert', { timeout: 5000 })).then(() => true).catch(() => false));
  await fresh.close();
  fs.renameSync(`${trailerFile}.away`, trailerFile);
  check('With the file back, nothing is reported missing', !((await api('GET', '/api/admin/settings')).body.missingFiles ?? []).length);

  // ---------- screenshots: reorder / keep / add via the API ----------
  const before = (await api('GET', `/api/games/${gid}`)).body.media.screenshots;
  const r1 = await api('PATCH', `/api/creator/games/${gid}`, { media: { screenshots: [before[2], before[0], before[1]] } });
  check('Screenshots can be reordered without re-uploading', r1.status === 200 && JSON.stringify(r1.body.game.media.screenshots) === JSON.stringify([before[2], before[0], before[1]]), r1.body?.error);
  const r2 = await api('PATCH', `/api/creator/games/${gid}`, { media: { screenshots: [before[1], png(10, 10, 10)] } });
  const s2 = r2.body.game.media.screenshots;
  check('Screenshots can be dropped and new ones added in the same save', r2.status === 200 && s2.length === 2 && s2[0] === before[1] && s2[1] !== before[1] && s2[1].startsWith(`/user-media/${gid}/`));
  check('Only the game’s own screenshot URLs are accepted', (await api('PATCH', `/api/creator/games/${gid}`, { media: { screenshots: ['/media/voidrunner/shot1.png'] } })).status === 400);
  await api('PATCH', `/api/creator/games/${gid}`, { media: { screenshots: [png(200, 0, 0), png(0, 200, 0), png(0, 0, 200)] } });

  // ---------- Edit store page UI ----------
  await page.goto(`${BASE}/publish`);
  await page.click(`[data-edit="${gid}"]`);
  await page.waitForSelector('#editShots .shot-tile');
  const urls = () => page.$$eval('#editShots .shot-tile', (ts) => ts.map((t) => t.style.backgroundImage));
  const u0 = await urls();
  check('Edit store page shows the current screenshots, numbered', u0.length === 3 && (await page.$$eval('#editShots .shot-n', (n) => n.map((x) => x.textContent).join())) === '1,2,3');
  check('Edit store page shows the current trailer', await page.$eval('#trailerEdit video', (v) => v.getAttribute('src')) === up2.body.trailer);
  await page.click('#editShots .shot-tile[data-i="0"] [data-move="1"]');
  const u1 = await urls();
  check('Arrow buttons move a screenshot', u1[0] === u0[1] && u1[1] === u0[0]);
  await page.dragAndDrop('#editShots .shot-tile[data-i="2"]', '#editShots .shot-tile[data-i="0"]');
  const u2 = await urls();
  check('Drag and drop reorders screenshots', u2[0] === u1[2] && u2[1] === u1[0] && u2[2] === u1[1], JSON.stringify(u2.map((x) => x.slice(-20))));
  await page.setInputFiles('#editShots .shot-add input', { name: 'new.png', mimeType: 'image/png', buffer: Buffer.from(png(255, 255, 0).split(',')[1], 'base64') });
  await page.waitForSelector('#editShots .shot-new');
  check('New screenshots can be added in the manager', (await urls()).length === 4);
  await page.setInputFiles('#trailerEdit input[type=file]', { name: 'new-trailer.webm', mimeType: 'video/webm', buffer: webm2 });
  check('Choosing a new trailer shows it will upload on save', /new-trailer\.webm/.test(await page.textContent('#trailerEdit')));
  const want = (await urls()).map((x) => /url\("?([^")]+)"?\)/.exec(x)[1]);
  await page.click('#editSave');
  await page.waitForSelector('#editForm', { state: 'detached' });
  const after = (await api('GET', `/api/games/${gid}`)).body.media;
  check('Saving keeps the new screenshot order', after.screenshots.length === 4 && after.screenshots.slice(0, 3).join() === want.slice(0, 3).join(), JSON.stringify(after.screenshots));
  check('Saving uploads the new trailer', after.trailer && after.trailer !== up2.body.trailer && after.trailer.endsWith('.webm'));

  await page.click(`[data-edit="${gid}"]`);
  await page.waitForSelector('#trailerEdit [data-trailer=remove]');
  await page.click('#trailerEdit [data-trailer=remove]');
  await page.click('#editSave');
  await page.waitForSelector('#editForm', { state: 'detached' });
  check('Removing the trailer works', !(await api('GET', `/api/games/${gid}`)).body.media.trailer);
  await page.goto(`${BASE}/app/${gid}`); await page.waitForSelector('#thumbs button');
  check('Without a trailer the gallery is back to banner + screenshots', await page.evaluate(() => !document.querySelector('.thumb-video') && !document.querySelector('#stage video')));

  // ---------- Publish form: trailer + screenshot manager ----------
  await page.goto(`${BASE}/publish`); await page.waitForSelector('#pubForm');
  check('Publish form has a trailer field and the screenshot manager', !!(await page.$('input[name=trailer]')) && !!(await page.$('#pubShots .shot-add')));
  check('Too-big trailers are caught before uploading', await (async () => {
    await page.setInputFiles('input[name=trailer]', { name: 'huge.mp4', mimeType: 'video/mp4', buffer: Buffer.alloc(2.5 * 1024 * 1024) });
    await page.waitForSelector('.toast', { timeout: 3000 }).catch(() => null);
    return (await page.$eval('input[name=trailer]', (i) => i.files.length)) === 0;
  })());

  check('No page errors', errors.length === 0, errors.join(' | '));
} catch (err) {
  console.error(err);
  check('Test run completed', false, err.message);
} finally {
  await b.close();
  server.kill();
  await wait(300);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
}
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
