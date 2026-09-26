// Synthesised audio: SFX, ambience drones, a music-box theme and dialogue "voice" blips.
// No audio files — everything is generated with WebAudio. Swap in recorded audio later
// by replacing the functions in `sfx` / `Music`.
import { rand } from './util';

let AC: AudioContext | null = null;
let master: GainNode, sfxBus: GainNode, musicBus: GainNode, ambBus: GainNode;
let noiseBuf: AudioBuffer;
let ambNodes: { stop(): void } | null = null;
let musicTimer: any = null;
let volume = { master: 0.8, music: 0.55, sfx: 0.8 };

function init() {
  if (AC) return;
  try {
    AC = new (window.AudioContext || (window as any).webkitAudioContext)();
    master = AC.createGain(); master.gain.value = volume.master; master.connect(AC.destination);
    sfxBus = AC.createGain(); sfxBus.gain.value = volume.sfx; sfxBus.connect(master);
    musicBus = AC.createGain(); musicBus.gain.value = volume.music; musicBus.connect(master);
    ambBus = AC.createGain(); ambBus.gain.value = 0.9; ambBus.connect(master);
    noiseBuf = AC.createBuffer(1, AC.sampleRate, AC.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    if (pendingAmb) { const p = pendingAmb; pendingAmb = null; Audio.ambience(p); }
    if (pendingMusic) { const p = pendingMusic; pendingMusic = null; Music.play(p); }
  } catch { AC = null; }
}

function tone(freq: number, dur: number, type: OscillatorType = 'sine', vol = 0.1, slide = 0, delay = 0, bus?: GainNode) {
  if (!AC) return;
  const t0 = AC.currentTime + delay;
  const o = AC.createOscillator(), g = AC.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t0);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(bus ?? sfxBus); o.start(t0); o.stop(t0 + dur + 0.02);
}
function noise(dur: number, freq: number, q: number, vol: number, sweep = 0, delay = 0) {
  if (!AC) return;
  const t0 = AC.currentTime + delay;
  const s = AC.createBufferSource(); s.buffer = noiseBuf;
  const f = AC.createBiquadFilter(); f.type = 'bandpass'; f.frequency.setValueAtTime(freq, t0); f.Q.value = q;
  if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(40, freq + sweep), t0 + dur);
  const g = AC.createGain(); g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  s.connect(f).connect(g).connect(sfxBus); s.start(t0); s.stop(t0 + dur);
}
// A plucked music-box note: sine + bright partial with fast decay.
function chime(freq: number, delay = 0, vol = 0.06, bus?: GainNode) {
  if (!AC) return;
  tone(freq, 1.6, 'sine', vol, 0, delay, bus ?? musicBus);
  tone(freq * 2.01, 0.5, 'sine', vol * 0.35, 0, delay, bus ?? musicBus);
  tone(freq * 4.03, 0.15, 'triangle', vol * 0.12, 0, delay, bus ?? musicBus);
}

export const sfx: Record<string, (...a: any[]) => void> = {
  slash: () => noise(0.13, 3200, 1.2, 0.35, -2200),
  hit: () => { tone(160, 0.12, 'square', 0.12, -90); noise(0.09, 900, 1, 0.3); },
  clink: () => tone(1800, 0.08, 'triangle', 0.06, -600),
  jump: () => tone(260, 0.09, 'triangle', 0.05, 180),
  wing: () => { noise(0.18, 1400, 0.6, 0.18, 1200); tone(520, 0.14, 'sine', 0.05, 400); },
  dash: () => noise(0.22, 700, 0.5, 0.35, -400),
  land: () => noise(0.05, 300, 1, 0.12),
  step: () => noise(0.03, rand(500, 800), 2, 0.04),
  hurt: () => { tone(220, 0.35, 'sawtooth', 0.12, -160); noise(0.2, 400, 0.7, 0.3); },
  coin: () => tone(1500 + Math.random() * 400, 0.06, 'sine', 0.04, 500),
  pickup: () => [523, 659, 784, 1046].forEach((f, i) => chime(f, i * 0.09, 0.08, sfxBus)),
  ability: () => { [392, 523, 659, 784, 1046, 1318].forEach((f, i) => chime(f, i * 0.11, 0.08, sfxBus)); noise(1.2, 2000, 0.4, 0.1, 2000); },
  rest: () => [220, 277, 330, 440].forEach((f) => tone(f, 1.6, 'sine', 0.05)),
  roar: () => { tone(65, 1.4, 'sawtooth', 0.22, -25); noise(1.2, 180, 0.6, 0.35, -100); },
  slam: () => { noise(0.45, 160, 0.8, 0.6, -80); tone(55, 0.4, 'sine', 0.3, -20); },
  die: () => { tone(330, 1.2, 'triangle', 0.1, -260); noise(0.6, 600, 0.5, 0.2, -500); },
  enemyDie: () => { noise(0.25, 500, 0.7, 0.3, -350); tone(120, 0.2, 'square', 0.06, -60); },
  shoot: () => { tone(420, 0.1, 'square', 0.05, -200); noise(0.08, 1200, 1, 0.1); },
  croak: () => { tone(110, 0.18, 'square', 0.06, 40); tone(90, 0.2, 'square', 0.05, -20, 0.1); },
  break: () => { noise(0.5, 300, 0.6, 0.5, -200); tone(70, 0.3, 'sine', 0.2, -30); },
  menu: () => tone(880, 0.05, 'sine', 0.04),
  confirm: () => { tone(660, 0.08, 'sine', 0.05); tone(990, 0.12, 'sine', 0.04, 0, 0.06); },
  save: () => chime(1046, 0, 0.04, sfxBus),
  memory: () => { [523, 494, 440, 392, 330].forEach((f, i) => chime(f, i * 0.35, 0.07, sfxBus)); },
  whoosh: () => noise(0.5, 400, 0.4, 0.2, 1600),
  thunder: () => { noise(2.4, 120, 0.5, 0.4, -60); noise(0.6, 900, 0.3, 0.15, -600); },
  gate: () => { noise(0.6, 200, 0.8, 0.4, -100); tone(80, 0.5, 'square', 0.08, -30); },
};

/** Per-speaker "voice": short pitched blips, like mumbling in a music box. */
export function voiceBlip(pitch: number, style: 'soft' | 'squeak' | 'deep' | 'echo' = 'soft') {
  if (!AC) return;
  const f = pitch * (0.9 + Math.random() * 0.25);
  if (style === 'squeak') tone(f, 0.05, 'square', 0.018, f * 0.3);
  else if (style === 'deep') tone(f, 0.1, 'sawtooth', 0.03, -f * 0.2);
  else if (style === 'echo') { tone(f, 0.25, 'sine', 0.025); tone(f, 0.25, 'sine', 0.012, 0, 0.12); }
  else tone(f, 0.07, 'triangle', 0.03);
}

let pendingAmb: string | null = null;
let pendingMusic: string | null = null;
let currentAmb = '';

export const Audio = {
  unlock() { init(); if (AC && AC.state === 'suspended') AC.resume(); },
  get ready() { return !!AC; },
  setVolume(kind: 'master' | 'music' | 'sfx', v: number) {
    volume[kind] = v;
    if (!AC) return;
    ({ master, music: musicBus, sfx: sfxBus } as any)[kind].gain.value = v;
  },
  duckMusic(to: number, secs = 0.6) {
    if (!AC) return;
    musicBus.gain.cancelScheduledValues(AC.currentTime);
    musicBus.gain.linearRampToValueAtTime(to * volume.music, AC.currentTime + secs);
  },
  /** Low drone bed for an area. */
  ambience(kind: string) {
    if (kind === currentAmb && ambNodes) return;
    if (!AC) { pendingAmb = kind; return; }
    ambNodes?.stop(); ambNodes = null; currentAmb = kind;
    if (kind === 'none') return;
    const f = AC.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 220;
    const g = AC.createGain(); g.gain.value = 0.0001; g.gain.linearRampToValueAtTime(0.045, AC.currentTime + 3);
    const hz = kind === 'rain' ? [0] : kind === 'boss' ? [41, 41.5, 61.7] : [55, 55.6, 82.4];
    const oscs: OscillatorNode[] = [];
    for (const h of hz) { if (!h) continue; const o = AC.createOscillator(); o.type = 'sawtooth'; o.frequency.value = h; o.connect(f); o.start(); oscs.push(o); }
    const lfo = AC.createOscillator(), lg = AC.createGain(); lfo.frequency.value = 0.07; lg.gain.value = 90; lfo.connect(lg).connect(f.frequency); lfo.start();
    f.connect(g).connect(ambBus);
    let rainSrc: AudioBufferSourceNode | null = null;
    if (kind === 'rain') {
      rainSrc = AC.createBufferSource(); rainSrc.buffer = noiseBuf; rainSrc.loop = true;
      const rf = AC.createBiquadFilter(); rf.type = 'lowpass'; rf.frequency.value = 1400;
      const rg = AC.createGain(); rg.gain.value = 0.16; rainSrc.connect(rf).connect(rg).connect(g); rainSrc.start();
      g.gain.linearRampToValueAtTime(0.5, AC.currentTime + 2);
    }
    const drip = setInterval(() => { if (Math.random() < 0.45) tone(rand(1200, 2400), 0.4, 'sine', 0.012, -200, 0, ambBus); }, 2300);
    ambNodes = {
      stop() {
        const t = AC!.currentTime; g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(g.gain.value, t); g.gain.linearRampToValueAtTime(0.0001, t + 1.2);
        setTimeout(() => { oscs.forEach((o) => o.stop()); lfo.stop(); rainSrc?.stop(); }, 1400);
        clearInterval(drip);
      },
    };
  },
};

// A slow, sparse, slightly-out-of-tune music box. Themes are note patterns (semitones from root).
const THEMES: Record<string, { root: number; notes: (number | null)[]; beat: number; detune: number }> = {
  // The rhyme's melody: "Lose a pen-ny, lose a key..."
  rhyme: { root: 440, notes: [7, 5, 3, 5, 7, 7, 7, null, 5, 5, 5, null, 7, 10, 10, null, 7, 5, 3, 5, 7, 7, 7, 7, 5, 5, 7, 5, 3, null, null, null], beat: 0.42, detune: 0.004 },
  hollows: { root: 293.66, notes: [0, null, 7, null, 3, null, 10, null, 12, null, 10, 7, 3, null, null, null, 0, null, 5, null, 3, null, 2, null, -2, null, 0, null, null, null, null, null], beat: 0.5, detune: 0.008 },
  boss: { root: 146.83, notes: [0, 0, 3, 0, 6, 0, 3, 1, 0, 0, 3, 0, 7, 6, 3, 1], beat: 0.22, detune: 0.015 },
  memory: { root: 523.25, notes: [0, 4, 7, 12, 7, 4, 0, null, -1, 2, 7, 11, 7, 2, -1, null], beat: 0.55, detune: 0.003 },
};
let musicName = '';
export const Music = {
  play(name: string) {
    if (name === musicName && musicTimer) return;
    this.stop();
    musicName = name;
    if (!AC) { pendingMusic = name; return; }
    const th = THEMES[name]; if (!th) return;
    let i = 0;
    Audio.duckMusic(1, 0.5);
    const step = () => {
      const n = th.notes[i % th.notes.length]; i++;
      if (n !== null && n !== undefined) {
        const wob = 1 + (Math.random() - 0.5) * th.detune * 2;
        chime(th.root * Math.pow(2, n / 12) * wob, 0, name === 'boss' ? 0.045 : 0.05);
        if (name === 'boss' && i % 4 === 1) tone(th.root / 2, 0.4, 'triangle', 0.06, 0, 0, musicBus);
      }
      musicTimer = setTimeout(step, th.beat * 1000 * (name === 'hollows' ? rand(0.9, 1.25) : 1));
    };
    musicTimer = setTimeout(step, 400);
  },
  stop() { if (musicTimer) clearTimeout(musicTimer); musicTimer = null; musicName = ''; },
  get current() { return musicName; },
};
