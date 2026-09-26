// Builds the Lantern package into dist/: bundles src/ → game.js (one classic script)
// and copies the page, manifest, Phaser, art and content alongside it.
// Usage: node tools/build.cjs [--check]   (--check also runs the TypeScript checker)
// Needs either `bun` or `esbuild` on the PATH (npm i -D esbuild).
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const sh = (cmd) => execSync(cmd, { cwd: root, stdio: 'inherit' });
const has = (bin) => { try { execSync(`${bin} --version`, { stdio: 'ignore' }); return true; } catch { return false; } };

if (process.argv.includes('--check')) sh('tsc -p tsconfig.json');

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });
if (has('bun')) sh(`bun build src/main.ts --outfile dist/game.js --target browser --format iife`);
else if (has('npx')) sh(`npx esbuild src/main.ts --bundle --format=iife --target=es2020 --outfile=dist/game.js`);
else throw new Error('Need bun or esbuild to bundle');

const copy = (rel) => fs.cpSync(path.join(root, rel), path.join(dist, rel), { recursive: true });
['index.html', 'style.css', 'manifest.json', 'vendor', 'content'].forEach(copy);
fs.mkdirSync(path.join(dist, 'assets'), { recursive: true });
copy('assets/art');
const size = (p) => { let s = 0; for (const f of fs.readdirSync(p, { withFileTypes: true })) s += f.isDirectory() ? size(path.join(p, f.name)) : fs.statSync(path.join(p, f.name)).size; return s; };
console.log(`dist/ ready: ${(size(dist) / 1e6).toFixed(1)} MB`);
