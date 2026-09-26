// Packs a game folder into a Lantern-ready .zip (manifest.json + index.html at the zip root).
//   node scripts/pack.mjs <gameFolder> [out.zip]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const [, , dir, outArg] = process.argv;
if (!dir) { console.error('usage: node scripts/pack.mjs <gameFolder> [out.zip]'); process.exit(1); }
const root = path.resolve(dir);
const manifestPath = path.join(root, 'manifest.json');
if (!fs.existsSync(manifestPath)) { console.error('No manifest.json in', root); process.exit(1); }
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const out = path.resolve(outArg ?? `${(manifest.name ?? 'game').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${manifest.version ?? '1.0.0'}.zip`);

const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p); else files.push({ name: path.relative(root, p).split(path.sep).join('/'), data: fs.readFileSync(p) });
  }
})(root);

const locals = [], centrals = []; let offset = 0;
for (const { name, data } of files) {
  const nameBuf = Buffer.from(name), comp = zlib.deflateRawSync(data), crc = zlib.crc32(data);
  const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8);
  lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nameBuf.length, 26);
  const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10);
  ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nameBuf.length, 28); ch.writeUInt32LE(offset, 42);
  locals.push(lh, nameBuf, comp); centrals.push(ch, nameBuf); offset += 30 + nameBuf.length + comp.length;
}
const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
fs.writeFileSync(out, Buffer.concat([...locals, cd, end]));
console.log(`packed ${files.length} files → ${out}`);
