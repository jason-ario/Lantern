// Builds + validates Nightpaw's world map → packages/nightpaw/1.0.0/assets/world.json
// Rooms live in one global tile grid (ox, oy). Openings line up across rooms, so
// moving between rooms is just "which room contains the cat now".
//
// Legend:  # rock   = one-way ledge   ^ thorns   S candle shrine   P new-game start
//          c crawler   w wisp   g glimmer cluster   D Moth Wings   A Shadow Dash
//          H heart vessel   B the Hollow Warden   0-9 room openings (air)
import fs from 'node:fs';
import path from 'node:path';

const r = (n, ch = '.') => ch.repeat(n);
const W = (n) => '#'.repeat(n);

const rooms = [
  {
    id: 'gate', name: 'Ashen Gate', ox: 0, oy: 0, hue: 250,
    rows: [
      W(40), W(40),
      W(4) + r(6) + W(4) + r(8) + W(6) + r(8) + W(4),
      '##' + r(36) + '##',
      '#' + r(38) + '#',
      '#' + r(38) + '#',
      '#' + r(38) + '#',
      '#' + r(38) + '#',
      '#' + r(22) + '===' + r(13) + '#',
      '#' + r(38) + '#',
      '#' + r(14) + '===' + r(21) + '#',
      '#' + r(38) + '#',
      '#' + r(38) + '1',
      '#' + '..P......S' + r(18) + 'g' + r(9) + '1',
      '#' + r(38) + '1',
      W(40), W(40),
    ],
  },
  {
    id: 'tunnels', name: 'Weeping Tunnels', ox: 40, oy: 0, hue: 220,
    rows: [
      W(50), W(50),
      W(10) + r(12) + W(6) + r(14) + W(8),
      '###' + r(44) + '###',
      '#' + r(48) + '#',
      '#' + r(48) + '#',
      '#' + r(48) + '#',
      '#' + r(30) + W(5) + r(13) + '#',
      '#' + r(48) + '#',
      '#' + r(8) + '====' + r(36) + '#',
      '#' + r(48) + '#',
      '#' + r(48) + '#',
      '1' + r(48) + '2',
      '1' + r(6) + 'c' + r(12) + 'g' + r(10) + 'c' + r(10) + 'g' + r(6) + '2',
      '1' + r(35) + '^^' + r(11) + '2',
      W(24) + '...' + W(23),
      W(24) + '333' + W(23),
    ],
  },
  {
    id: 'well', name: 'The Hollow Well', ox: 90, oy: -17, hue: 200,
    rows: (() => {
      const rows = [];
      rows.push(W(13) + '4444' + W(13));
      rows.push(W(9) + r(12) + W(9));
      rows.push(W(6) + r(18) + W(6));
      for (let i = 3; i <= 31; i++) rows.push((i >= 29 ? '2' : '#') + r(28) + '#');
      rows.push(W(30), W(30));
      // zig-zag ledges 5 rows apart: unreachable without Moth Wings (double jump)
      const left = '#' + r(7) + W(7) + r(14) + '#';   // cols 8-14
      const right = '#' + r(16) + W(7) + r(5) + '#';  // cols 17-23
      rows[3] = left; rows[7] = right; rows[12] = left; rows[17] = right; rows[22] = left; rows[27] = right;
      rows[6] = '#' + r(19) + 'g' + r(8) + '#';
      rows[15] = '#' + r(13) + 'w' + r(14) + '#';
      rows[21] = '#' + r(10) + 'g' + r(17) + '#';
      rows[26] = '#' + r(19) + 'g' + r(8) + '#';
      rows[31] = '2' + r(8) + 'c' + r(19) + '#';
      return rows;
    })(),
  },
  {
    id: 'hollow', name: 'Drowned Hollow', ox: 40, oy: 17, hue: 180,
    rows: [
      W(24) + '333' + W(17),
      W(22) + r(7) + W(15),
      W(18) + r(14) + W(12),
      '##' + r(20) + '=======' + r(13) + '##',
      '#' + r(42) + '#',
      '#' + r(42) + '#',
      '#' + r(21) + '=======' + r(14) + '#',
      '#' + r(10) + 'w' + r(20) + 'w' + r(10) + '#',
      '#' + r(42) + '#',
      '#' + r(21) + '=======' + r(14) + '#',
      '#' + r(42) + '#',
      '#' + r(42) + '#',
      '#' + r(21) + '=======' + r(14) + '5',
      '#' + '....D' + r(28) + 'c' + r(8) + '5',
      '#' + r(7) + '^^' + r(33) + '5',
      W(44), W(44),
    ],
  },
  {
    id: 'shrine', name: 'Shrine of Whispers', ox: 84, oy: 17, hue: 40,
    rows: [
      W(32), W(32),
      '###' + r(26) + '###',
      '#' + r(30) + '#',
      '#' + r(30) + '#',
      '#' + r(22) + 'H' + r(7) + '#',
      '#' + r(20) + W(5) + r(5) + '#',
      '#' + r(30) + '#',
      '#' + r(30) + '#',
      '#' + r(30) + '#',
      '#' + r(30) + '#',
      '#' + r(15) + '====' + r(11) + '#',
      '5' + r(30) + '#',
      '5' + r(8) + 'S' + r(21) + '#',
      '5' + r(30) + '#',
      W(32), W(32),
    ],
  },
  {
    id: 'loft', name: 'The Bell Loft', ox: 95, oy: -34, hue: 280,
    rows: [
      W(40), W(40),
      W(8) + r(24) + W(8),
      '###' + r(34) + '###',
      '#' + r(38) + '#',
      '#' + r(12) + 'w' + r(25) + '#',
      '#' + r(38) + '#',
      '#' + r(38) + '#',
      '#' + r(28) + 'A' + r(9) + '#',
      '#' + r(26) + '=====' + r(7) + '#',
      '#' + r(38) + '#',
      '#' + r(38) + '#',
      '#' + r(17) + '====' + r(17) + '6',
      '#' + r(20) + 'c' + r(8) + 'S' + r(8) + '6',
      '#' + r(38) + '6',
      W(8) + r(4) + W(28),
      W(8) + '4444' + W(28),
    ],
  },
  {
    id: 'hall', name: "Warden's Hall", ox: 135, oy: -34, hue: 330,
    rows: (() => {
      const rows = [W(44), W(44), W(44)];
      for (let i = 3; i <= 11; i++) rows.push('#' + r(13) + W(17) + r(12) + '#');
      rows[6] = '#' + r(6) + 'w' + r(6) + W(17) + r(5) + 'w' + r(6) + '#';
      rows.push('6' + r(42) + '7');
      rows.push('6' + r(4) + 'c' + r(30) + 'g' + r(6) + '7');
      rows.push('6' + r(18) + '^^^^^' + r(19) + '7');
      rows.push(W(44), W(44));
      return rows;
    })(),
  },
  {
    id: 'throne', name: 'Throne of the Warden', ox: 179, oy: -34, hue: 350,
    rows: [
      W(34), W(34),
      W(4) + r(26) + W(4),
      '#' + r(32) + '#',
      '#' + r(32) + '#',
      '#' + r(32) + '#',
      '#' + r(32) + '#',
      '#' + r(32) + '#',
      '#' + r(32) + '#',
      '#' + r(32) + '#',
      '#' + r(5) + '====' + r(14) + '====' + r(5) + '#',
      '#' + r(32) + '#',
      '7' + r(32) + '#',
      '7' + r(21) + 'B' + r(10) + '#',
      '7' + r(32) + '#',
      W(34), W(34),
    ],
  },
];

// ---------- validation ----------
const errors = [];
for (const room of rooms) {
  const w = room.rows[0].length;
  room.w = w; room.h = room.rows.length;
  room.rows.forEach((row, i) => { if (row.length !== w) errors.push(`${room.id} row ${i} has ${row.length} chars, expected ${w}`); });
}
const solidAt = (gx, gy) => {
  const room = rooms.find((q) => gx >= q.ox && gx < q.ox + q.w && gy >= q.oy && gy < q.oy + q.h);
  if (!room) return null;
  const ch = room.rows[gy - room.oy][gx - room.ox];
  return { room, solid: ch === '#' };
};
for (const room of rooms) {
  room.rows.forEach((row, y) => [...row].forEach((ch, x) => {
    if (!/[0-9]/.test(ch)) return;
    const edges = [];
    if (x === 0) edges.push([-1, 0]); if (x === room.w - 1) edges.push([1, 0]);
    if (y === 0) edges.push([0, -1]); if (y === room.h - 1) edges.push([0, 1]);
    if (!edges.length) errors.push(`${room.id}: opening '${ch}' at ${x},${y} is not on an edge`);
    for (const [dx, dy] of edges) {
      const n = solidAt(room.ox + x + dx, room.oy + y + dy);
      if (!n) errors.push(`${room.id}: opening '${ch}' at ${x},${y} leads outside the world`);
      else if (n.solid) errors.push(`${room.id}: opening '${ch}' at ${x},${y} leads into rock in ${n.room.id}`);
    }
  }));
}
for (let i = 0; i < rooms.length; i++) for (let j = i + 1; j < rooms.length; j++) {
  const a = rooms[i], b = rooms[j];
  if (a.ox < b.ox + b.w && b.ox < a.ox + a.w && a.oy < b.oy + b.h && b.oy < a.oy + a.h) errors.push(`rooms ${a.id} and ${b.id} overlap`);
}
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }

const out = path.resolve('packages/nightpaw/1.0.0/assets/world.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ tile: 16, rooms: rooms.map(({ id, name, ox, oy, hue, rows }) => ({ id, name, ox, oy, hue, rows })) }));
console.log(`world ok: ${rooms.length} rooms → ${out}`);
