// Builds public/creator/skylark-1.0.0.zip from samples/skylark (used by the Publish demo).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

function zip(files) {
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
  return Buffer.concat([...locals, cd, end]);
}
const src = path.resolve('samples/skylark');
const files = fs.readdirSync(src).map((n) => ({ name: n, data: fs.readFileSync(path.join(src, n)) }));
fs.mkdirSync('public/creator', { recursive: true });
fs.writeFileSync('public/creator/skylark-1.0.0.zip', zip(files));
console.log('wrote public/creator/skylark-1.0.0.zip');
