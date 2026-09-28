// Builds the creator starter kit from samples/starter:
//   public/creator/vibe-games-starter.zip   (downloadable kit)
//   public/creator/VIBE.md                  (the AI-assistant brief, also linked from /developers)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const src = path.resolve('samples/starter');
fs.mkdirSync('public/creator', { recursive: true });
execFileSync(process.execPath, ['scripts/pack.mjs', src, 'public/creator/vibe-games-starter.zip'], { stdio: 'inherit' });
fs.copyFileSync(path.join(src, 'VIBE.md'), 'public/creator/VIBE.md');
console.log('wrote public/creator/VIBE.md');
