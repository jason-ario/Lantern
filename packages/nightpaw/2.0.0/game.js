(() => {
  // src/core/config.ts
  var T = 16;
  var ART = 4;
  var INV_ART = 1 / ART;
  var SCREEN_W = 1280;
  var SCREEN_H = 720;
  var ZOOM = 4.2;
  var VIEW_W = SCREEN_W / ZOOM;
  var VIEW_H = SCREEN_H / ZOOM;
  var STEP = 1 / 120;
  var PH = {
    G: 1150,
    JUMP: 345,
    JUMP2: 305,
    RUN: 108,
    MAXFALL: 430,
    DASH: 330,
    DASHT: 0.22,
    COYOTE: 0.09,
    BUFFER: 0.12,
    POGO: 300
  };
  var SAVE_KEY = "save2";
  var SAVE_VERSION = 2;
  var DEPTH = {
    bgDecor: 0,
    room: 10,
    decor: 20,
    props: 30,
    npc: 40,
    enemy: 50,
    player: 60,
    fx: 70,
    fgDecor: 80,
    lightGlow: 90
  };

  // src/core/util.ts
  var clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  var lerp = (a, b, t) => a + (b - a) * t;
  var rand = (a, b) => a + Math.random() * (b - a);
  var damp = (v, target, k, dt) => lerp(v, target, 1 - Math.exp(-k * dt));
  var overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  function seeded(str) {
    let h = 2166136261;
    for (let i = 0;i < str.length; i++)
      h = Math.imul(h ^ str.charCodeAt(i), 16777619);
    return () => {
      h += 1831565813;
      let t = h;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  var sleep = (scene, ms) => new Promise((res) => scene.time.delayedCall(ms, res));

  // src/core/audio.ts
  var AC = null;
  var master;
  var sfxBus;
  var musicBus;
  var ambBus;
  var noiseBuf;
  var ambNodes = null;
  var musicTimer = null;
  var volume = { master: 0.8, music: 0.55, sfx: 0.8 };
  function init() {
    if (AC)
      return;
    try {
      AC = new (window.AudioContext || window.webkitAudioContext);
      master = AC.createGain();
      master.gain.value = volume.master;
      master.connect(AC.destination);
      sfxBus = AC.createGain();
      sfxBus.gain.value = volume.sfx;
      sfxBus.connect(master);
      musicBus = AC.createGain();
      musicBus.gain.value = volume.music;
      musicBus.connect(master);
      ambBus = AC.createGain();
      ambBus.gain.value = 0.9;
      ambBus.connect(master);
      noiseBuf = AC.createBuffer(1, AC.sampleRate, AC.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0;i < d.length; i++)
        d[i] = Math.random() * 2 - 1;
      if (pendingAmb) {
        const p = pendingAmb;
        pendingAmb = null;
        Audio.ambience(p);
      }
      if (pendingMusic) {
        const p = pendingMusic;
        pendingMusic = null;
        Music.play(p);
      }
    } catch {
      AC = null;
    }
  }
  function tone(freq, dur, type = "sine", vol = 0.1, slide = 0, delay = 0, bus) {
    if (!AC)
      return;
    const t0 = AC.currentTime + delay;
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slide)
      o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(bus ?? sfxBus);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }
  function noise(dur, freq, q, vol, sweep = 0, delay = 0) {
    if (!AC)
      return;
    const t0 = AC.currentTime + delay;
    const s = AC.createBufferSource();
    s.buffer = noiseBuf;
    const f = AC.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.setValueAtTime(freq, t0);
    f.Q.value = q;
    if (sweep)
      f.frequency.exponentialRampToValueAtTime(Math.max(40, freq + sweep), t0 + dur);
    const g = AC.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f).connect(g).connect(sfxBus);
    s.start(t0);
    s.stop(t0 + dur);
  }
  function chime(freq, delay = 0, vol = 0.06, bus) {
    if (!AC)
      return;
    tone(freq, 1.6, "sine", vol, 0, delay, bus ?? musicBus);
    tone(freq * 2.01, 0.5, "sine", vol * 0.35, 0, delay, bus ?? musicBus);
    tone(freq * 4.03, 0.15, "triangle", vol * 0.12, 0, delay, bus ?? musicBus);
  }
  var sfx = {
    slash: () => noise(0.13, 3200, 1.2, 0.35, -2200),
    hit: () => {
      tone(160, 0.12, "square", 0.12, -90);
      noise(0.09, 900, 1, 0.3);
    },
    clink: () => tone(1800, 0.08, "triangle", 0.06, -600),
    jump: () => tone(260, 0.09, "triangle", 0.05, 180),
    wing: () => {
      noise(0.18, 1400, 0.6, 0.18, 1200);
      tone(520, 0.14, "sine", 0.05, 400);
    },
    dash: () => noise(0.22, 700, 0.5, 0.35, -400),
    land: () => noise(0.05, 300, 1, 0.12),
    step: () => noise(0.03, rand(500, 800), 2, 0.04),
    hurt: () => {
      tone(220, 0.35, "sawtooth", 0.12, -160);
      noise(0.2, 400, 0.7, 0.3);
    },
    coin: () => tone(1500 + Math.random() * 400, 0.06, "sine", 0.04, 500),
    pickup: () => [523, 659, 784, 1046].forEach((f, i) => chime(f, i * 0.09, 0.08, sfxBus)),
    ability: () => {
      [392, 523, 659, 784, 1046, 1318].forEach((f, i) => chime(f, i * 0.11, 0.08, sfxBus));
      noise(1.2, 2000, 0.4, 0.1, 2000);
    },
    rest: () => [220, 277, 330, 440].forEach((f) => tone(f, 1.6, "sine", 0.05)),
    roar: () => {
      tone(65, 1.4, "sawtooth", 0.22, -25);
      noise(1.2, 180, 0.6, 0.35, -100);
    },
    slam: () => {
      noise(0.45, 160, 0.8, 0.6, -80);
      tone(55, 0.4, "sine", 0.3, -20);
    },
    die: () => {
      tone(330, 1.2, "triangle", 0.1, -260);
      noise(0.6, 600, 0.5, 0.2, -500);
    },
    enemyDie: () => {
      noise(0.25, 500, 0.7, 0.3, -350);
      tone(120, 0.2, "square", 0.06, -60);
    },
    shoot: () => {
      tone(420, 0.1, "square", 0.05, -200);
      noise(0.08, 1200, 1, 0.1);
    },
    croak: () => {
      tone(110, 0.18, "square", 0.06, 40);
      tone(90, 0.2, "square", 0.05, -20, 0.1);
    },
    break: () => {
      noise(0.5, 300, 0.6, 0.5, -200);
      tone(70, 0.3, "sine", 0.2, -30);
    },
    menu: () => tone(880, 0.05, "sine", 0.04),
    confirm: () => {
      tone(660, 0.08, "sine", 0.05);
      tone(990, 0.12, "sine", 0.04, 0, 0.06);
    },
    save: () => chime(1046, 0, 0.04, sfxBus),
    memory: () => {
      [523, 494, 440, 392, 330].forEach((f, i) => chime(f, i * 0.35, 0.07, sfxBus));
    },
    whoosh: () => noise(0.5, 400, 0.4, 0.2, 1600),
    thunder: () => {
      noise(2.4, 120, 0.5, 0.4, -60);
      noise(0.6, 900, 0.3, 0.15, -600);
    },
    gate: () => {
      noise(0.6, 200, 0.8, 0.4, -100);
      tone(80, 0.5, "square", 0.08, -30);
    }
  };
  function voiceBlip(pitch, style = "soft") {
    if (!AC)
      return;
    const f = pitch * (0.9 + Math.random() * 0.25);
    if (style === "squeak")
      tone(f, 0.05, "square", 0.018, f * 0.3);
    else if (style === "deep")
      tone(f, 0.1, "sawtooth", 0.03, -f * 0.2);
    else if (style === "echo") {
      tone(f, 0.25, "sine", 0.025);
      tone(f, 0.25, "sine", 0.012, 0, 0.12);
    } else
      tone(f, 0.07, "triangle", 0.03);
  }
  var pendingAmb = null;
  var pendingMusic = null;
  var currentAmb = "";
  var Audio = {
    unlock() {
      init();
      if (AC && AC.state === "suspended")
        AC.resume();
    },
    get ready() {
      return !!AC;
    },
    setVolume(kind, v) {
      volume[kind] = v;
      if (!AC)
        return;
      ({ master, music: musicBus, sfx: sfxBus })[kind].gain.value = v;
    },
    duckMusic(to, secs = 0.6) {
      if (!AC)
        return;
      musicBus.gain.cancelScheduledValues(AC.currentTime);
      musicBus.gain.linearRampToValueAtTime(to * volume.music, AC.currentTime + secs);
    },
    ambience(kind) {
      if (kind === currentAmb && ambNodes)
        return;
      if (!AC) {
        pendingAmb = kind;
        return;
      }
      ambNodes?.stop();
      ambNodes = null;
      currentAmb = kind;
      if (kind === "none")
        return;
      const f = AC.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = 220;
      const g = AC.createGain();
      g.gain.value = 0.0001;
      g.gain.linearRampToValueAtTime(0.045, AC.currentTime + 3);
      const hz = kind === "rain" ? [0] : kind === "boss" ? [41, 41.5, 61.7] : [55, 55.6, 82.4];
      const oscs = [];
      for (const h of hz) {
        if (!h)
          continue;
        const o = AC.createOscillator();
        o.type = "sawtooth";
        o.frequency.value = h;
        o.connect(f);
        o.start();
        oscs.push(o);
      }
      const lfo = AC.createOscillator(), lg = AC.createGain();
      lfo.frequency.value = 0.07;
      lg.gain.value = 90;
      lfo.connect(lg).connect(f.frequency);
      lfo.start();
      f.connect(g).connect(ambBus);
      let rainSrc = null;
      if (kind === "rain") {
        rainSrc = AC.createBufferSource();
        rainSrc.buffer = noiseBuf;
        rainSrc.loop = true;
        const rf = AC.createBiquadFilter();
        rf.type = "lowpass";
        rf.frequency.value = 1400;
        const rg = AC.createGain();
        rg.gain.value = 0.16;
        rainSrc.connect(rf).connect(rg).connect(g);
        rainSrc.start();
        g.gain.linearRampToValueAtTime(0.5, AC.currentTime + 2);
      }
      const drip = setInterval(() => {
        if (Math.random() < 0.45)
          tone(rand(1200, 2400), 0.4, "sine", 0.012, -200, 0, ambBus);
      }, 2300);
      ambNodes = {
        stop() {
          const t = AC.currentTime;
          g.gain.cancelScheduledValues(t);
          g.gain.setValueAtTime(g.gain.value, t);
          g.gain.linearRampToValueAtTime(0.0001, t + 1.2);
          setTimeout(() => {
            oscs.forEach((o) => o.stop());
            lfo.stop();
            rainSrc?.stop();
          }, 1400);
          clearInterval(drip);
        }
      };
    }
  };
  var THEMES = {
    rhyme: { root: 440, notes: [7, 5, 3, 5, 7, 7, 7, null, 5, 5, 5, null, 7, 10, 10, null, 7, 5, 3, 5, 7, 7, 7, 7, 5, 5, 7, 5, 3, null, null, null], beat: 0.42, detune: 0.004 },
    hollows: { root: 293.66, notes: [0, null, 7, null, 3, null, 10, null, 12, null, 10, 7, 3, null, null, null, 0, null, 5, null, 3, null, 2, null, -2, null, 0, null, null, null, null, null], beat: 0.5, detune: 0.008 },
    boss: { root: 146.83, notes: [0, 0, 3, 0, 6, 0, 3, 1, 0, 0, 3, 0, 7, 6, 3, 1], beat: 0.22, detune: 0.015 },
    memory: { root: 523.25, notes: [0, 4, 7, 12, 7, 4, 0, null, -1, 2, 7, 11, 7, 2, -1, null], beat: 0.55, detune: 0.003 }
  };
  var musicName = "";
  var Music = {
    play(name) {
      if (name === musicName && musicTimer)
        return;
      this.stop();
      musicName = name;
      if (!AC) {
        pendingMusic = name;
        return;
      }
      const th = THEMES[name];
      if (!th)
        return;
      let i = 0;
      Audio.duckMusic(1, 0.5);
      const step = () => {
        const n = th.notes[i % th.notes.length];
        i++;
        if (n !== null && n !== undefined) {
          const wob = 1 + (Math.random() - 0.5) * th.detune * 2;
          chime(th.root * Math.pow(2, n / 12) * wob, 0, name === "boss" ? 0.045 : 0.05);
          if (name === "boss" && i % 4 === 1)
            tone(th.root / 2, 0.4, "triangle", 0.06, 0, 0, musicBus);
        }
        musicTimer = setTimeout(step, th.beat * 1000 * (name === "hollows" ? rand(0.9, 1.25) : 1));
      };
      musicTimer = setTimeout(step, 400);
    },
    stop() {
      if (musicTimer)
        clearTimeout(musicTimer);
      musicTimer = null;
      musicName = "";
    },
    get current() {
      return musicName;
    }
  };

  // src/core/input.ts
  var BIND = {
    left: ["ArrowLeft", "KeyA"],
    right: ["ArrowRight", "KeyD"],
    up: ["ArrowUp", "KeyW"],
    down: ["ArrowDown", "KeyS"],
    jump: ["Space", "KeyZ", "KeyK"],
    attack: ["KeyX", "KeyJ"],
    dash: ["KeyC", "KeyL", "ShiftLeft", "ShiftRight"],
    map: ["KeyM", "Tab"],
    pause: ["Escape", "KeyP"],
    confirm: ["Enter", "Space", "KeyZ", "KeyK", "KeyX", "KeyJ"],
    back: ["Escape", "Backspace"]
  };
  var ACTIONS = Object.keys(BIND);
  var keys = {};
  var latch = {};
  var touch = {};
  var cur = {};
  var prev = {};
  var padCache = {};
  var usingPad = false;
  function readPad() {
    const out = {};
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = [...pads].find((p) => p && p.connected);
    if (!gp)
      return out;
    const b = (i) => !!gp.buttons[i]?.pressed;
    const ax = gp.axes[0] ?? 0, ay = gp.axes[1] ?? 0;
    out.left = ax < -0.4 || b(14);
    out.right = ax > 0.4 || b(15);
    out.up = ay < -0.5 || b(12);
    out.down = ay > 0.5 || b(13);
    out.jump = b(0);
    out.attack = b(2);
    out.dash = b(1) || b(5) || b(7);
    out.map = b(8) || b(3);
    out.pause = b(9);
    out.confirm = b(0) || b(9);
    out.back = b(1);
    if (Object.values(out).some(Boolean))
      usingPad = true;
    return out;
  }
  var Input = {
    init() {
      window.addEventListener("keydown", (e) => {
        keys[e.code] = true;
        if (!e.repeat)
          latch[e.code] = true;
        usingPad = false;
        Audio.unlock();
        if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space", "Tab"].includes(e.code))
          e.preventDefault();
      });
      window.addEventListener("keyup", (e) => {
        keys[e.code] = false;
      });
      window.addEventListener("blur", () => {
        for (const k in keys)
          keys[k] = false;
      });
      window.addEventListener("pointerdown", () => Audio.unlock());
      const ui = document.getElementById("touch");
      if (ui) {
        if (window.matchMedia("(pointer: coarse)").matches || "ontouchstart" in window)
          ui.hidden = false;
        ui.querySelectorAll("button").forEach((btn) => {
          const k = btn.dataset.k;
          const on = (e) => {
            e.preventDefault();
            touch[k] = true;
            latch[`touch:${k}`] = true;
            btn.classList.add("on");
            Audio.unlock();
          };
          const off = (e) => {
            e.preventDefault();
            touch[k] = false;
            btn.classList.remove("on");
          };
          btn.addEventListener("pointerdown", on);
          ["pointerup", "pointercancel", "pointerleave"].forEach((ev) => btn.addEventListener(ev, off));
        });
      }
    },
    poll() {
      padCache = readPad();
      cur = {};
      for (const a of ACTIONS)
        cur[a] = BIND[a].some((k) => keys[k] || latch[k]) || !!touch[a] || !!latch[`touch:${a}`] || !!padCache[a];
      if (touch.jump || latch["touch:jump"])
        cur.confirm = true;
      if (touch.pause || latch["touch:pause"])
        cur.back = true;
    },
    endStep() {
      prev = { ...cur };
      for (const k in latch)
        delete latch[k];
      for (const a of ACTIONS)
        if (cur[a] && !BIND[a].some((k) => keys[k]) && !touch[a] && !padCache[a])
          cur[a] = false;
    },
    held: (a) => !!cur[a],
    pressed: (a) => !!cur[a] && !prev[a],
    released: (a) => !cur[a] && !!prev[a],
    get usingPad() {
      return usingPad;
    },
    swallow() {
      prev = { ...cur, ...Object.fromEntries(ACTIONS.map((a) => [a, true])) };
      for (const k in latch)
        delete latch[k];
    }
  };

  // src/core/platform.ts
  var LS_PREFIX = "nightpaw:";
  var fallback = {
    ready: async () => ({ mode: "standalone" }),
    user: { getCurrentUser: async () => ({ id: "local", displayName: "Player" }) },
    storage: {
      save: async (k, v) => {
        try {
          localStorage.setItem(LS_PREFIX + k, JSON.stringify(v));
        } catch {}
        return { revision: 0, savedAt: Date.now() };
      },
      load: async (k) => {
        try {
          const s = localStorage.getItem(LS_PREFIX + k);
          return s ? JSON.parse(s) : null;
        } catch {
          return null;
        }
      },
      remove: async (k) => {
        try {
          localStorage.removeItem(LS_PREFIX + k);
        } catch {}
      },
      list: async () => []
    },
    achievements: { unlock: async (id) => {
      console.info("[achievement]", id);
      return { newlyUnlocked: true };
    }, list: async () => [] },
    game: { reportPlaytime() {}, onExit() {}, onPause() {}, onResume() {}, exit() {} }
  };
  var P = fallback;
  var context = { mode: "standalone" };
  var Platform = {
    async init() {
      if (window.Platform && window.parent !== window) {
        const ctx = await Promise.race([window.Platform.ready(), new Promise((r) => setTimeout(() => r(null), 2500))]);
        if (ctx) {
          P = window.Platform;
          context = ctx;
        }
      }
      return context;
    },
    get api() {
      return P;
    },
    get context() {
      return context;
    },
    get isDemo() {
      return context?.launchMode === "demo" || context?.demo === true;
    },
    save: (k, v) => P.storage.save(k, v),
    load: (k) => P.storage.load(k),
    remove: (k) => P.storage.remove(k),
    unlock: (id) => P.achievements.unlock(id),
    onExit: (fn) => P.game.onExit(fn),
    onPause: (fn) => P.game.onPause(fn),
    onResume: (fn) => P.game.onResume(fn),
    reportPlaytime: () => {
      try {
        P.game.reportPlaytime();
      } catch {}
    }
  };

  // src/core/state.ts
  function newSave() {
    return {
      v: SAVE_VERSION,
      flags: {},
      abilities: {},
      maxHp: 4,
      hp: 4,
      buttons: 0,
      visited: [],
      taken: [],
      shades: [],
      shrine: null,
      pos: null,
      deaths: 0,
      playSeconds: 0,
      savedAt: 0
    };
  }
  function migrate(d) {
    if (!d || typeof d !== "object")
      return null;
    const base = newSave();
    return { ...base, ...d, flags: { ...d.flags || {} }, abilities: { ...d.abilities || {} } };
  }
  var unlocked = new Set;
  var Game = {
    save: newSave(),
    loaded: null,
    visited: new Set,
    taken: new Set,
    saving: false,
    saveAgain: false,
    onSaved: [],
    startNew() {
      this.save = newSave();
      this.visited = new Set;
      this.taken = new Set;
    },
    resume(d) {
      this.save = JSON.parse(JSON.stringify(d));
      this.visited = new Set(d.visited);
      this.taken = new Set(d.taken);
    },
    async loadFromPlatform() {
      try {
        this.loaded = migrate(await Platform.load(SAVE_KEY));
      } catch {
        this.loaded = null;
      }
      return this.loaded;
    },
    async persist() {
      if (this.saving) {
        this.saveAgain = true;
        return;
      }
      this.saving = true;
      const s = this.save;
      s.visited = [...this.visited];
      s.taken = [...this.taken];
      s.savedAt = Date.now();
      try {
        await Platform.save(SAVE_KEY, s);
        this.loaded = JSON.parse(JSON.stringify(s));
        this.onSaved.forEach((f) => f());
      } catch {}
      this.saving = false;
      if (this.saveAgain) {
        this.saveAgain = false;
        this.persist();
      }
    },
    flag(name) {
      return this.save.flags[name];
    },
    setFlag(name, v = true) {
      this.save.flags[name] = v;
    },
    has(ability) {
      return !!this.save.abilities[ability];
    },
    give(ability) {
      this.save.abilities[ability] = true;
    },
    achieve(id) {
      if (unlocked.has(id))
        return;
      unlocked.add(id);
      Platform.unlock(id).catch(() => unlocked.delete(id));
    },
    test(cond) {
      if (!cond)
        return true;
      return cond.split("&").every((raw) => {
        let c = raw.trim();
        let neg = false;
        if (c.startsWith("!")) {
          neg = true;
          c = c.slice(1);
        }
        let v;
        if (c.startsWith("has:"))
          v = this.has(c.slice(4));
        else if (c.startsWith("taken:"))
          v = this.taken.has(c.slice(6));
        else if (c.startsWith("shades>="))
          v = this.save.shades.length >= Number(c.slice(8));
        else
          v = !!this.save.flags[c];
        return neg ? !v : v;
      });
    }
  };

  // src/world/world.ts
  var DEFAULT_LEGEND = {
    P: { type: "spawn" },
    S: { type: "shrine" },
    c: { type: "mite" },
    w: { type: "sockwisp" },
    s: { type: "snail" },
    t: { type: "toad" },
    g: { type: "jar" },
    o: { type: "coin" },
    B: { type: "warden" },
    G: { type: "gate", flag: "warden_dead" }
  };
  var World = {
    def: null,
    areas: [],
    rooms: [],
    byId: new Map,
    cutscenes: new Map,
    speakers: {},
    async load(base = "content/") {
      const j = async (p) => {
        const r = await fetch(base + p);
        if (!r.ok)
          throw new Error(`Missing content: ${p}`);
        return r.json();
      };
      this.def = await j("world.json");
      this.speakers = await j("speakers.json");
      this.areas = await Promise.all(this.def.areas.map((a) => j(`areas/${a}.json`)));
      const cs = await Promise.all(this.def.cutscenes.map((c) => j(`cutscenes/${c}.json`)));
      cs.flat().forEach((c) => this.cutscenes.set(c.id, c));
      this.rooms = [];
      for (const area of this.areas)
        for (const rd of area.rooms)
          this.rooms.push(buildRoom(rd, area));
      this.byId = new Map(this.rooms.map((r) => [r.id, r]));
    },
    roomAt(px, py) {
      for (const r of this.rooms)
        if (px >= r.px && px < r.px + r.pw && py >= r.py && py < r.py + r.ph)
          return r;
      return null;
    }
  };
  function buildRoom(rd, area) {
    const legend = { ...DEFAULT_LEGEND, ...area.legend || {}, ...rd.legend || {} };
    const grid = [];
    const spawns = [];
    const w = Math.max(...rd.rows.map((r) => r.length));
    rd.rows.forEach((row, y) => {
      const line = [];
      for (let x = 0;x < w; x++) {
        const ch = row[x] ?? "#";
        if ("#=^.X".includes(ch))
          line.push(ch === "X" ? "X" : ch);
        else if (legend[ch]) {
          spawns.push({ ...legend[ch], x, y, id: legend[ch].id ?? `${rd.id}:${x},${y}` });
          line.push(".");
        } else
          line.push(".");
      }
      grid.push(line);
    });
    for (const e of rd.entities || [])
      spawns.push({ ...e, id: e.id ?? `${rd.id}:${e.type}:${e.x},${e.y}` });
    const h = grid.length;
    return { ...rd, area, grid, spawns, w, h, px: rd.x * T, py: rd.y * T, pw: w * T, ph: h * T };
  }
  var current = null;
  function setCurrentRoom(r) {
    current = r;
  }
  function tileAt(tx, ty) {
    let r = current;
    if (!r || tx < r.x || tx >= r.x + r.w || ty < r.y || ty >= r.y + r.h) {
      r = null;
      for (const q of World.rooms)
        if (tx >= q.x && tx < q.x + q.w && ty >= q.y && ty < q.y + q.h) {
          r = q;
          break;
        }
    }
    if (!r)
      return "#";
    const ch = r.grid[ty - r.y][tx - r.x];
    if (ch === "X" && Game.taken.has(`wall:${r.id}:${tx - r.x},${ty - r.y}`))
      return ".";
    return ch;
  }
  var isSolid = (ch) => ch === "#" || ch === "X";
  function moveBody(e, dt) {
    e.hitX = false;
    e.hitCeil = false;
    if (e.vx) {
      e.x += e.vx * dt;
      const y0 = Math.floor(e.y / T), y1 = Math.floor((e.y + e.h - 0.01) / T);
      if (e.vx > 0) {
        const tx = Math.floor((e.x + e.w) / T);
        for (let ty = y0;ty <= y1; ty++)
          if (isSolid(tileAt(tx, ty))) {
            e.x = tx * T - e.w;
            e.hitX = true;
            break;
          }
      } else {
        const tx = Math.floor(e.x / T);
        for (let ty = y0;ty <= y1; ty++)
          if (isSolid(tileAt(tx, ty))) {
            e.x = (tx + 1) * T;
            e.hitX = true;
            break;
          }
      }
    }
    const prevBottom = e.y + e.h;
    e.y += e.vy * dt;
    const wasGround = e.onGround;
    e.onGround = false;
    const x0 = Math.floor(e.x / T), x1 = Math.floor((e.x + e.w - 0.01) / T);
    if (e.vy > 0) {
      const ty = Math.floor((e.y + e.h) / T);
      for (let tx = x0;tx <= x1; tx++) {
        const ch = tileAt(tx, ty);
        if (isSolid(ch) || ch === "=" && !e.noPlatforms && prevBottom <= ty * T + 0.5 && !((e.dropT ?? 0) > 0)) {
          e.y = ty * T - e.h;
          e.vy = 0;
          e.onGround = true;
          break;
        }
      }
    } else if (e.vy < 0) {
      const ty = Math.floor(e.y / T);
      for (let tx = x0;tx <= x1; tx++)
        if (isSolid(tileAt(tx, ty))) {
          e.y = (ty + 1) * T;
          e.vy = 0;
          e.hitCeil = true;
          break;
        }
    }
    e.landed = !!e.onGround && !wasGround;
  }
  function boxHasTile(x, y, w, h, pred) {
    for (let tx = Math.floor(x / T);tx <= Math.floor((x + w - 0.01) / T); tx++)
      for (let ty = Math.floor(y / T);ty <= Math.floor((y + h - 0.01) / T); ty++)
        if (pred(tileAt(tx, ty), tx, ty))
          return true;
    return false;
  }
  function groundBelow(r, sx, sy) {
    for (let yy = sy + 1;yy < r.h; yy++) {
      const ch = r.grid[yy][sx];
      if (ch === "#" || ch === "=" || ch === "X")
        return yy;
    }
    return sy + 1;
  }
  var GRAVITY = PH.G;

  // src/scenes/UIScene.ts
  var FONT = '"Palatino Linotype", "Book Antiqua", Palatino, Georgia, serif';
  var W = SCREEN_W;
  var H = SCREEN_H;
  var DY = 76;

  class UIScene extends Phaser.Scene {
    game_;
    modal = null;
    orb;
    paws = [];
    coinIcon;
    coinText;
    hud;
    hudAlpha = 1;
    shownCoins = 0;
    fadeRect;
    flashRect;
    hurtRect;
    barTop;
    barBot;
    letterOn = false;
    promptText;
    promptWorld = null;
    titleGroup;
    saveIco;
    bossGroup;
    bossTarget = null;
    bossFill;
    dlg;
    dlgPortrait;
    dlgName;
    dlgText;
    dlgArrow;
    typing = null;
    constructor() {
      super("ui");
    }
    create() {
      this.hud = this.add.container(0, 0);
      this.orb = this.add.image(62, 62, "ui_orb").setScale(0.95);
      this.hud.add(this.orb);
      this.coinIcon = this.add.image(122, 100, "button_coin").setScale(1.3);
      this.coinText = this.add.text(140, 100, "0", { fontFamily: FONT, fontSize: "24px", color: "#f0ecff" }).setOrigin(0, 0.5);
      this.hud.add([this.coinIcon, this.coinText]);
      this.shownCoins = Game.save.buttons;
      this.rebuildPaws();
      this.promptText = this.add.text(0, 0, "", { fontFamily: FONT, fontSize: "22px", color: "#f0ecff", stroke: "#07060a", strokeThickness: 5 }).setOrigin(0.5, 1).setAlpha(0);
      this.bossGroup = this.add.container(W / 2, H - 46).setAlpha(0);
      const bname = this.add.text(0, -22, "", { fontFamily: FONT, fontSize: "22px", color: "#e8d8e0", letterSpacing: 6 }).setOrigin(0.5);
      const bbg = this.add.rectangle(0, 4, 640, 10, 0, 0.6).setStrokeStyle(1, 16777215, 0.2);
      this.bossFill = this.add.rectangle(-320, 4, 640, 10, 13117498).setOrigin(0, 0.5);
      this.bossGroup.add([bname, bbg, this.bossFill]);
      this.dlg = this.add.container(0, 0).setAlpha(0);
      const panel = this.add.graphics();
      panel.fillStyle(460298, 0.88);
      panel.fillRoundedRect(110, DY, W - 220, 164, 18);
      panel.lineStyle(2, 14209264, 0.35);
      panel.strokeRoundedRect(110, DY, W - 220, 164, 18);
      this.dlgPortrait = this.add.image(190, DY + 82, "pt_tallow").setScale(0.72);
      this.dlgName = this.add.text(272, DY + 16, "", { fontFamily: FONT, fontSize: "22px", color: "#ffcf7a", fontStyle: "bold" });
      this.dlgText = this.add.text(272, DY + 48, "", { fontFamily: FONT, fontSize: "25px", color: "#f0ecff", wordWrap: { width: W - 420 }, lineSpacing: 6 });
      this.dlgArrow = this.add.text(W - 140, DY + 138, "▼", { fontFamily: FONT, fontSize: "20px", color: "#ffcf7a" }).setOrigin(0.5);
      this.dlg.add([panel, this.dlgPortrait, this.dlgName, this.dlgText, this.dlgArrow]);
      this.titleGroup = this.add.container(W / 2, 150).setAlpha(0);
      this.barTop = this.add.rectangle(0, -60, W, 60, 0).setOrigin(0);
      this.barBot = this.add.rectangle(0, H, W, 60, 0).setOrigin(0);
      this.hurtRect = this.add.rectangle(0, 0, W, H, 9046554, 0).setOrigin(0).setBlendMode(Phaser.BlendModes.MULTIPLY);
      this.flashRect = this.add.rectangle(0, 0, W, H, 0, 0).setOrigin(0);
      this.saveIco = this.add.image(W - 50, H - 50, "ui_paw").setAlpha(0).setScale(1.1);
      this.fadeRect = this.add.rectangle(0, 0, W, H, 0, 0).setOrigin(0).setDepth(1000);
    }
    rebuildPaws() {
      this.paws.forEach((p) => p.destroy());
      this.paws = [];
      for (let i = 0;i < Game.save.maxHp; i++) {
        const p = this.add.image(128 + i * 34, 52, "ui_paw").setScale(0.95);
        this.paws.push(p);
        this.hud.add(p);
      }
    }
    coinsChanged() {
      this.tweens.add({ targets: this.coinIcon, scale: 1.7, duration: 80, yoyo: true });
    }
    hurtFlash() {
      this.hurtRect.setAlpha(0.8);
      this.tweens.add({ targets: this.hurtRect, alpha: 0, duration: 400 });
    }
    flashFade(a) {
      this.flashRect.setAlpha(a);
      this.tweens.killTweensOf(this.flashRect);
      this.tweens.add({ targets: this.flashRect, alpha: 0, duration: 260 });
    }
    saveIcon() {
      this.saveIco.setAlpha(0.9);
      this.tweens.killTweensOf(this.saveIco);
      this.tweens.add({ targets: this.saveIco, alpha: 0, delay: 900, duration: 700 });
    }
    update(_t, deltaMs) {
      const dt = deltaMs / 1000;
      const g = this.game_;
      if (!g || !g.player)
        return;
      const P2 = g.player;
      if (this.paws.length !== Game.save.maxHp)
        this.rebuildPaws();
      this.paws.forEach((p, i) => {
        const full = i < P2.hp;
        p.setTexture(full ? "ui_paw" : "ui_paw_empty");
        p.setScale(full ? 0.95 + (i === P2.hp - 1 && P2.hp <= 1 ? Math.sin(this.time.now / 150) * 0.08 : 0) : 0.9);
      });
      this.shownCoins = Math.round(damp(this.shownCoins, Game.save.buttons, 10, dt));
      if (Math.abs(this.shownCoins - Game.save.buttons) < 1)
        this.shownCoins = Game.save.buttons;
      this.coinText.setText(String(this.shownCoins));
      this.hudAlpha = damp(this.hudAlpha, g.inCutscene || this.letterOn ? 0 : 1, 6, dt);
      this.hud.setAlpha(this.hudAlpha);
      if (this.promptWorld) {
        const cam = g.cameras.main;
        this.promptText.setPosition((this.promptWorld.x - cam.midPoint.x) * ZOOM + W / 2, (this.promptWorld.y - cam.midPoint.y) * ZOOM + H / 2 - 10);
      }
      if (this.bossTarget) {
        const k = clamp(this.bossTarget.hp / this.bossTarget.maxHp, 0, 1);
        this.bossFill.width = damp(this.bossFill.width, 640 * k, 8, dt);
      }
      const ty = this.typing;
      if (ty && ty.shown < ty.full.length) {
        const before = Math.floor(ty.shown);
        ty.shown = Math.min(ty.full.length, ty.shown + dt * 48);
        const now = Math.floor(ty.shown);
        if (now !== before) {
          this.dlgText.setText(ty.full.slice(0, now));
          const ch = ty.full[now - 1];
          if (ch && /[a-z0-9]/i.test(ch) && now % 2 === 0)
            voiceBlip(ty.speaker.pitch ?? 400, ty.speaker.voice);
          if (ch && ".!?".includes(ch))
            ty.shown -= 0.2;
        }
        if (ty.shown >= ty.full.length)
          ty.done();
      }
      this.dlgArrow.setAlpha(ty && ty.waiting ? 0.6 + Math.sin(this.time.now / 180) * 0.4 : 0);
    }
    prompt(text, x, y) {
      this.tweens.killTweensOf(this.promptText);
      if (!text) {
        this.promptWorld = null;
        this.tweens.add({ targets: this.promptText, alpha: 0, duration: 150 });
        return;
      }
      this.promptWorld = { x, y };
      this.promptText.setText(`▲  ${text}`);
      this.tweens.add({ targets: this.promptText, alpha: 1, duration: 200 });
    }
    bossBar(e, name) {
      this.bossTarget = e;
      if (e) {
        this.bossGroup.list[0].setText((name ?? "").toUpperCase());
        this.bossFill.width = 640;
        this.tweens.add({ targets: this.bossGroup, alpha: 1, duration: 800 });
      } else
        this.tweens.add({ targets: this.bossGroup, alpha: 0, duration: 800 });
    }
    hint(text, ms = 4000) {
      const t = this.add.text(W / 2, H - 70, text, { fontFamily: FONT, fontSize: "22px", color: "#d8d0f0", fontStyle: "italic", stroke: "#07060a", strokeThickness: 5 }).setOrigin(0.5).setAlpha(0).setDepth(700);
      this.tweens.add({ targets: t, alpha: 1, duration: 600, yoyo: true, hold: ms, onComplete: () => t.destroy() });
    }
    letterbox(on) {
      this.letterOn = on;
      this.tweens.add({ targets: this.barTop, y: on ? 0 : -60, duration: 500, ease: "Sine.easeInOut" });
      this.tweens.add({ targets: this.barBot, y: on ? H - 60 : H, duration: 500, ease: "Sine.easeInOut" });
    }
    fade(to, ms, color) {
      if (color)
        this.fadeRect.setFillStyle(Phaser.Display.Color.HexStringToColor(color).color);
      else
        this.fadeRect.setFillStyle(0);
      this.tweens.killTweensOf(this.fadeRect);
      if (ms <= 0) {
        this.fadeRect.setAlpha(to);
        return Promise.resolve();
      }
      return new Promise((res) => {
        this.tweens.add({ targets: this.fadeRect, alpha: to, duration: ms, onComplete: () => res() });
      });
    }
    titleCard(name, sub, boss = false) {
      const g = this.titleGroup;
      g.removeAll(true);
      const t = this.add.text(0, 0, name.toUpperCase(), { fontFamily: FONT, fontSize: boss ? "58px" : "46px", color: boss ? "#e6c8d0" : "#e8e2ff", letterSpacing: boss ? 14 : 10 }).setOrigin(0.5);
      const line = this.add.rectangle(0, 44, Math.min(600, t.width * 0.9), 2, boss ? 13117498 : 14209264, 0.6);
      g.add([t, line]);
      if (sub)
        g.add(this.add.text(0, 76, sub, { fontFamily: FONT, fontSize: "24px", color: "#b8b0d0", fontStyle: "italic" }).setOrigin(0.5));
      g.setAlpha(0).setY(boss ? 170 : 150);
      this.tweens.killTweensOf(g);
      this.tweens.add({ targets: g, alpha: 1, duration: 1100, yoyo: true, hold: 2400, ease: "Sine.easeInOut" });
    }
    cutsceneInput() {
      const ty = this.typing;
      if (!ty)
        return;
      if (Input.pressed("confirm") || Input.pressed("attack") || Input.pressed("jump")) {
        if (ty.shown < ty.full.length) {
          ty.shown = ty.full.length;
          this.dlgText.setText(ty.full);
          ty.done();
        } else if (ty.waiting) {
          sfx.menu();
          const r = ty.resolve;
          this.typing = null;
          r();
        }
      }
    }
    say(who, text, opts = {}) {
      const sp = World.speakers[who] ?? { name: who, pitch: 400 };
      this.dlgName.setText(sp.name ?? "").setColor(sp.color ?? "#ffcf7a");
      if (sp.portrait)
        this.dlgPortrait.setTexture(sp.portrait).setVisible(true);
      else
        this.dlgPortrait.setVisible(false);
      this.dlgText.setX(sp.portrait ? 272 : 160).setFontStyle(sp.italic || opts.italic ? "italic" : "normal");
      this.dlgName.setX(sp.portrait ? 272 : 160);
      this.dlgText.setText("");
      if (this.dlg.alpha < 1)
        this.tweens.add({ targets: this.dlg, alpha: 1, duration: 180 });
      return new Promise((resolve) => {
        const ty = { full: text, shown: 0, speaker: sp, waiting: false, resolve: () => {}, done: () => {
          ty.waiting = true;
        } };
        ty.resolve = () => {
          resolve();
          if (!opts.keepOpen)
            this.time.delayedCall(10, () => {
              if (!this.typing)
                this.tweens.add({ targets: this.dlg, alpha: 0, duration: 160 });
            });
        };
        this.typing = ty;
      });
    }
    async narrate(lines, opts = {}) {
      const txt = this.add.text(W / 2, H / 2, "", { fontFamily: FONT, fontSize: "30px", color: "#e8e2ff", fontStyle: "italic", align: "center", wordWrap: { width: W - 300 }, lineSpacing: 10 }).setOrigin(0.5).setAlpha(0).setDepth(1001);
      for (const line of lines) {
        txt.setText(line);
        await new Promise((r) => this.tweens.add({ targets: txt, alpha: 1, duration: 700, onComplete: () => r() }));
        await this.waitConfirm(opts.auto ?? 0);
        await new Promise((r) => this.tweens.add({ targets: txt, alpha: 0, duration: 500, onComplete: () => r() }));
      }
      txt.destroy();
    }
    waitConfirm(auto = 0) {
      return new Promise((res) => {
        let t = 0;
        this.modal = {
          update: (dt) => {
            t += dt;
            if (t > 0.25 && (Input.pressed("confirm") || Input.pressed("attack")) || auto && t * 1000 > auto) {
              this.modal = null;
              res();
            }
          }
        };
      });
    }
    updateModal(dt) {
      this.modal?.update(dt);
    }
    async itemCard(title, text, icon, hint) {
      const c = this.add.container(W / 2, H / 2).setAlpha(0).setDepth(900);
      const bg = this.add.rectangle(0, 0, W, H, 0, 0.6);
      const glow = this.add.image(0, -90, "fx_light").setScale(1.3).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.35).setTint(15327999);
      const ic = icon ? this.add.image(0, -90, icon).setScale(icon === "needle" ? 1.8 : 2.2) : null;
      if (icon === "needle")
        ic.setRotation(-0.8);
      const t1 = this.add.text(0, 10, title, { fontFamily: FONT, fontSize: "46px", color: "#f0ecff", letterSpacing: 4 }).setOrigin(0.5);
      const t2 = this.add.text(0, 70, text, { fontFamily: FONT, fontSize: "24px", color: "#c8c0e0", fontStyle: "italic", align: "center", wordWrap: { width: 800 } }).setOrigin(0.5, 0);
      const t3 = hint ? this.add.text(0, 170, hint, { fontFamily: FONT, fontSize: "22px", color: "#ffcf7a", align: "center", wordWrap: { width: 800 } }).setOrigin(0.5, 0) : null;
      c.add([bg, glow, ...ic ? [ic] : [], t1, t2, ...t3 ? [t3] : []]);
      this.tweens.add({ targets: c, alpha: 1, duration: 500 });
      this.tweens.add({ targets: glow, scale: 1.5, alpha: 0.5, duration: 1400, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
      await this.waitConfirm();
      await new Promise((r) => this.tweens.add({ targets: c, alpha: 0, duration: 400, onComplete: () => r() }));
      c.destroy();
    }
    async memory(title, lines, image) {
      const c = this.add.container(0, 0).setAlpha(0).setDepth(950);
      const bg = this.add.rectangle(0, 0, W, H, 660516, 0.92).setOrigin(0);
      const pic = image ? this.add.image(W / 2, H / 2, image).setDisplaySize(W, H).setAlpha(0.35).setTint(10146047) : null;
      const glow = this.add.image(W / 2, 250, "fx_light").setScale(2.5).setTint(12577535).setAlpha(0.35).setBlendMode(Phaser.BlendModes.ADD);
      const shade = this.add.image(W / 2, 250, "shade").setScale(2.6).setAlpha(0.9);
      const t1 = this.add.text(W / 2, 110, title, { fontFamily: FONT, fontSize: "34px", color: "#dff6ff", fontStyle: "italic", letterSpacing: 3 }).setOrigin(0.5);
      const t2 = this.add.text(W / 2, 430, "", { fontFamily: FONT, fontSize: "28px", color: "#dff6ff", fontStyle: "italic", align: "center", wordWrap: { width: 900 }, lineSpacing: 10 }).setOrigin(0.5, 0);
      c.add([bg, ...pic ? [pic] : [], glow, shade, t1, t2]);
      this.tweens.add({ targets: c, alpha: 1, duration: 1200 });
      this.tweens.add({ targets: shade, y: 240, duration: 2000, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
      await sleep(this, 1000);
      for (const line of lines) {
        t2.setAlpha(0).setText(line);
        await new Promise((r) => this.tweens.add({ targets: t2, alpha: 1, duration: 900, onComplete: () => r() }));
        await this.waitConfirm();
        await new Promise((r) => this.tweens.add({ targets: t2, alpha: 0, duration: 500, onComplete: () => r() }));
      }
      await new Promise((r) => this.tweens.add({ targets: c, alpha: 0, duration: 1000, onComplete: () => r() }));
      c.destroy();
    }
    async storybook(pages, opts = {}) {
      const c = this.add.container(0, 0).setDepth(1100);
      const black = this.add.rectangle(0, 0, W, H, 0, 1).setOrigin(0);
      c.add(black);
      let skip = false;
      for (const pg of pages) {
        if (skip)
          break;
        const img = this.add.image(W / 2, H / 2, pg.image).setAlpha(0);
        const pan = pg.pan ?? [1.08, 1, 0, 0];
        img.setScale(pan[0]);
        c.add(img);
        let rain = null;
        if (pg.rain) {
          rain = this.add.tileSprite(0, 0, W, H, "rain_gen").setOrigin(0).setAlpha(0.5);
          c.add(rain);
        }
        let moth = null;
        if (pg.moth) {
          moth = this.add.image(pg.moth[0], pg.moth[1], "relic_wings").setScale(1.4).setAlpha(0);
          c.add(moth);
          this.tweens.add({ targets: moth, alpha: 0.95, duration: 1500 });
        }
        if (pg.sfx)
          sfx[pg.sfx]?.();
        const title = pg.title ? this.add.text(W / 2, opts.card ? H / 2 - 110 : 70, pg.title, { fontFamily: FONT, fontSize: "40px", color: "#e8e2ff", letterSpacing: 6 }).setOrigin(0.5).setAlpha(0) : null;
        const txt = this.add.text(W / 2, opts.card ? H / 2 - 30 : H - 110, "", { fontFamily: FONT, fontSize: "28px", color: "#f0ecff", fontStyle: "italic", align: "center", stroke: "#000000", strokeThickness: 6, wordWrap: { width: W - 260 }, lineSpacing: 8 }).setOrigin(0.5, opts.card ? 0 : 0.5);
        if (title)
          c.add(title);
        c.add(txt);
        await new Promise((r) => this.tweens.add({ targets: [img, ...title ? [title] : []], alpha: 1, duration: 1200, onComplete: () => r() }));
        this.tweens.add({ targets: img, scale: pan[1], x: W / 2 + (pan[2] ?? 0), y: H / 2 + (pan[3] ?? 0), duration: 9000, ease: "Sine.easeInOut" });
        const t0 = this.time.now;
        const lines = pg.lines ?? [];
        if (opts.card) {
          txt.setText(lines.join(`
`));
          txt.setAlpha(0);
          this.tweens.add({ targets: txt, alpha: 1, duration: 1400 });
        }
        for (let i = 0;!opts.card && i < lines.length; i++) {
          txt.setAlpha(0).setText(lines[i]);
          await new Promise((r) => this.tweens.add({ targets: txt, alpha: 1, duration: 700, onComplete: () => r() }));
          const res = await this.waitStory(rain, moth, t0);
          if (res === "skip") {
            skip = true;
            break;
          }
          if (i < lines.length - 1)
            await new Promise((r) => this.tweens.add({ targets: txt, alpha: 0, duration: 350, onComplete: () => r() }));
        }
        if (opts.card || !lines.length) {
          const res = await this.waitStory(rain, moth, t0);
          if (res === "skip")
            skip = true;
        }
        await new Promise((r) => this.tweens.add({ targets: c.list.filter((o) => o !== black), alpha: 0, duration: 700, onComplete: () => r() }));
        c.list.filter((o) => o !== black).forEach((o) => o.destroy());
      }
      this.fadeRect.setAlpha(1);
      c.destroy();
    }
    waitStory(rain, moth, t0) {
      return new Promise((res) => {
        let t = 0;
        this.modal = {
          update: (dt) => {
            t += dt;
            if (rain) {
              rain.tilePositionY -= dt * 900;
              rain.tilePositionX += dt * 280;
            }
            if (moth) {
              const k = (this.time.now - t0) / 1000;
              moth.setScale(1.4, 1.4 * (0.75 + Math.abs(Math.sin(k * 7)) * 0.25));
            }
            if (t > 0.4 && (Input.pressed("confirm") || Input.pressed("attack"))) {
              this.modal = null;
              sfx.menu();
              res("next");
            } else if (t > 0.2 && Input.pressed("back")) {
              this.modal = null;
              res("skip");
            }
          }
        };
      });
    }
    openMap() {
      const g = this.game_;
      const c = this.add.container(0, 0).setDepth(800);
      const bg = this.add.rectangle(0, 0, W, H, 328714, 0.92).setOrigin(0);
      c.add(bg);
      const area = g.room.area;
      const rooms = World.rooms.filter((r) => r.area.id === area.id);
      const minX = Math.min(...rooms.map((r) => r.x)), maxX = Math.max(...rooms.map((r) => r.x + r.w));
      const minY = Math.min(...rooms.map((r) => r.y)), maxY = Math.max(...rooms.map((r) => r.y + r.h));
      const s = Math.min((W - 200) / (maxX - minX), (H - 260) / (maxY - minY));
      const ox = W / 2 - (maxX + minX) / 2 * s, oy = H / 2 + 20 - (maxY + minY) / 2 * s;
      const gfx = this.add.graphics();
      c.add(gfx);
      for (const r of rooms) {
        const seen = Game.visited.has(r.id);
        if (!seen)
          continue;
        const cur2 = r === g.room;
        gfx.fillStyle(cur2 ? 3814488 : 1972780, 1);
        gfx.lineStyle(2, cur2 ? 16764794 : 12103896, cur2 ? 0.9 : 0.5);
        for (let y = 0;y < r.h; y++)
          for (let x = 0;x < r.w; x++)
            if (r.grid[y][x] !== "#")
              gfx.fillRect(ox + (r.x + x) * s, oy + (r.y + y) * s, Math.ceil(s), Math.ceil(s));
        gfx.strokeRect(ox + r.x * s, oy + r.y * s, r.w * s, r.h * s);
        if (r.name)
          c.add(this.add.text(ox + (r.x + r.w / 2) * s, oy + (r.y + r.h) * s + 4, r.name, { fontFamily: FONT, fontSize: "14px", color: cur2 ? "#ffcf7a" : "#8a84a8" }).setOrigin(0.5, 0));
        for (const e of r.spawns)
          if (e.type === "shrine")
            c.add(this.add.image(ox + (r.x + e.x + 0.5) * s, oy + (r.y + e.y) * s, "flame").setScale(0.9).setBlendMode(Phaser.BlendModes.ADD));
      }
      const P2 = g.player;
      const dot = this.add.image(ox + P2.cx / 16 * s, oy + P2.cy / 16 * s, "ui_paw").setScale(0.6).setTint(16764794);
      c.add(dot);
      this.tweens.add({ targets: dot, scale: 0.8, duration: 500, yoyo: true, repeat: -1 });
      c.add(this.add.text(W / 2, 50, area.name.toUpperCase(), { fontFamily: FONT, fontSize: "38px", color: "#e8e2ff", letterSpacing: 8 }).setOrigin(0.5));
      c.add(this.add.text(W / 2, H - 50, `Lives remembered: ${Game.save.shades.length} / 8     ·     Buttons: ${Game.save.buttons}     ·     M / Esc to close`, { fontFamily: FONT, fontSize: "20px", color: "#a8a0c8" }).setOrigin(0.5));
      sfx.menu();
      let t = 0;
      this.modal = { update: (dt) => {
        t += dt;
        if (t > 0.15 && (Input.pressed("map") || Input.pressed("back") || Input.pressed("pause"))) {
          this.modal = null;
          c.destroy();
          sfx.menu();
          Input.swallow();
        }
      } };
    }
    openPause() {
      const g = this.game_;
      const c = this.add.container(0, 0).setDepth(800);
      c.add(this.add.rectangle(0, 0, W, H, 328714, 0.8).setOrigin(0));
      c.add(this.add.text(W / 2, 170, "PAUSED", { fontFamily: FONT, fontSize: "48px", color: "#e8e2ff", letterSpacing: 12 }).setOrigin(0.5));
      const items = ["Resume", "Map", "Music volume", "Quit to title"];
      let sel = 0;
      let musicVol = 0.55;
      const texts = items.map((s, i) => {
        const t2 = this.add.text(W / 2, 290 + i * 60, s, { fontFamily: FONT, fontSize: "30px", color: "#b8b0d0" }).setOrigin(0.5);
        c.add(t2);
        return t2;
      });
      c.add(this.add.text(W / 2, H - 90, "Move: ← →   Jump: Z / Space   Scratch: X   Dash: C / Shift   Rest & talk: ↑   Map: M", { fontFamily: FONT, fontSize: "19px", color: "#8a84a8" }).setOrigin(0.5));
      const draw = () => texts.forEach((t2, i) => {
        t2.setColor(i === sel ? "#ffcf7a" : "#b8b0d0").setText((i === sel ? "›  " : "") + items[i] + (i === 2 ? `  ${"●".repeat(Math.round(musicVol * 10))}${"○".repeat(10 - Math.round(musicVol * 10))}` : "") + (i === sel ? "  ‹" : ""));
      });
      draw();
      sfx.menu();
      let t = 0;
      const close = () => {
        this.modal = null;
        c.destroy();
        Input.swallow();
      };
      this.modal = {
        update: (dt) => {
          t += dt;
          if (t < 0.15)
            return;
          if (Input.pressed("down")) {
            sel = (sel + 1) % items.length;
            sfx.menu();
            draw();
          }
          if (Input.pressed("up")) {
            sel = (sel + items.length - 1) % items.length;
            sfx.menu();
            draw();
          }
          if (sel === 2 && (Input.pressed("left") || Input.pressed("right"))) {
            musicVol = clamp(musicVol + (Input.pressed("right") ? 0.1 : -0.1), 0, 1);
            Audio.setVolume("music", musicVol);
            draw();
          }
          if (Input.pressed("pause") || Input.pressed("back")) {
            close();
            return;
          }
          if (Input.pressed("confirm") || Input.pressed("attack")) {
            sfx.confirm();
            if (sel === 0)
              close();
            else if (sel === 1) {
              close();
              this.openMap();
            } else if (sel === 3) {
              close();
              g.saveNow();
              g.goTitle();
            }
          }
        }
      };
    }
  }

  // src/scenes/BootScene.ts
  class BootScene extends Phaser.Scene {
    constructor() {
      super("boot");
    }
    preload() {
      const bar = this.add.rectangle(SCREEN_W / 2 - 200, SCREEN_H / 2, 0, 3, 15262463).setOrigin(0, 0.5);
      this.add.rectangle(SCREEN_W / 2, SCREEN_H / 2, 400, 3, 16777215, 0.12);
      this.add.text(SCREEN_W / 2, SCREEN_H / 2 - 30, "NIGHTPAW", { fontFamily: FONT, fontSize: "28px", color: "#8a84a8", letterSpacing: 10 }).setOrigin(0.5);
      this.load.on("progress", (p) => {
        bar.width = 400 * p;
      });
      this.load.json("art", "assets/art/art.json");
      this.load.once("filecomplete-json-art", (_k, _t, data) => {
        for (const key of Object.keys(data))
          this.load.image(key, `assets/art/${key}.png`);
      });
    }
    async create() {
      const cv = document.createElement("canvas");
      cv.width = 256;
      cv.height = 256;
      const c = cv.getContext("2d");
      c.strokeStyle = "rgba(200,210,255,0.35)";
      c.lineWidth = 1.5;
      for (let i = 0;i < 60; i++) {
        const x = Math.random() * 256, y = Math.random() * 256, l = 14 + Math.random() * 20;
        for (const ox of [0, 256, -256])
          for (const oy of [0, 256, -256]) {
            c.beginPath();
            c.moveTo(x + ox, y + oy);
            c.lineTo(x + ox - l * 0.3, y + oy + l);
            c.stroke();
          }
      }
      this.textures.addCanvas("rain_gen", cv);
      try {
        await World.load();
      } catch (e) {
        this.add.text(40, 40, `Could not load game content:
` + e.message, { fontFamily: "monospace", fontSize: "20px", color: "#ff8080" });
        return;
      }
      await Platform.init();
      await Game.loadFromPlatform();
      const q = new URLSearchParams(location.search);
      if (q.get("room")) {
        Game.startNew();
        for (const a of (q.get("abilities") ?? "").split(",").filter(Boolean))
          Game.give(a);
        for (const f of (q.get("flags") ?? "").split(",").filter(Boolean))
          Game.setFlag(f);
        this.scene.start("game", {});
        return;
      }
      this.scene.start("title");
    }
  }

  // src/scenes/TitleScene.ts
  class TitleScene extends Phaser.Scene {
    items = [];
    texts = [];
    sel = 0;
    confirmNew = false;
    motes = [];
    t = 0;
    hint;
    constructor() {
      super("title");
    }
    create() {
      this.cameras.main.fadeIn(1200, 0, 0, 0);
      const bg = this.add.image(SCREEN_W / 2, SCREEN_H / 2, "title_bg").setScale(1.06);
      this.tweens.add({ targets: bg, scale: 1, x: SCREEN_W / 2 - 20, duration: 20000, ease: "Sine.easeInOut", yoyo: true, repeat: -1 });
      for (let i = 0;i < 26; i++) {
        const m = this.add.image(Math.random() * SCREEN_W, 300 + Math.random() * 420, "fx_dot").setTint(16764794).setBlendMode(Phaser.BlendModes.ADD).setScale(0.3 + Math.random() * 0.4).setAlpha(0);
        m.seed = Math.random() * 100;
        this.motes.push(m);
      }
      const title = this.add.text(360, 210, "NIGHTPAW", { fontFamily: FONT, fontSize: "104px", color: "#f0ecff", letterSpacing: 18, stroke: "#07060a", strokeThickness: 4 }).setOrigin(0.5).setAlpha(0);
      title.setShadow(0, 0, "#9d8cff", 26, false, true);
      const sub = this.add.text(360, 290, "a tale from the Underneath", { fontFamily: FONT, fontSize: "28px", color: "#b8b0d8", fontStyle: "italic" }).setOrigin(0.5).setAlpha(0);
      this.tweens.add({ targets: title, alpha: 1, duration: 2200, delay: 400 });
      this.tweens.add({ targets: sub, alpha: 1, duration: 2200, delay: 1200 });
      const saved = Game.loaded && (Game.loaded.visited?.length || Game.loaded.flags?.intro_done);
      this.items = [];
      if (saved)
        this.items.push({ label: "Continue", act: () => this.continueGame() });
      this.items.push({ label: "New Game", act: () => this.newGame(!!saved) });
      this.texts = this.items.map((it, i) => this.add.text(360, 400 + i * 58, it.label, { fontFamily: FONT, fontSize: "32px", color: "#b8b0d0" }).setOrigin(0.5).setAlpha(0).setInteractive({ useHandCursor: true }).on("pointerover", () => {
        this.sel = i;
        this.draw();
      }).on("pointerdown", () => {
        this.sel = i;
        this.activate();
      }));
      this.texts.forEach((t, i) => this.tweens.add({ targets: t, alpha: 1, duration: 1200, delay: 2000 + i * 200 }));
      this.hint = this.add.text(360, SCREEN_H - 60, "Arrow keys / stick to choose · Z or Enter to begin", { fontFamily: FONT, fontSize: "18px", color: "#7a7498" }).setOrigin(0.5).setAlpha(0);
      this.tweens.add({ targets: this.hint, alpha: 1, duration: 1200, delay: 2600 });
      this.draw();
      Music.play("rhyme");
      Audio.ambience("rain");
      this.input.keyboard?.on("keydown", () => Audio.unlock());
    }
    draw() {
      this.texts.forEach((t, i) => t.setColor(i === this.sel ? "#ffcf7a" : "#b8b0d0").setText((i === this.sel ? "›  " : "") + (this.confirmNew && this.items[i].label === "New Game" ? "Start over? Press again" : this.items[i].label) + (i === this.sel ? "  ‹" : "")));
    }
    activate() {
      sfx.confirm();
      this.items[this.sel].act();
    }
    newGame(hasSave) {
      if (hasSave && !this.confirmNew) {
        this.confirmNew = true;
        this.draw();
        return;
      }
      Game.startNew();
      this.go({ cutscene: World.def.start.cutscene });
    }
    continueGame() {
      Game.resume(Game.loaded);
      this.go({ continue: true });
    }
    go(data) {
      this.input.enabled = false;
      this.items = [];
      Music.stop();
      this.cameras.main.fadeOut(900, 0, 0, 0);
      this.cameras.main.once("camerafadeoutcomplete", () => this.scene.start("game", data));
    }
    update(_t, deltaMs) {
      const dt = deltaMs / 1000;
      this.t += dt;
      for (const m of this.motes) {
        const s = m.seed;
        m.x += Math.sin(this.t * 0.5 + s) * 0.4;
        m.y -= 0.15 + Math.sin(s) * 0.05;
        m.setAlpha(0.3 + Math.sin(this.t * 1.5 + s) * 0.3);
        if (m.y < 250)
          m.y = 720;
      }
      Input.poll();
      if (this.items.length) {
        if (Input.pressed("down")) {
          this.sel = (this.sel + 1) % this.items.length;
          this.confirmNew = false;
          sfx.menu();
          this.draw();
        }
        if (Input.pressed("up")) {
          this.sel = (this.sel + this.items.length - 1) % this.items.length;
          this.confirmNew = false;
          sfx.menu();
          this.draw();
        }
        if (Input.pressed("confirm") || Input.pressed("attack"))
          this.activate();
      }
      Input.endStep();
    }
  }

  // src/scenes/BackdropScene.ts
  class BackdropScene extends Phaser.Scene {
    far;
    mid;
    fog;
    fog2;
    tint;
    area = "";
    t = 0;
    roomY = 0;
    constructor() {
      super("backdrop");
    }
    create() {
      this.cameras.main.setBackgroundColor("#07060a");
      this.far = this.add.tileSprite(0, 0, SCREEN_W, SCREEN_H, "__DEFAULT").setOrigin(0);
      this.mid = this.add.tileSprite(0, 0, SCREEN_W, SCREEN_H, "__DEFAULT").setOrigin(0).setAlpha(0.95);
      this.fog = this.add.tileSprite(0, SCREEN_H - 300, SCREEN_W, 300, "fog").setOrigin(0).setAlpha(0.45).setTileScale(2.5, 2.4);
      this.fog2 = this.add.tileSprite(0, SCREEN_H * 0.25, SCREEN_W, 260, "fog").setOrigin(0).setAlpha(0.22).setTileScale(3, 2);
    }
    setArea(a, r) {
      this.roomY = r.py;
      if (a.id === this.area)
        return;
      this.area = a.id;
      const scaleFor = (key) => {
        const h = this.textures.get(key).getSourceImage().height;
        return SCREEN_H * 1.2 / h;
      };
      this.far.setTexture(a.backdrop.far);
      this.far.setTileScale(scaleFor(a.backdrop.far));
      this.mid.setTexture(a.backdrop.mid);
      this.mid.setTileScale(scaleFor(a.backdrop.mid));
      this.far.setTint(a.backdrop.tint ?? 7104144);
      this.far.setAlpha(0.8);
      this.mid.setTint(5591150);
      this.mid.setAlpha(0.8);
      this.fog.setVisible(a.backdrop.fog !== false);
      this.fog2.setVisible(a.backdrop.fog !== false);
    }
    follow(camX, camY, dt) {
      if (!this.far)
        return;
      this.t += dt;
      const fs = this.far.tileScaleX, ms = this.mid.tileScaleX;
      this.far.tilePositionX = camX * ZOOM * 0.12 / fs;
      this.mid.tilePositionX = camX * ZOOM * 0.35 / ms;
      const dy = Math.max(-60, Math.min(60, (camY - this.roomY - 100) * ZOOM * 0.05));
      this.far.tilePositionY = (40 + dy * 0.5) / fs;
      this.mid.tilePositionY = (60 + dy) / ms;
      this.fog.tilePositionX = camX * ZOOM * 0.6 / 2.5 + this.t * 6;
      this.fog2.tilePositionX = camX * ZOOM * 0.25 / 3 - this.t * 4;
    }
  }

  // src/render/roomArt.ts
  var TP = T * ART;
  var MAX_CACHE = 5;
  var cacheOrder = [];
  function roomTexture(scene, r) {
    const key = `room_${r.id}`;
    const lightsKey = `${key}_lights`;
    if (scene.textures.exists(key)) {
      const i = cacheOrder.indexOf(key);
      if (i >= 0)
        cacheOrder.splice(i, 1);
      cacheOrder.push(key);
      return { key, lights: scene.registry.get(lightsKey) || [] };
    }
    const ts = r.area.tileset;
    const img = (k) => scene.textures.exists(k) ? scene.textures.get(k).getSourceImage() : null;
    const W2 = r.w * TP, H2 = r.h * TP;
    const cv = document.createElement("canvas");
    cv.width = W2;
    cv.height = H2;
    const c = cv.getContext("2d");
    const R = seeded(`room-${r.id}`);
    const wt = (lx, ly) => tileAt(r.x + lx, r.y + ly);
    const solidAt = (lx, ly) => {
      const ch = wt(lx, ly);
      return ch === "#";
    };
    const lights = [];
    const mask = document.createElement("canvas");
    mask.width = W2;
    mask.height = H2;
    const m = mask.getContext("2d");
    m.fillStyle = "#fff";
    for (let y = 0;y < r.h; y++)
      for (let x = 0;x < r.w; x++) {
        if (r.grid[y][x] !== "#")
          continue;
        const px = x * TP, py = y * TP;
        const up = solidAt(x, y - 1), dn = solidAt(x, y + 1), lf = solidAt(x - 1, y), rt = solidAt(x + 1, y);
        const inset = 3;
        m.fillRect(px + (lf ? 0 : inset), py + (up ? 0 : inset), TP - (lf ? 0 : inset) - (rt ? 0 : inset), TP - (up ? 0 : inset) - (dn ? 0 : inset));
        const lump = (cx, cy) => {
          m.beginPath();
          m.arc(cx, cy, 10 + R() * 12, 0, Math.PI * 2);
          m.fill();
        };
        if (!up)
          for (let i = 0;i < 2; i++)
            lump(px + 10 + R() * (TP - 20), py + 16 + R() * 6);
        if (!dn)
          for (let i = 0;i < 2; i++)
            lump(px + 10 + R() * (TP - 20), py + TP - 18 - R() * 4);
        if (!lf)
          for (let i = 0;i < 2; i++)
            lump(px + 16 + R() * 4, py + 10 + R() * (TP - 20));
        if (!rt)
          for (let i = 0;i < 2; i++)
            lump(px + TP - 18 - R() * 4, py + 10 + R() * (TP - 20));
      }
    c.drawImage(mask, 0, 0);
    c.globalCompositeOperation = "source-in";
    const rock = img(`${ts}_rock`);
    if (rock) {
      c.fillStyle = c.createPattern(rock, "repeat");
      c.fillRect(0, 0, W2, H2);
    } else {
      c.fillStyle = "#1d1a26";
      c.fillRect(0, 0, W2, H2);
    }
    const dist = r.grid.map((row) => row.map((ch) => ch === "#" ? 99 : 0));
    for (let pass = 0;pass < 4; pass++)
      for (let y = 0;y < r.h; y++)
        for (let x = 0;x < r.w; x++) {
          if (dist[y][x] === 0)
            continue;
          const nb = (xx, yy) => xx < 0 || yy < 0 || xx >= r.w || yy >= r.h ? solidAt(xx, yy) ? 99 : 0 : dist[yy][xx];
          dist[y][x] = Math.min(dist[y][x], nb(x - 1, y) + 1, nb(x + 1, y) + 1, nb(x, y - 1) + 1, nb(x, y + 1) + 1);
        }
    const dark = document.createElement("canvas");
    dark.width = W2;
    dark.height = H2;
    const d = dark.getContext("2d");
    for (let y = 0;y < r.h; y++)
      for (let x = 0;x < r.w; x++) {
        const v = dist[y][x];
        if (!v)
          continue;
        d.fillStyle = `rgba(4,3,8,${[0, 0.15, 0.62, 0.86, 0.95][Math.min(4, v)]})`;
        d.fillRect(x * TP - 16, y * TP - 16, TP + 32, TP + 32);
      }
    c.globalCompositeOperation = "source-atop";
    c.filter = "blur(18px)";
    c.drawImage(dark, 0, 0);
    c.filter = "none";
    c.globalCompositeOperation = "source-over";
    const top = [img(`${ts}_top`), img(`${ts}_top2`)].filter(Boolean);
    const bottom = img(`${ts}_bottom`), side = img(`${ts}_side`);
    for (let y = 0;y < r.h; y++)
      for (let x = 0;x < r.w; x++) {
        if (r.grid[y][x] !== "#")
          continue;
        const px = x * TP, py = y * TP;
        if (side && !solidAt(x - 1, y))
          c.drawImage(side, px + 2, py, 24, TP);
        if (side && !solidAt(x + 1, y)) {
          c.save();
          c.translate(px + TP - 2, py);
          c.scale(-1, 1);
          c.drawImage(side, 0, 0, 24, TP);
          c.restore();
        }
        if (bottom && !solidAt(x, y + 1) && wt(x, y + 1) !== "X")
          c.drawImage(bottom, px, py + TP - 10);
      }
    for (let y = 0;y < r.h; y++)
      for (let x = 0;x < r.w; x++) {
        if (r.grid[y][x] !== "#")
          continue;
        if (!solidAt(x, y - 1) && wt(x, y - 1) !== "X" && top.length)
          c.drawImage(top[Math.floor(R() * top.length)], x * TP, y * TP - 6);
      }
    const plank = img(`${ts}_plank`), thorns = img(`${ts}_thorns`);
    for (let y = 0;y < r.h; y++)
      for (let x = 0;x < r.w; x++) {
        const ch = r.grid[y][x];
        if (ch === "=" && plank)
          c.drawImage(plank, x * TP, y * TP - 2);
        if (ch === "^" && thorns) {
          c.save();
          if (R() < 0.5) {
            c.translate(x * TP + TP, 0);
            c.scale(-1, 1);
            c.drawImage(thorns, 0, y * TP + TP - 44 + 2);
          } else
            c.drawImage(thorns, x * TP, y * TP + TP - 44 + 2);
          c.restore();
        }
      }
    const amount = r.decor ?? 1;
    if (amount > 0) {
      const floorDecor = ["deco_mushroom", "deco_bones", "deco_teacup", "deco_key"].map((k) => [k, img(k)]).filter(([, i]) => i);
      const roots = img("deco_roots");
      for (let y = 1;y < r.h; y++)
        for (let x = 0;x < r.w; x++) {
          const floor = r.grid[y][x] === "#" && r.grid[y - 1][x] === ".";
          const ceil = r.grid[y - 1][x] === "#" && r.grid[y][x] === ".";
          if (floor && R() < 0.1 * amount && floorDecor.length) {
            const [k, im] = floorDecor[R() < 0.6 ? 0 : Math.floor(R() * floorDecor.length)];
            const dx = x * TP + R() * (TP - im.width), dy = y * TP - im.height + 4;
            c.drawImage(im, dx, dy);
            if (k === "deco_mushroom")
              lights.push({ x: (dx + 16) / ART, y: (dy + 14) / ART, r: 30, color: 10543359, a: 0.5 });
          }
          if (ceil && roots && R() < 0.14 * amount) {
            const s = 0.5 + R() * 0.6;
            c.drawImage(roots, x * TP + R() * 20, y * TP - 6, roots.width * s, roots.height * s);
          }
        }
    }
    scene.textures.addCanvas(key, cv);
    scene.registry.set(lightsKey, lights);
    cacheOrder.push(key);
    while (cacheOrder.length > MAX_CACHE) {
      const old = cacheOrder.shift();
      if (scene.textures.exists(old))
        scene.textures.remove(old);
    }
    return { key, lights };
  }

  // src/render/fx.ts
  class Fx {
    scene;
    parts = [];
    pool = [];
    constructor(scene) {
      this.scene = scene;
    }
    get(key, glow) {
      const img = this.pool.pop() ?? this.scene.add.image(0, 0, key);
      img.setTexture(key).setVisible(true).setAlpha(1).setDepth(DEPTH.fx).setRotation(0).clearTint();
      img.setBlendMode(glow ? Phaser.BlendModes.ADD : Phaser.BlendModes.NORMAL);
      return img;
    }
    burst(x, y, n, color, o = {}) {
      const spd = o.spd ?? 120, life = o.life ?? 0.6, size = o.size ?? 2, grav = o.grav ?? 300;
      const key = o.key ?? (o.glow ? "fx_dot" : "fx_dust");
      for (let i = 0;i < n; i++) {
        if (this.parts.length > 600)
          return;
        const a = Math.random() * Math.PI * 2, s = spd * (0.3 + Math.random() * 0.7);
        const img = this.get(key, !!o.glow);
        img.setTint(color);
        const L = life * (0.6 + Math.random() * 0.6);
        this.parts.push({ img, x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: L, max: L, grav, size: size * (0.6 + Math.random() * 0.8), spin: rand(-6, 6) });
      }
    }
    coins(x, y, n) {
      for (let i = 0;i < n; i++) {
        const img = this.get("button_coin", false);
        const a = -Math.PI / 2 + rand(-1.1, 1.1), s = rand(90, 190);
        this.parts.push({ img, x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 6, max: 6, grav: 500, size: 0.5, coin: true, homeT: rand(0.35, 0.6) });
      }
    }
    update(dt, px, py, isSolidAt) {
      let got = 0;
      for (const p of this.parts) {
        p.life -= dt;
        if (p.coin) {
          p.homeT -= dt;
          if (p.homeT <= 0) {
            const dx = px - p.x, dy = py - p.y, d = Math.hypot(dx, dy) || 1;
            p.vx = lerp(p.vx, dx / d * 320, 0.15);
            p.vy = lerp(p.vy, dy / d * 320, 0.15);
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            if (d < 8) {
              p.life = 0;
              got++;
            }
            continue;
          }
          p.vy += p.grav * dt;
          const nx = p.x + p.vx * dt, ny = p.y + p.vy * dt;
          if (isSolidAt(nx, ny)) {
            p.vx *= -0.4;
            p.vy *= -0.4;
          } else {
            p.x = nx;
            p.y = ny;
          }
          continue;
        }
        p.vy += p.grav * dt;
        p.vx *= 0.985;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }
      for (let i = this.parts.length - 1;i >= 0; i--) {
        const p = this.parts[i];
        if (p.life <= 0) {
          p.img.setVisible(false);
          this.pool.push(p.img);
          this.parts.splice(i, 1);
        }
      }
      return got;
    }
    render(dt) {
      for (const p of this.parts) {
        const k = Math.max(0, p.life / p.max);
        p.img.setPosition(p.x, p.y);
        if (p.coin) {
          p.img.setScale(INV_ART * 0.55).setRotation(p.img.rotation + dt * 8);
          continue;
        }
        p.img.setScale(p.size / 16 * (0.4 + k * 0.6) * 2).setAlpha(Math.min(1, k * 1.5));
        p.img.setRotation(p.img.rotation + (p.spin ?? 0) * dt);
      }
    }
    lights() {
      return this.parts.filter((p) => p.coin).map((p) => ({ x: p.x, y: p.y, r: 10, color: 16769184, a: 0.35 }));
    }
    clear() {
      for (const p of this.parts) {
        p.img.setVisible(false);
        this.pool.push(p.img);
      }
      this.parts = [];
    }
  }

  // src/render/puppet.ts
  class Puppet {
    scene;
    root;
    inner;
    parts = {};
    images = [];
    face = 1;
    scale;
    constructor(scene, def, scale = 1, depth = 0) {
      this.scene = scene;
      this.scale = scale;
      this.root = scene.add.container(0, 0).setDepth(depth);
      this.inner = scene.add.container(0, 0);
      this.root.add(this.inner);
      this.inner.add(this.build(def));
      this.root.setScale(INV_ART * scale);
    }
    build(d) {
      const s = this.scene;
      const hasKids = (d.behind?.length || 0) + (d.front?.length || 0) > 0;
      let img = null;
      if (d.key) {
        img = s.add.image(0, 0, d.key).setOrigin(d.ox ?? 0.5, d.oy ?? 0.5);
        if (d.add)
          img.setBlendMode(Phaser.BlendModes.ADD);
        if (d.alpha !== undefined)
          img.setAlpha(d.alpha);
        this.images.push(img);
      }
      let obj;
      if (hasKids || !img) {
        obj = s.add.container(d.x, d.y);
        (d.behind || []).forEach((c) => obj.add(this.build(c)));
        if (img)
          obj.add(img);
        (d.front || []).forEach((c) => obj.add(this.build(c)));
      } else {
        obj = img;
        img.setPosition(d.x, d.y);
      }
      obj.setRotation(d.rot ?? 0);
      obj.setScale(d.sx ?? 1, d.sy ?? 1);
      this.parts[d.name] = { obj, img, base: { x: d.x, y: d.y, rot: d.rot ?? 0, sx: d.sx ?? 1, sy: d.sy ?? 1 } };
      return obj;
    }
    set(name, p) {
      const r = this.parts[name];
      if (!r)
        return;
      const b = r.base;
      if (p.x !== undefined || p.y !== undefined)
        r.obj.setPosition(b.x + (p.x ?? 0), b.y + (p.y ?? 0));
      if (p.rot !== undefined)
        r.obj.setRotation(b.rot + p.rot);
      if (p.sx !== undefined || p.sy !== undefined)
        r.obj.setScale(b.sx * (p.sx ?? 1), b.sy * (p.sy ?? 1));
      if (p.alpha !== undefined)
        r.obj.setAlpha(p.alpha);
      if (p.visible !== undefined)
        r.obj.setVisible(p.visible);
    }
    get(name) {
      return this.parts[name]?.obj;
    }
    place(x, y, face = this.face) {
      this.face = face;
      this.root.setPosition(x, y);
      this.root.setScale(INV_ART * this.scale * face, INV_ART * this.scale);
    }
    squash(sx, sy) {
      this.inner.setScale(sx, sy);
    }
    lean(rot) {
      this.inner.setRotation(rot);
    }
    flash(on, color = 16777215) {
      for (const i of this.images) {
        if (on)
          i.setTintFill(color);
        else
          i.clearTint();
      }
    }
    tint(color) {
      for (const i of this.images) {
        if (color === null)
          i.clearTint();
        else
          i.setTint(color);
      }
    }
    setAlpha(a) {
      this.root.setAlpha(a);
    }
    setVisible(v) {
      this.root.setVisible(v);
    }
    setDepth(d) {
      this.root.setDepth(d);
    }
    destroy() {
      this.root.destroy();
    }
  }
  function chain(prefix, key, n, step, scale0 = 1, scale1 = 0.6, ox = 0.5, oy = 0.5, vertical = false) {
    let node = null;
    for (let i = n - 1;i >= 0; i--) {
      const s = scale0 + (scale1 - scale0) * (i / Math.max(1, n - 1));
      const d = { name: `${prefix}${i}`, key, x: i === 0 || vertical ? 0 : -step, y: i > 0 && vertical ? step : 0, ox, oy, sx: s / (i === 0 ? 1 : scale0 + (scale1 - scale0) * ((i - 1) / Math.max(1, n - 1))), sy: 0 };
      d.sy = d.sx;
      if (node)
        d.behind = [node];
      node = d;
    }
    return node;
  }

  // src/render/rigs.ts
  function miteRig() {
    return {
      name: "root",
      x: 0,
      y: 0,
      front: [
        { name: "legs", x: 0, y: -10, behind: [
          { name: "l0", key: "mite_leg", x: -18, y: 0, ox: 0.5, oy: 0.1 },
          { name: "l1", key: "mite_leg", x: -6, y: 0, ox: 0.5, oy: 0.1 },
          { name: "l2", key: "mite_leg", x: 6, y: 0, ox: 0.5, oy: 0.1 },
          { name: "l3", key: "mite_leg", x: 18, y: 0, ox: 0.5, oy: 0.1 }
        ] },
        { name: "shell", key: "mite_shell", x: 0, y: -12, ox: 0.5, oy: 0.85, rot: 0.25, front: [
          { name: "face", key: "mite_face", x: 22, y: 2, sx: 0.7, sy: 0.7 }
        ] }
      ]
    };
  }
  function sockRig() {
    return {
      name: "root",
      x: 0,
      y: 0,
      front: [{
        name: "cuff",
        key: "sock_cuff",
        x: 0,
        y: -40,
        rot: 0,
        front: [
          { name: "eyes", key: "sock_eyes", x: 0, y: 2 },
          { name: "mid", key: "sock_mid", x: 0, y: 18, ox: 0.5, oy: 0.1, behind: [], front: [
            { name: "foot", key: "sock_foot", x: 6, y: 18, ox: 0.2, oy: 0.2 }
          ] }
        ]
      }]
    };
  }
  function snailRig() {
    return {
      name: "root",
      x: 0,
      y: 0,
      front: [
        { name: "body", key: "snail_body", x: 4, y: -12, front: [
          { name: "stalk1", key: "snail_stalk", x: 24, y: -10, ox: 0.5, oy: 1, rot: 0.2 },
          { name: "stalk2", key: "snail_stalk", x: 28, y: -8, ox: 0.5, oy: 1, rot: 0.5 }
        ] },
        { name: "shell", key: "snail_shell", x: -6, y: -30 }
      ]
    };
  }
  function toadRig() {
    return {
      name: "root",
      x: 0,
      y: 0,
      front: [
        { name: "legB", key: "toad_leg", x: -18, y: -8, ox: 0.2, oy: 0.3 },
        { name: "body", key: "toad_body", x: 0, y: -22, oy: 0.55, front: [
          { name: "eye", key: "toad_eye", x: 14, y: -12 }
        ] },
        { name: "legF", key: "toad_leg", x: 14, y: -8, ox: 0.2, oy: 0.3, sx: 0.8, sy: 0.8 }
      ]
    };
  }
  function wardenRig() {
    return {
      name: "root",
      x: 0,
      y: 0,
      front: [{
        name: "coat",
        key: "warden_coat",
        x: 0,
        y: -84,
        oy: 0.5,
        behind: [
          { name: "armB", key: "warden_arm", x: -34, y: -60, ox: 0.5, oy: 0.05, rot: 0.15 }
        ],
        front: [
          { name: "head", key: "warden_head", x: 0, y: -96, oy: 0.8, front: [
            { name: "eyeL", key: "warden_eye", x: -9, y: -26, add: true },
            { name: "eyeR", key: "warden_eye", x: 9, y: -26, add: true }
          ] },
          { name: "armF", key: "warden_arm", x: 36, y: -60, ox: 0.5, oy: 0.05, rot: -0.15 }
        ]
      }]
    };
  }
  function mothRig() {
    return {
      name: "root",
      x: 0,
      y: 0,
      front: [{
        name: "body",
        key: "moth_body",
        x: 0,
        y: -30,
        rot: 0.25,
        behind: [
          { name: "wingB", key: "moth_wing", x: -2, y: -10, ox: 0.1, oy: 0.85, rot: -1.45, alpha: 0.8 },
          { name: "antB", key: "moth_antenna", x: 6, y: -24, ox: 0.1, oy: 0.95, rot: -0.2 }
        ],
        front: [
          { name: "wingF", key: "moth_wing", x: 0, y: -6, ox: 0.1, oy: 0.85, rot: -1.05 },
          { name: "antF", key: "moth_antenna", x: 8, y: -24, ox: 0.1, oy: 0.95, rot: 0.1 },
          { name: "candle", key: "candle", x: 16, y: 12, sx: 0.8, sy: 0.8, front: [{ name: "flame", key: "flame", x: 0, y: -24, add: true }] }
        ]
      }]
    };
  }
  function mouseRig() {
    return {
      name: "root",
      x: 0,
      y: 0,
      front: [
        { name: "tail", key: "mouse_tail", x: -22, y: -10, ox: 1, oy: 0.3 },
        { name: "body", key: "mouse_body", x: 0, y: -20, behind: [
          { name: "pack", key: "mouse_pack", x: -14, y: -6 }
        ], front: [
          { name: "head", key: "mouse_head", x: 14, y: -18, ox: 0.3, oy: 0.7, behind: [
            { name: "earB", key: "mouse_ear", x: 2, y: -16 }
          ], front: [
            { name: "earF", key: "mouse_ear", x: 10, y: -14 }
          ] }
        ] }
      ]
    };
  }
  function nightpawRig() {
    return {
      name: "root",
      x: 0,
      y: 0,
      front: [
        { name: "tailRoot", x: -22, y: -18, rot: 1.3, front: [chain("tail", "np_tail", 10, 6.5, 1.05, 0.6)] },
        { name: "legFar", key: "np_leg", x: -5, y: -21, ox: 0.5, oy: 0.05 },
        { name: "legNear", key: "np_leg", x: 6, y: -21, ox: 0.5, oy: 0.05 },
        {
          name: "body",
          x: 0,
          y: -16,
          behind: [{ name: "lining", key: "np_lining", x: 0, y: -38, ox: 0.5, oy: 0.02, sx: 0.9, sy: 0.8, alpha: 0 }],
          front: [
            { name: "cloak", key: "np_cloak", x: 0, y: -40, ox: 0.5, oy: 0.02, sy: 0.85, front: [
              { name: "hem", key: "np_hem", x: 0, y: 32, ox: 0.5, oy: 0.05 }
            ] },
            { name: "arm", key: "np_arm", x: 7, y: -30, ox: 0.5, oy: 0.06, alpha: 0, front: [
              { name: "claws", key: "np_claws", x: 1, y: 24, ox: 0.5, oy: 0 }
            ] },
            {
              name: "head",
              x: 2,
              y: -42,
              behind: [{ name: "earB", key: "np_ear", x: -13, y: -28, ox: 0.5, oy: 0.95, rot: -0.28 }],
              key: "np_head",
              ox: 0.5,
              oy: 0.75,
              front: [
                { name: "earF", key: "np_ear", x: 13, y: -29, ox: 0.5, oy: 0.95, rot: 0.26 },
                { name: "eyeB", key: "np_eye", x: -6, y: -13, sx: 0.88, sy: 0.9 },
                { name: "eyeF", key: "np_eye", x: 11, y: -13 },
                { name: "mask", key: "np_mask", x: 4, y: 3, sy: 0.72, sx: 0.95 }
              ]
            }
          ]
        }
      ]
    };
  }

  // src/entities/player.ts
  class Player {
    g;
    x = 0;
    y = 0;
    w = 10;
    h = 14;
    vx = 0;
    vy = 0;
    face = 1;
    onGround = false;
    hitX = false;
    hitCeil = false;
    landed = false;
    hp = 4;
    coyote = 0;
    buffer = 0;
    airJumps = 0;
    airDash = true;
    dashT = 0;
    dashCd = 0;
    dropT = 0;
    atkT = 0;
    atkAnim = 0;
    atkCd = 0;
    atkDir = "side";
    hitSet = new Set;
    invuln = 0;
    knockT = 0;
    knockVx = 0;
    recoilT = 0;
    hazardT = 0;
    dead = false;
    deadT = 0;
    resting = false;
    safeX = 0;
    safeY = 0;
    locked = false;
    scripted = null;
    hidden = false;
    landT = 0;
    stepT = 0;
    runPhase = 0;
    blinkT = 3;
    earT = 2;
    t = 0;
    puppet;
    slash;
    shadow;
    sleepy = 0;
    constructor(g) {
      this.g = g;
      const s = g.scene;
      this.shadow = s.add.image(0, 0, "fx_shadow").setScale(INV_ART * 0.8).setDepth(DEPTH.player - 1).setAlpha(0.6);
      this.puppet = new Puppet(s, nightpawRig(), 0.78, DEPTH.player);
      this.slash = s.add.image(0, 0, "fx_claw").setScale(INV_ART * 0.62).setDepth(DEPTH.fx).setVisible(false).setBlendMode(Phaser.BlendModes.ADD);
      this.hp = Game.save.maxHp;
    }
    get cx() {
      return this.x + this.w / 2;
    }
    get cy() {
      return this.y + this.h / 2;
    }
    place(x, y) {
      this.x = x;
      this.y = y;
      this.safeX = x;
      this.safeY = y;
      this.vx = this.vy = 0;
    }
    input() {
      if (this.locked) {
        const s = this.scripted;
        return { dir: s ? s.dir : 0, jumpP: !!s?.jump, jumpH: !!s?.jump, jumpR: false, dashP: false, atkP: false, up: false, down: false, upP: false };
      }
      return {
        dir: (Input.held("right") ? 1 : 0) - (Input.held("left") ? 1 : 0),
        jumpP: Input.pressed("jump"),
        jumpH: Input.held("jump"),
        jumpR: Input.released("jump"),
        dashP: Input.pressed("dash"),
        atkP: Input.pressed("attack"),
        up: Input.held("up"),
        down: Input.held("down"),
        upP: Input.pressed("up")
      };
    }
    update(dt) {
      this.t += dt;
      if (this.dead) {
        this.deadT += dt;
        return;
      }
      if (this.hazardT > 0) {
        this.hazardT -= dt;
        if (this.hazardT <= 0) {
          this.x = this.safeX;
          this.y = this.safeY;
          this.vx = this.vy = 0;
          this.g.afterHazard?.();
        }
        return;
      }
      this.invuln = Math.max(0, this.invuln - dt);
      this.dashCd = Math.max(0, this.dashCd - dt);
      this.atkCd = Math.max(0, this.atkCd - dt);
      this.dropT = Math.max(0, this.dropT - dt);
      this.landT = Math.max(0, this.landT - dt);
      const I = this.input();
      const dir = I.dir;
      if (this.scripted?.jump)
        this.scripted.jump = false;
      if (this.resting) {
        if (!this.locked && (dir || I.jumpP || I.atkP || I.down))
          this.resting = false;
        else {
          this.vx = 0;
          this.vy = Math.min(PH.MAXFALL, this.vy + PH.G * dt);
          moveBody(this, dt);
          return;
        }
      }
      if (this.dashT > 0) {
        this.dashT -= dt;
        this.vx = this.face * PH.DASH;
        this.vy = 0;
        if (Math.random() < 0.7)
          this.g.burst(this.cx - this.face * 4, this.y + rand(3, 12), 1, 1841190, { spd: 40, life: 0.35, size: 3, grav: 0 });
      } else if (this.knockT > 0) {
        this.knockT -= dt;
        this.vx = this.knockVx;
      } else if (this.recoilT > 0) {
        this.recoilT -= dt;
        this.vx = -this.face * 110 + dir * 30;
      } else {
        this.vx = dir * PH.RUN * (this.locked && this.scripted ? 0.75 : 1);
        if (dir)
          this.face = dir;
      }
      this.coyote = this.onGround ? PH.COYOTE : this.coyote - dt;
      this.buffer = I.jumpP ? PH.BUFFER : this.buffer - dt;
      if (this.buffer > 0 && I.down && this.onGround && boxHasTile(this.x, this.y + this.h, this.w, 1, (ch) => ch === "=") && !boxHasTile(this.x, this.y + this.h, this.w, 1, isSolid)) {
        this.dropT = 0.22;
        this.buffer = 0;
        this.onGround = false;
        this.y += 1;
      } else if (this.buffer > 0 && this.coyote > 0 && this.dashT <= 0) {
        this.vy = -PH.JUMP;
        this.coyote = 0;
        this.buffer = 0;
        this.onGround = false;
        sfx.jump();
        this.g.burst(this.cx, this.y + this.h, 5, 3814472, { spd: 50, life: 0.35, size: 2, grav: 100, key: "fx_dust" });
        this.puppet.squash(0.8, 1.25);
        this.stretchT = 0.12;
      } else if (this.buffer > 0 && !this.onGround && Game.has("wings") && this.airJumps > 0 && this.dashT <= 0) {
        this.vy = -PH.JUMP2;
        this.airJumps--;
        this.buffer = 0;
        sfx.wing();
        this.wingT = 0.35;
        this.g.burst(this.cx, this.y + 10, 12, 15327999, { spd: 70, life: 0.6, size: 1.6, grav: 60, glow: true });
      }
      if ((I.jumpR || this.locked && !I.jumpH && this.vy < -60 && false) && this.vy < -60)
        this.vy *= 0.45;
      if (I.dashP && Game.has("dash") && this.dashCd <= 0 && this.dashT <= 0 && (this.onGround || this.airDash)) {
        this.dashT = PH.DASHT;
        this.dashCd = 0.45;
        this.vy = 0;
        sfx.dash();
        if (dir)
          this.face = dir;
        if (!this.onGround)
          this.airDash = false;
        this.afterT = 0;
      }
      if (this.dashT <= 0)
        this.vy = Math.min(PH.MAXFALL, this.vy + PH.G * dt);
      if (I.atkP && this.atkCd <= 0) {
        this.atkDir = I.up ? "up" : I.down && !this.onGround ? "down" : "side";
        this.atkT = 0.1;
        this.atkAnim = 0.22;
        this.atkCd = 0.3;
        this.hitSet = new Set;
        sfx.slash();
        this.showSlash();
      }
      this.atkAnim = Math.max(0, this.atkAnim - dt);
      if (this.atkT > 0) {
        this.atkT -= dt;
        this.resolveAttack();
      }
      const vyBefore = this.vy;
      moveBody(this, dt);
      if (this.landed && vyBefore > 200) {
        sfx.land();
        this.landT = 0.12;
        this.g.burst(this.cx, this.y + this.h, 6, 2893880, { spd: 60, life: 0.4, size: 2, grav: 80, key: "fx_dust" });
        this.puppet.squash(1.25, 0.72);
        this.stretchT = 0.14;
      }
      if (this.onGround) {
        this.airJumps = Game.has("wings") ? 1 : 0;
        this.airDash = true;
        const footL = tileAt(Math.floor(this.x / T), Math.floor((this.y + this.h + 1) / T));
        const footR = tileAt(Math.floor((this.x + this.w - 0.01) / T), Math.floor((this.y + this.h + 1) / T));
        const nearSpike = boxHasTile(this.x - 12, this.y - 4, this.w + 24, this.h + 8, (ch) => ch === "^");
        if (isSolid(footL) && isSolid(footR) && !nearSpike) {
          this.safeX = this.x;
          this.safeY = this.y;
        }
        if (this.vx) {
          this.stepT -= dt;
          if (this.stepT <= 0) {
            sfx.step();
            this.stepT = 0.26;
          }
        }
      }
      if (boxHasTile(this.x + 3, this.y + 4, this.w - 6, this.h - 4, (ch, _tx, ty) => ch === "^" && this.y + this.h > ty * T + 7))
        this.g.hurtPlayer(1, this.cx, true);
    }
    stretchT = 0;
    wingT = 0;
    afterT = 0;
    attackBox() {
      const cx = this.cx;
      if (this.atkDir === "up")
        return { x: cx - 13, y: this.y - 26, w: 26, h: 28 };
      if (this.atkDir === "down")
        return { x: cx - 13, y: this.y + this.h - 2, w: 26, h: 26 };
      return this.face > 0 ? { x: this.x + this.w - 2, y: this.y - 5, w: 28, h: 22 } : { x: this.x - 26, y: this.y - 5, w: 28, h: 22 };
    }
    resolveAttack() {
      const box = this.attackBox();
      let pogo = false;
      for (const e of this.g.ents) {
        if (!e.hittable || e.dead || this.hitSet.has(e) || !overlap(box, e))
          continue;
        this.hitSet.add(e);
        const dir = this.atkDir === "side" ? this.face : Math.sign(e.cx - this.cx) || 1;
        if (!e.onHit(1, dir, this.atkDir))
          continue;
        sfx.hit();
        this.g.hitstop(0.05);
        this.g.shake(3);
        const hx = clamp(this.cx + this.face * 14, e.x, e.x + e.w), hy = clamp(this.y + 6, e.y, e.y + e.h);
        this.g.burst(hx, hy, 8, 16777215, { spd: 160, life: 0.3, size: 1.6, grav: 0, glow: true });
        if (this.atkDir === "down")
          pogo = true;
        else if (this.atkDir === "side")
          this.recoilT = 0.08;
      }
      if (this.atkDir === "down" && boxHasTile(box.x, box.y, box.w, box.h, (ch) => ch === "^"))
        pogo = true;
      if (pogo && !this.hitSet.has("pogo")) {
        this.hitSet.add("pogo");
        this.vy = -PH.POGO;
        this.airJumps = Game.has("wings") ? 1 : 0;
        this.airDash = true;
        this.atkT = 0;
      }
      if (!this.hitSet.has("wall")) {
        let hitTile = null;
        const probe = this.atkDir === "side" ? { x: box.x + (this.face > 0 ? 14 : 0), y: box.y + 6, w: 14, h: 10 } : box;
        boxHasTile(probe.x, probe.y, probe.w, probe.h, (ch, tx, ty) => {
          if (ch === "X") {
            hitTile = [tx, ty];
            return true;
          }
          return false;
        });
        if (hitTile) {
          this.hitSet.add("wall");
          this.g.hitWall(hitTile[0], hitTile[1], this.face);
        } else if (this.atkDir === "side" && boxHasTile(probe.x, probe.y, probe.w, probe.h, isSolid)) {
          this.hitSet.add("wall");
          sfx.clink();
          this.g.burst(this.face > 0 ? box.x + box.w - 6 : box.x + 6, this.y + 6, 6, 16771496, { spd: 120, life: 0.25, size: 1.2, grav: 0, glow: true });
        }
      }
    }
    showSlash() {
      const s = this.slash;
      s.setVisible(true).setAlpha(1);
      const k = this.atkDir;
      s.setFlipX(false);
      if (k === "side") {
        s.setRotation(0);
        s.setScale(INV_ART * 0.62 * this.face, INV_ART * 0.62);
      } else {
        s.setScale(INV_ART * 0.62, INV_ART * 0.62);
        s.setRotation(k === "up" ? -Math.PI / 2 : Math.PI / 2);
      }
      this.g.scene.tweens.killTweensOf(s);
      this.g.scene.tweens.add({ targets: s, alpha: 0, duration: 200, ease: "Quad.easeIn", onComplete: () => s.setVisible(false) });
    }
    render(dt) {
      const p = this.puppet;
      const feetX = this.cx, feetY = this.y + this.h;
      p.place(feetX, feetY + 0.5, this.face);
      const visible = !this.hidden && !(this.invuln > 0 && Math.floor(this.invuln * 20) % 2 === 0 && !this.dead);
      p.setVisible(visible);
      this.shadow.setVisible(!this.hidden && this.onGround).setPosition(feetX, feetY + 0.5);
      if (this.slash.visible) {
        const k = this.atkDir;
        if (k === "side")
          this.slash.setPosition(this.cx + this.face * 6, this.y + 5);
        else if (k === "up")
          this.slash.setPosition(this.cx, this.y - 6);
        else
          this.slash.setPosition(this.cx, this.y + this.h + 4);
        this.slash.setOrigin(k === "side" ? 0.1 : 0.1, 0.5);
      }
      this.stretchT = Math.max(0, this.stretchT - dt);
      const inner = p.inner;
      let sx = damp(inner.scaleX, 1, 14, dt), sy = damp(inner.scaleY, 1, 14, dt);
      if (this.dashT > 0) {
        sx = 1.3;
        sy = 0.82;
      }
      p.squash(sx, sy);
      const t = this.t;
      const air = !this.onGround && !this.resting;
      const running = this.onGround && Math.abs(this.vx) > 5 && this.dashT <= 0;
      this.runPhase += dt * (running ? 14 : 0);
      const ph = this.runPhase;
      this.sleepy = damp(this.sleepy, this.resting || this.dead ? 1 : 0, 6, dt);
      const Z = this.sleepy;
      const speed = Math.min(1, Math.abs(this.vx) / PH.RUN);
      let lean = 0, bodyY = 0, headRot = 0, headY = 0, legN = 0, legF = 0, legLift = 0;
      if (running) {
        legN = Math.sin(ph) * 0.75;
        legF = Math.sin(ph + Math.PI) * 0.75;
        bodyY = -Math.abs(Math.cos(ph)) * 2.5;
        lean = 0.1;
        headRot = Math.sin(ph * 2) * 0.03;
      } else if (air) {
        const up = this.vy < 0;
        legN = up ? -0.5 : 0.25;
        legF = up ? 0.4 : -0.2;
        legLift = up ? 6 : 0;
        lean = up ? -0.04 : 0.05;
        headRot = up ? -0.06 : 0.06;
      } else {
        bodyY = Math.sin(t * 2) * 0.8;
        headY = Math.sin(t * 2 + 0.6) * 0.7;
        headRot = Math.sin(t * 0.55) * 0.05;
      }
      if (this.dashT > 0) {
        lean = 0.45;
        legN = -0.9;
        legF = -1.1;
        legLift = 4;
      }
      if (this.landT > 0)
        bodyY += 3;
      bodyY = bodyY * (1 - Z) + 10 * Z;
      lean *= 1 - Z;
      headRot = headRot * (1 - Z) + 0.12 * Z;
      headY *= 1 - Z;
      let armA = 0, armRot = 0, armX = 0, armY = 0;
      if (this.atkAnim > 0) {
        const a = this.atkAnim / 0.22, k = 1 - a;
        armA = Math.min(1, a * 3);
        if (this.atkDir === "side") {
          armRot = -2.4 + k * 1.9;
          armX = 3;
          lean += 0.12 * a;
          headRot -= 0.06 * a;
        } else if (this.atkDir === "up") {
          armRot = -3 + k * 0.9;
          armY = -4;
          lean -= 0.1 * a;
          headRot -= 0.18 * a;
        } else {
          armRot = -0.6 + k * 0.9;
          armY = 2;
          lean += 0.12 * a;
          headRot += 0.15 * a;
        }
      }
      p.set("body", { y: bodyY, rot: lean });
      p.set("legNear", { rot: legN, y: -legLift, sy: 1 - Z * 0.6 });
      p.set("legFar", { rot: legF, y: -legLift, sy: 1 - Z * 0.6 });
      p.set("head", { y: headY, rot: headRot });
      p.set("arm", { alpha: armA, rot: armRot, x: armX, y: armY });
      const flow = Math.min(1.3, speed * 0.6 + (this.dashT > 0 ? 0.9 : 0));
      const flare = air ? this.vy > 0 ? 1 : 0.4 : 0;
      const sway = Math.sin(t * (2 + flow * 6)) * (0.03 + flow * 0.05);
      p.set("cloak", { rot: flow * 0.22 + sway - lean * 0.5, sx: 1 + flare * 0.1 + Z * 0.12 });
      p.set("hem", { rot: flow * 0.35 + Math.sin(t * (2.6 + flow * 7) - 1) * (0.05 + flow * 0.08), sx: 1 + flare * 0.22 + Z * 0.18, sy: 1 - flare * 0.25 - Z * 0.2 });
      p.set("lining", { alpha: Math.min(1, flare * 0.9 + flow * 0.5), rot: flow * 0.3 });
      for (let i = 0;i < 10; i++) {
        const wave = Math.sin(t * (1.6 + speed * 3.5) - i * 0.55) * (0.07 + speed * 0.04);
        const base = i === 0 ? -0.45 - speed * 0.4 - (this.dashT > 0 ? 0.9 : 0) + Z * 1.2 : i > 6 ? 0.2 : 0.01;
        p.set(`tail${i}`, { rot: base + wave });
      }
      this.earT -= dt;
      if (this.earT < -0.15)
        this.earT = rand(2, 6);
      const twitch = this.earT < 0 ? -0.3 : 0;
      const earsBack = this.dashT > 0 ? -0.55 : air && this.vy > 0 ? -0.3 : 0;
      p.set("earF", { rot: -earsBack * 0.9 + twitch });
      p.set("earB", { rot: earsBack * 0.9 });
      this.blinkT -= dt;
      if (this.blinkT < -0.1)
        this.blinkT = rand(2.5, 6);
      const eyeS = this.blinkT < 0 || Z > 0.6 || this.dead ? 0.1 : 1;
      p.set("eyeF", { sy: eyeS });
      p.set("eyeB", { sy: eyeS * 0.9 });
      if (this.dashT > 0) {
        this.afterT -= dt;
        if (this.afterT <= 0) {
          this.afterT = 0.04;
          this.g.afterimage?.(this);
        }
      }
      if (this.dead) {
        p.setAlpha(Math.max(0, 1 - this.deadT * 0.8));
        p.lean(Math.min(1.4, this.deadT * 3) * -this.face * 0.4);
      } else {
        p.setAlpha(1);
        p.lean(0);
      }
    }
    destroy() {
      this.puppet.destroy();
      this.slash.destroy();
      this.shadow.destroy();
    }
  }

  // src/entities/entity.ts
  class Entity {
    g;
    def;
    x;
    y;
    w = 12;
    h = 12;
    vx = 0;
    vy = 0;
    face = 1;
    dead = false;
    hp = 1;
    maxHp = 1;
    harm = 0;
    hittable = false;
    flashT = 0;
    t = Math.random() * 5;
    id;
    name = "";
    onGround = false;
    hitX = false;
    hitCeil = false;
    landed = false;
    constructor(g, def, x, y) {
      this.g = g;
      this.def = def;
      this.x = x;
      this.y = y;
      this.id = def.id ?? `${def.type}:${x},${y}`;
    }
    get cx() {
      return this.x + this.w / 2;
    }
    get cy() {
      return this.y + this.h / 2;
    }
    update(_dt) {}
    onHit(_dmg, _dir, _kind) {
      return false;
    }
    interact() {
      return false;
    }
    interactLabel() {
      return null;
    }
    light() {
      return null;
    }
    destroy() {}
    render(_dt) {}
  }
  var registry = new Map;
  function register(type, f) {
    registry.set(type, f);
  }
  function create(g, def, x, y) {
    const f = registry.get(def.type);
    if (!f) {
      console.warn("Unknown entity type", def.type);
      return null;
    }
    return f(g, def, x, y);
  }

  // src/entities/warden.ts
  class Warden extends Entity {
    puppet;
    state = "dormant";
    st = 0;
    constructor(g, d, x, y) {
      super(g, d, x, y);
      this.w = 34;
      this.h = 38;
      this.hp = this.maxHp = 28;
      this.face = -1;
      this.name = "The Hollow Warden";
      this.puppet = new Puppet(g.scene, wardenRig(), 0.6, DEPTH.enemy);
      this.hittable = true;
    }
    static get defeated() {
      return !!Game.flag("warden_dead");
    }
    wake() {
      if (this.state === "dormant")
        this.set("intro");
    }
    set(s) {
      this.state = s;
      this.st = 0;
    }
    onHit(dmg, _dir, _kind) {
      if (["dormant", "intro", "dying", "gone"].includes(this.state))
        return false;
      this.hp -= dmg;
      this.flashT = 0.1;
      if (this.hp <= 0)
        this.die();
      return true;
    }
    die() {
      this.set("dying");
      this.harm = 0;
      this.g.hitstop(0.35);
      this.g.shake(12);
      sfx.roar();
      Music.stop();
      Audio.ambience("hollows");
    }
    update(dt) {
      this.st += dt;
      const P2 = this.g.player;
      const pcx = P2.cx, bcx = this.cx;
      if (this.state === "dormant" || this.state === "gone")
        return;
      if (this.state === "dying") {
        this.vx = 0;
        if (Math.random() < 0.5)
          this.g.burst(this.x + rand(0, this.w), this.y + rand(0, this.h), 3, Math.random() < 0.5 ? 16726863 : 1314584, { spd: 120, life: 0.6, size: 2.5 });
        if (this.st > 1.8) {
          this.set("gone");
          this.g.bossBar(null);
          this.g.shake(14);
          this.g.burst(bcx, this.cy, 60, 1182998, { spd: 240, life: 1.4, size: 4, grav: 120 });
          this.g.burst(bcx, this.cy, 30, 16726863, { spd: 200, life: 1, size: 2, glow: true, grav: 0 });
          this.g.dropCoins(bcx, this.cy, 30);
          Game.setFlag("warden_dead");
          Game.achieve("warden");
          this.g.runCutscene("warden_defeat", { entity: this });
        }
        return;
      }
      const m = this.hp < this.maxHp / 2 ? 1.3 : 1;
      this.harm = this.state === "intro" ? 0 : 1;
      this.vy = Math.min(PH.MAXFALL, this.vy + PH.G * dt);
      const toward = () => {
        this.face = pcx < bcx ? -1 : 1;
      };
      switch (this.state) {
        case "intro":
          this.vx = 0;
          if (this.st > 1.2)
            this.set("idle");
          break;
        case "idle": {
          this.vx = 0;
          toward();
          if (this.st > 0.8 / m && !P2.dead) {
            const d = Math.abs(pcx - bcx), r = Math.random();
            if (m > 1 && r < 0.22 && this.lastAttack !== "rain") {
              this.set("windRain");
              this.lastAttack = "rain";
              break;
            }
            const pick = d > 130 ? r < 0.5 ? "windCharge" : "windLeap" : r < 0.3 ? "walk" : r < 0.65 ? "windLeap" : "windCharge";
            this.lastAttack = pick;
            this.set(pick);
          }
          break;
        }
        case "walk":
          toward();
          this.vx = this.face * 60 * m;
          if (this.st > 1)
            this.set("idle");
          break;
        case "windCharge":
          this.vx = 0;
          toward();
          if (this.st > 0.6 / m) {
            this.set("charge");
            sfx.dash();
          }
          break;
        case "charge":
          this.vx = this.face * 240 * m;
          if (Math.random() < 0.7)
            this.g.burst(bcx - this.face * 16, this.y + this.h - 2, 1, 2761264, { spd: 60, life: 0.4, size: 3, grav: 100, key: "fx_dust" });
          break;
        case "stun":
          this.vx = 0;
          if (this.st > 0.9 / m)
            this.set("idle");
          break;
        case "windLeap":
          this.vx = 0;
          if (this.st > 0.45 / m) {
            this.set("leap");
            this.vy = -410;
            this.vx = clamp((pcx - bcx) / 0.72, -270, 270);
            this.onGround = false;
          }
          break;
        case "leap":
          if (this.onGround && this.st > 0.1) {
            this.set("recover");
            sfx.slam();
            this.g.shake(11);
            const fy = this.y + this.h - 12;
            this.g.spawn(new Wave(this.g, { type: "wave" }, this.x - 14, fy, -190 * m));
            this.g.spawn(new Wave(this.g, { type: "wave" }, this.x + this.w, fy, 190 * m));
            this.g.burst(bcx, this.y + this.h, 20, 3813184, { spd: 200, life: 0.6, size: 3, grav: 400, key: "fx_dust" });
          }
          break;
        case "recover":
          this.vx = 0;
          if (this.st > 0.65 / m)
            this.set("idle");
          break;
        case "windRain":
          this.vx = 0;
          if (this.st > 0.8) {
            this.set("rain");
            sfx.roar();
            this.g.shake(6);
            this.rainN = 0;
          }
          break;
        case "rain": {
          this.vx = 0;
          if (this.st > this.rainN * 0.28 && this.rainN < 7) {
            const r = this.g.room;
            const px = clamp(P2.cx + rand(-90, 90), r.px + 24, r.px + r.pw - 24);
            this.g.spawn(new Umbrella(this.g, { type: "umbrella" }, px, r.py + T * 1.5));
            this.rainN++;
          }
          if (this.st > 2.6)
            this.set("idle");
          break;
        }
        default:
          break;
      }
      moveBody(this, dt);
      if (this.state === "charge" && this.hitX) {
        this.set("stun");
        sfx.slam();
        this.g.shake(9);
        this.g.burst(this.face > 0 ? this.x + this.w : this.x, this.y + 10, 16, 12432326, { spd: 180, life: 0.5, size: 2 });
      }
    }
    lastAttack = "";
    rainN = 0;
    render(dt) {
      this.t += dt;
      const p = this.puppet;
      this.flashT = Math.max(0, this.flashT - dt);
      p.flash(this.flashT > 0);
      p.setVisible(this.state !== "gone");
      p.place(this.cx, this.y + this.h + 1, this.face);
      const s = this.state, t = this.t;
      let coatRot = Math.sin(t * 1.3) * 0.03, headRot = Math.sin(t * 0.9) * 0.06, headY = 0, armF = -0.15, armB = 0.15, sy = 1 + Math.sin(t * 2) * 0.015;
      if (s === "dormant") {
        headRot = 0.5;
        headY = 10;
        armF = 0.1;
        armB = -0.1;
        sy = 0.96;
      }
      if (s === "intro") {
        headRot = -0.4 * Math.min(1, this.st * 2);
        armF = -1.4;
        armB = 1.2;
      }
      if (s === "windCharge") {
        coatRot = -0.25;
        headRot = 0.3;
        armF = 0.9;
        armB = 0.9;
      }
      if (s === "charge") {
        coatRot = 0.3;
        headRot = 0.2;
        armF = 1.3;
        armB = 1.3;
      }
      if (s === "stun") {
        coatRot = -0.1 + Math.sin(t * 20) * 0.04;
        headRot = 0.6;
        headY = 8;
      }
      if (s === "windLeap") {
        sy = 0.82;
        armF = -0.9;
        armB = 0.9;
      }
      if (s === "leap") {
        sy = 1.1;
        armF = -2.2;
        armB = 2.2;
      }
      if (s === "recover") {
        sy = 0.9;
        headRot = 0.4;
      }
      if (s === "walk") {
        coatRot = Math.sin(t * 8) * 0.06;
      }
      if (s === "windRain" || s === "rain") {
        armF = -2.6 + Math.sin(t * 12) * 0.1;
        armB = 2.6;
        headRot = -0.5;
      }
      if (s === "dying") {
        coatRot = Math.sin(t * 30) * 0.05;
        headRot = 0.8;
        sy = 1 - this.st * 0.15;
      }
      p.squash(damp(p.inner.scaleX, 1, 10, dt), damp(p.inner.scaleY, sy, 10, dt));
      p.set("coat", { rot: coatRot });
      p.set("head", { rot: headRot, y: headY });
      p.set("armF", { rot: armF });
      p.set("armB", { rot: armB });
      const eyeA = s === "dormant" ? 0 : s === "dying" ? Math.max(0, 1 - this.st) : 0.8 + Math.sin(t * 6) * 0.2;
      p.set("eyeL", { alpha: eyeA });
      p.set("eyeR", { alpha: eyeA });
    }
    light() {
      return this.state === "dormant" || this.state === "gone" ? null : { x: this.cx, y: this.y + 4, r: 60, color: 16726863, a: 0.35 };
    }
    destroy() {
      this.puppet.destroy();
    }
  }

  class Wave extends Entity {
    img;
    life = 2.4;
    constructor(g, d, x, y, vx) {
      super(g, d, x, y);
      this.w = 14;
      this.h = 12;
      this.vx = vx;
      this.harm = 1;
      this.img = g.scene.add.image(x, y, "fx_wave").setScale(INV_ART * 0.4).setDepth(DEPTH.fx).setBlendMode(Phaser.BlendModes.ADD).setOrigin(0.5, 1);
    }
    update(dt) {
      this.x += this.vx * dt;
      this.life -= dt;
      if (this.life <= 0 || isSolid(tileAt(Math.floor((this.vx > 0 ? this.x + this.w : this.x) / T), Math.floor((this.y + 6) / T)))) {
        this.dead = true;
        this.g.burst(this.cx, this.cy, 6, 16743018, { spd: 80, life: 0.3, size: 1.5, glow: true });
      }
      if (Math.random() < 0.5)
        this.g.burst(this.x + rand(0, this.w), this.y + this.h, 1, 16747642, { spd: 50, life: 0.4, size: 1.5, grav: -150, glow: true });
    }
    render() {
      this.img.setPosition(this.cx, this.y + this.h).setScale(INV_ART * 0.4 * (0.9 + Math.sin(this.life * 30) * 0.1));
    }
    light() {
      return { x: this.cx, y: this.cy, r: 22, color: 16734830, a: 0.5 };
    }
    destroy() {
      this.img.destroy();
    }
  }

  class Umbrella extends Entity {
    img;
    warn;
    delay = 0.7;
    constructor(g, d, x, y) {
      super(g, d, x - 7, y);
      this.w = 14;
      this.h = 16;
      this.img = g.scene.add.image(x, y, "deco_umbrella").setScale(INV_ART * 0.5).setDepth(DEPTH.enemy).setFlipY(true).setAlpha(0);
      let fy = y;
      while (fy < g.room.py + g.room.ph && !isSolid(tileAt(Math.floor(x / T), Math.floor(fy / T))))
        fy += T;
      this.warn = g.scene.add.image(x, Math.floor(fy / T) * T, "fx_shadow").setScale(INV_ART * 0.9).setDepth(DEPTH.fx).setTint(16726863).setAlpha(0.2);
    }
    update(dt) {
      this.delay -= dt;
      if (this.delay > 0)
        return;
      this.harm = 1;
      this.vy = Math.min(420, this.vy + 900 * dt);
      this.y += this.vy * dt;
      if (isSolid(tileAt(Math.floor(this.cx / T), Math.floor((this.y + this.h) / T)))) {
        this.dead = true;
        sfx.land();
        this.g.shake(2);
        this.g.burst(this.cx, this.y + this.h, 10, 1840674, { spd: 90, life: 0.5, size: 2.5, grav: 300 });
      }
    }
    render() {
      this.img.setPosition(this.cx, this.cy).setAlpha(this.delay > 0 ? 1 - this.delay / 0.7 : 1).setRotation(Math.sin(this.t++ * 0.3) * 0.1);
      this.warn.setAlpha(0.25 + (this.delay > 0 ? (1 - this.delay / 0.7) * 0.5 : 0.5));
    }
    destroy() {
      this.img.destroy();
      this.warn.destroy();
    }
  }
  register("warden", (g, d, x, y) => Warden.defeated ? null : new Warden(g, d, x - 10, y - 22));

  // src/story/cutscene.ts
  var find = (h, who, ctx) => {
    if (!who || who === "player" || who === "nightpaw")
      return h.player;
    if (who === "self")
      return ctx.entity;
    return h.ents.find((e) => e.def?.npcId === who || e.def?.speaker === who || e.id === who) ?? null;
  };
  var STEPS = {
    async say(h, s, ctx) {
      const lines = s.lines ?? [s.text];
      const npc = find(h, s.who, ctx);
      if (npc && npc !== h.player && "talking" in npc)
        npc.talking = true;
      for (const line of lines)
        await h.ui.say(s.who, line, s);
      if (npc && "talking" in npc)
        npc.talking = false;
    },
    async narrate(h, s) {
      await h.ui.narrate(s.lines ?? [s.text], s);
    },
    async wait(h, s) {
      await sleep(h.scene, s.ms ?? 500);
    },
    letterbox(h, s) {
      h.ui.letterbox(s.on !== false);
    },
    async walk(h, s, ctx) {
      const P2 = h.player;
      const target = s.to !== undefined ? (h.room.x + s.to) * T : P2.x + (s.dx ?? 0) * T;
      P2.scripted = { dir: Math.sign(target - P2.x) };
      const start = h.scene.time.now;
      await new Promise((res) => {
        const ev = h.scene.time.addEvent({ delay: 16, loop: true, callback: () => {
          if (Math.abs(P2.x - target) < 2 || P2.hitX || h.scene.time.now - start > 6000) {
            ev.remove();
            res();
          }
        } });
      });
      P2.scripted = null;
      P2.vx = 0;
      if (s.face)
        P2.face = s.face;
    },
    jump(h) {
      const P2 = h.player;
      P2.scripted = { dir: P2.scripted?.dir ?? 0, jump: true };
    },
    face(h, s, ctx) {
      const e = find(h, s.who, ctx);
      if (!e)
        return;
      if (s.dir)
        e.face = s.dir;
      else if (s.at) {
        const o = find(h, s.at, ctx);
        if (o)
          e.face = o.cx > e.cx ? 1 : -1;
      }
    },
    async camera(h, s, ctx) {
      if (s.release || s.to === "player") {
        h.cam.release(s.ms ?? 600);
        if (s.wait !== false)
          await sleep(h.scene, s.ms ?? 600);
        return;
      }
      let x, y;
      if (typeof s.to === "string") {
        const e = find(h, s.to, ctx);
        if (!e)
          return;
        x = e.cx;
        y = e.cy;
      } else {
        x = (h.room.x + s.to.x) * T;
        y = (h.room.y + s.to.y) * T;
      }
      const p = h.cam.focus(x + (s.dx ?? 0) * T, y + (s.dy ?? 0) * T, s.ms ?? 800);
      if (s.wait !== false)
        await p;
    },
    shake(h, s) {
      h.shake(s.amount ?? 6);
    },
    sfx(_h, s) {
      sfx[s.id]?.();
    },
    music(_h, s) {
      if (s.stop)
        Music.stop();
      else
        Music.play(s.id);
    },
    ambience(_h, s) {
      Audio.ambience(s.id);
    },
    async fade(h, s) {
      await h.ui.fade(s.to ?? 1, s.ms ?? 500, s.color);
    },
    flag(h, s) {
      Game.setFlag(s.set, s.value ?? true);
      if (s.refresh)
        h.refreshEntities();
    },
    unflag(h, s) {
      delete Game.save.flags[s.name];
      if (s.refresh)
        h.refreshEntities();
    },
    give(h, s) {
      Game.give(s.ability);
      if (s.achievement)
        Game.achieve(s.achievement);
      if (s.ability === "wings")
        h.player.airJumps = 1;
    },
    heal(h) {
      h.player.hp = Game.save.maxHp;
    },
    shade(h, s) {
      if (!Game.save.shades.includes(s.id))
        Game.save.shades.push(s.id);
      Game.save.maxHp += 1;
      h.player.hp = Game.save.maxHp;
      Game.achieve("heart_vessel");
      if (Game.save.shades.length >= 2)
        Game.achieve("two_lives");
    },
    achieve(_h, s) {
      Game.achieve(s.id);
    },
    async item(h, s) {
      sfx.ability();
      await h.ui.itemCard(s.title, s.text, s.icon, s.hint);
    },
    title(h, s) {
      h.ui.titleCard(s.name, s.sub, s.boss);
    },
    async memory(h, s) {
      const prev2 = Music.current;
      Music.play("memory");
      sfx.memory();
      await h.ui.memory(s.title, s.lines ?? [s.text], s.image);
      if (prev2)
        Music.play(prev2);
      else
        Music.stop();
    },
    async storybook(h, s) {
      await h.ui.storybook(s.pages, s);
    },
    async if(h, s, ctx) {
      await runSteps(h, Game.test(s.cond) ? s.then ?? [] : s.else ?? [], ctx);
    },
    boss(h, s) {
      if (s.action === "wake")
        h.wakeBoss(s.id ?? "warden");
    },
    emote(h, s, ctx) {
      const e = find(h, s.who, ctx);
      if (e)
        h.emote(e, s.kind ?? "!");
    },
    player(h, s) {
      const P2 = h.player;
      if (s.hidden !== undefined)
        P2.hidden = s.hidden;
      if (s.x !== undefined) {
        P2.x = (h.room.x + s.x) * T + 3;
        P2.y = (h.room.y + (s.y ?? 0)) * T + 2;
        P2.vx = 0;
        P2.vy = s.vy ?? 0;
      }
      if (s.face)
        P2.face = s.face;
      if (s.rest !== undefined)
        P2.resting = s.rest;
    },
    teleport(h, s) {
      h.teleport(s.room, s.x, s.y);
    },
    save(h) {
      h.saveNow();
    },
    refresh(h) {
      h.refreshEntities();
    },
    async waitLand(h) {
      await new Promise((res) => {
        const ev = h.scene.time.addEvent({ delay: 16, loop: true, callback: () => {
          if (h.player.onGround) {
            ev.remove();
            res();
          }
        } });
      });
    },
    async end(h) {
      await h.endDemo();
    },
    async run(h, s, ctx) {
      await runCutscene(h, s.id, ctx);
    },
    hint(h, s) {
      h.ui.hint(s.text, s.ms ?? 4000);
    },
    npc(h, s, ctx) {
      const e = find(h, s.id, ctx);
      if (!e)
        return;
      if (s.hide) {
        e.dead = true;
        h.scene.tweens.add({ targets: e.puppet?.root, alpha: 0, duration: 600 });
      }
    }
  };
  async function runSteps(h, steps, ctx) {
    for (const s of steps) {
      const fn = STEPS[s.do];
      if (!fn) {
        console.warn("Unknown cutscene step", s.do);
        continue;
      }
      await fn(h, s, ctx);
    }
  }
  async function runCutscene(h, id, ctx = {}) {
    const def = World.cutscenes.get(id);
    if (!def) {
      console.warn("Missing cutscene", id);
      return;
    }
    await runSteps(h, def.steps, ctx);
  }

  // src/entities/enemies.ts
  class Enemy extends Entity {
    puppet;
    kbT = 0;
    kbDir = 1;
    coins = 2;
    deathColor = 1775140;
    constructor(g, def, x, y) {
      super(g, def, x, y);
      this.hittable = true;
      this.harm = 1;
    }
    onHit(dmg, dir, _kind) {
      this.hp -= dmg;
      this.flashT = 0.12;
      this.kbT = 0.15;
      this.kbDir = dir;
      if (this.hp <= 0)
        this.kill();
      return true;
    }
    kill() {
      if (this.dead)
        return;
      this.dead = true;
      sfx.enemyDie();
      this.g.shake(4);
      this.g.burst(this.cx, this.cy, 18, this.deathColor, { spd: 150, life: 0.6, size: 2.5 });
      this.g.burst(this.cx, this.cy, 8, 16777215, { spd: 90, life: 0.5, size: 1.5, glow: true, grav: -20 });
      this.g.dropCoins(this.cx, this.cy, this.coins);
      Game.achieve("first_blood");
      Game.save.flags.kills = (Game.save.flags.kills || 0) + 1;
    }
    renderCommon(dt) {
      this.flashT = Math.max(0, this.flashT - dt);
      this.puppet.flash(this.flashT > 0);
    }
    destroy() {
      this.puppet?.destroy();
    }
  }

  class Mite extends Enemy {
    dir = Math.random() < 0.5 ? -1 : 1;
    constructor(g, d, x, y) {
      super(g, d, x, y);
      this.w = 14;
      this.h = 10;
      this.hp = this.maxHp = 2;
      this.name = "Thimble Mite";
      this.puppet = new Puppet(g.scene, miteRig(), 0.9, DEPTH.enemy);
      this.deathColor = 9341600;
    }
    update(dt) {
      this.vy = Math.min(PH.MAXFALL, this.vy + PH.G * dt);
      if (this.kbT > 0) {
        this.kbT -= dt;
        this.vx = this.kbDir * 100;
      } else
        this.vx = this.dir * 26;
      moveBody(this, dt);
      if (this.kbT <= 0) {
        if (this.hitX)
          this.dir *= -1;
        else if (this.onGround) {
          const ax = this.dir > 0 ? this.x + this.w + 1 : this.x - 1;
          const tx = Math.floor(ax / T);
          const below = tileAt(tx, Math.floor((this.y + this.h + 2) / T));
          if (!(isSolid(below) || below === "=") || tileAt(tx, Math.floor((this.y + this.h - 2) / T)) === "^")
            this.dir *= -1;
        }
      }
      this.face = this.dir;
    }
    render(dt) {
      this.t += dt;
      const p = this.puppet, t = this.t * 14;
      p.place(this.cx, this.y + this.h, this.face);
      for (let i = 0;i < 4; i++)
        p.set(`l${i}`, { rot: Math.sin(t + i * 1.6) * 0.5 });
      p.set("shell", { y: Math.abs(Math.sin(t)) * -1.5, rot: Math.sin(t * 0.5) * 0.05 });
      this.renderCommon(dt);
    }
  }

  class SockWisp extends Enemy {
    hx;
    hy;
    constructor(g, d, x, y) {
      super(g, d, x, y);
      this.w = 12;
      this.h = 12;
      this.hp = this.maxHp = 2;
      this.hx = x;
      this.hy = y;
      this.name = "Sock Wisp";
      this.puppet = new Puppet(g.scene, sockRig(), 0.6, DEPTH.enemy);
      this.deathColor = 14733512;
      this.coins = 3;
    }
    onHit(dmg, dir, kind) {
      super.onHit(dmg, dir, kind);
      this.vx = (kind === "side" ? dir : 0) * 160;
      this.vy = kind === "up" ? -160 : kind === "down" ? 160 : -30;
      return true;
    }
    update(dt) {
      const P2 = this.g.player;
      const dx = P2.cx - this.cx, dy = P2.cy - this.cy, d = Math.hypot(dx, dy) || 1;
      if (d < 150 && !P2.dead && !this.g.inCutscene) {
        this.vx += dx / d * 150 * dt;
        this.vy += dy / d * 150 * dt;
      } else {
        this.vx += (this.hx - this.x) * 0.8 * dt;
        this.vy += (this.hy - this.y) * 0.8 * dt;
      }
      const sp = Math.hypot(this.vx, this.vy), max = 52;
      if (sp > max) {
        this.vx *= 0.94;
        this.vy *= 0.94;
      }
      this.x += this.vx * dt;
      this.y += (this.vy + Math.sin(this.t * 3) * 12) * dt;
      if (Math.abs(this.vx) > 5)
        this.face = this.vx > 0 ? -1 : 1;
    }
    render(dt) {
      this.t += dt;
      const p = this.puppet;
      p.place(this.cx, this.y + this.h + 4, this.face);
      p.set("cuff", { rot: Math.sin(this.t * 3) * 0.15 - this.vx * 0.003 });
      p.set("mid", { rot: Math.sin(this.t * 3 - 0.8) * 0.3 + this.vx * 0.004 });
      p.set("foot", { rot: Math.sin(this.t * 3 - 1.6) * 0.4 + this.vx * 0.006 });
      p.set("eyes", { sy: Math.sin(this.t * 0.8) > 0.97 ? 0.15 : 1 });
      this.renderCommon(dt);
    }
    light() {
      return { x: this.cx, y: this.cy, r: 26, color: 12577535, a: 0.35 };
    }
  }

  class Snail extends Enemy {
    cool = rand(1, 2);
    hide = 0;
    constructor(g, d, x, y) {
      super(g, d, x, y);
      this.w = 16;
      this.h = 14;
      this.hp = this.maxHp = 3;
      this.name = "Button Snail";
      this.puppet = new Puppet(g.scene, snailRig(), 0.72, DEPTH.enemy);
      this.deathColor = 12872266;
      this.coins = 4;
      this.face = d.face ?? -1;
    }
    onHit(dmg, dir, kind) {
      if (this.hide > 0.5) {
        sfx.clink();
        this.flashT = 0.05;
        this.g.burst(this.cx, this.cy - 4, 5, 16771496, { spd: 100, life: 0.25, size: 1.2, glow: true });
        return false;
      }
      return super.onHit(dmg, dir, kind);
    }
    update(dt) {
      const P2 = this.g.player;
      const dx = P2.cx - this.cx, dist = Math.abs(dx);
      this.face = dx > 0 ? 1 : -1;
      this.hide = damp(this.hide, dist < 30 && !P2.dead ? 1 : 0, 8, dt);
      this.vy = Math.min(PH.MAXFALL, this.vy + PH.G * dt);
      this.vx = 0;
      moveBody(this, dt);
      this.cool -= dt;
      if (this.cool <= 0 && dist < 200 && dist > 30 && Math.abs(P2.cy - this.cy) < 80 && !this.g.inCutscene && !P2.dead) {
        this.cool = rand(1.8, 2.6);
        sfx.shoot();
        const sp = 120, ang = Math.atan2(P2.cy - this.cy + 4, dx);
        this.g.spawn(new ButtonShot(this.g, { type: "shot" }, this.cx + this.face * 6, this.y + 2, Math.cos(ang) * sp, Math.sin(ang) * sp - 40));
        this.recoil = 0.2;
      }
    }
    recoil = 0;
    render(dt) {
      this.t += dt;
      this.recoil = Math.max(0, this.recoil - dt);
      const p = this.puppet, h = this.hide;
      p.place(this.cx, this.y + this.h, this.face);
      p.set("body", { x: -h * 18 - this.recoil * 20, sx: 1 - h * 0.6 });
      p.set("stalk1", { rot: Math.sin(this.t * 2) * 0.2 - h, sy: 1 - h * 0.9 });
      p.set("stalk2", { rot: Math.sin(this.t * 2 + 1) * 0.2 - h, sy: 1 - h * 0.9 });
      p.set("shell", { rot: Math.sin(this.t) * 0.03 + this.recoil * 0.8, y: h * 3 });
      this.renderCommon(dt);
    }
  }

  class ButtonShot extends Entity {
    img;
    constructor(g, d, x, y, vx, vy) {
      super(g, d, x - 4, y - 4);
      this.w = 8;
      this.h = 8;
      this.vx = vx;
      this.vy = vy;
      this.harm = 1;
      this.hittable = true;
      this.img = g.scene.add.image(x, y, "proj_button").setScale(INV_ART * 1.2).setDepth(DEPTH.enemy + 1);
    }
    life = 3;
    onHit(_d, dir) {
      this.vx = dir * 220;
      this.vy = -60;
      this.harm = 0;
      this.deflected = true;
      return true;
    }
    deflected = false;
    update(dt) {
      this.life -= dt;
      this.vy += 300 * dt;
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      if (this.life <= 0 || isSolid(tileAt(Math.floor(this.cx / T), Math.floor(this.cy / T)))) {
        this.dead = true;
        this.g.burst(this.cx, this.cy, 6, 16756848, { spd: 80, life: 0.3, size: 1.5, glow: true });
      }
      if (this.deflected) {
        for (const e of this.g.ents)
          if (e instanceof Enemy && !e.dead && Math.abs(e.cx - this.cx) < 10 && Math.abs(e.cy - this.cy) < 10) {
            e.onHit(1, Math.sign(this.vx), "side");
            this.dead = true;
          }
      }
    }
    render(dt) {
      this.t += dt;
      this.img.setPosition(this.cx, this.cy).setRotation(this.t * 10);
    }
    light() {
      return { x: this.cx, y: this.cy, r: 16, color: 16756848, a: 0.4 };
    }
    destroy() {
      this.img.destroy();
    }
  }

  class Toad extends Enemy {
    wait = rand(0.6, 1.4);
    crouch = 0;
    constructor(g, d, x, y) {
      super(g, d, x, y);
      this.w = 16;
      this.h = 12;
      this.hp = this.maxHp = 3;
      this.name = "Marble Toad";
      this.puppet = new Puppet(g.scene, toadRig(), 0.62, DEPTH.enemy);
      this.deathColor = 2898486;
      this.coins = 4;
    }
    update(dt) {
      const P2 = this.g.player;
      this.vy = Math.min(PH.MAXFALL, this.vy + PH.G * dt);
      if (this.kbT > 0) {
        this.kbT -= dt;
        this.vx = this.kbDir * 90;
      } else if (this.onGround) {
        this.vx = 0;
        this.face = P2.cx > this.cx ? 1 : -1;
        const near = Math.abs(P2.cx - this.cx) < 170 && Math.abs(P2.cy - this.cy) < 90 && !this.g.inCutscene && !P2.dead;
        this.wait -= dt * (near ? 1 : 0.3);
        this.crouch = this.wait < 0.35 ? 1 : 0;
        if (this.wait <= 0) {
          this.wait = rand(1.1, 1.9);
          this.vy = -rand(300, 360);
          this.vx = this.face * rand(80, 120);
          this.onGround = false;
          sfx.croak();
        }
      }
      moveBody(this, dt);
      if (this.hitX && !this.onGround)
        this.vx *= -0.5;
      if (this.landed) {
        this.g.burst(this.cx, this.y + this.h, 4, 2893880, { spd: 40, life: 0.3, size: 2, key: "fx_dust" });
        this.puppet.squash(1.2, 0.8);
      }
    }
    render(dt) {
      this.t += dt;
      const p = this.puppet, air = !this.onGround;
      p.place(this.cx, this.y + this.h, this.face);
      p.squash(damp(p.inner.scaleX, air ? 0.9 : 1 + this.crouch * 0.12, 12, dt), damp(p.inner.scaleY, air ? 1.15 : 1 - this.crouch * 0.15 + Math.sin(this.t * 3) * 0.02, 12, dt));
      p.set("legB", { rot: air ? 0.9 : 0 });
      p.set("legF", { rot: air ? 0.8 : 0 });
      p.set("body", { rot: air ? this.vy < 0 ? -0.2 : 0.2 : 0 });
      this.renderCommon(dt);
    }
    light() {
      return { x: this.cx + this.face * 4, y: this.y, r: 18, color: 8381439, a: 0.35 };
    }
  }
  register("mite", (g, d, x, y) => new Mite(g, d, x + 1, y + 6));
  register("sockwisp", (g, d, x, y) => new SockWisp(g, d, x + 2, y + 2));
  register("snail", (g, d, x, y) => new Snail(g, d, x, y + 2));
  register("toad", (g, d, x, y) => new Toad(g, d, x, y + 4));

  // src/entities/props.ts
  var visible = (d) => Game.test(d.if) && !(d.hideIf && Game.test(d.hideIf));
  register("spawn", () => null);

  class Shrine extends Entity {
    img;
    flames = [];
    lit = 0;
    extra = [];
    constructor(g, d, x, y) {
      super(g, d, x - 4, y - 8);
      this.w = 24;
      this.h = 24;
      const s = g.scene;
      this.img = s.add.image(x + 8, y + T, "shrine").setOrigin(0.5, 1).setScale(INV_ART * 0.85).setDepth(DEPTH.props);
      this.extra = [];
      for (const [dx, sc] of [[-6, 0.55], [5, 0.7], [0, 0.45]]) {
        const baseY = y + T - 2;
        const cand = s.add.image(x + 8 + dx, baseY, "candle").setScale(INV_ART * sc).setDepth(DEPTH.props + 1).setOrigin(0.5, 1);
        this.extra.push(cand);
        this.flames.push(s.add.image(x + 8 + dx, baseY - 34 * INV_ART * sc + 8 * INV_ART * sc, "flame").setScale(INV_ART * sc).setOrigin(0.5, 0.85).setDepth(DEPTH.props + 2).setBlendMode(Phaser.BlendModes.ADD));
      }
    }
    interactLabel() {
      return "Rest";
    }
    interact() {
      const P2 = this.g.player;
      if (!P2.onGround)
        return false;
      P2.resting = true;
      P2.vx = 0;
      P2.hp = Game.save.maxHp;
      Game.save.hp = P2.hp;
      Game.save.shrine = { room: this.g.room.id, x: P2.x, y: P2.y };
      P2.safeX = P2.x;
      P2.safeY = P2.y;
      sfx.rest();
      this.lit = 1;
      this.g.burst(this.cx, this.y + 12, 24, 16764794, { spd: 30, life: 1.6, size: 1.5, grav: -30, glow: true });
      Game.achieve("rested");
      this.g.respawnRoomEnemies?.();
      this.g.saveNow?.();
      if (this.def.cutscene && Game.test(this.def.cutsceneIf))
        this.g.runCutscene(this.def.cutscene);
      return true;
    }
    render(dt) {
      this.t += dt;
      this.lit = damp(this.lit, 0, 1.5, dt);
      this.flames.forEach((f, i) => f.setScale(f.scaleX, f.scaleX * (1 + 0.15 * Math.sin(this.t * 9 + i * 2))).setAlpha(0.85 + Math.sin(this.t * 13 + i) * 0.15));
    }
    light() {
      return { x: this.cx, y: this.y + 6, r: 70 + this.lit * 50 + Math.sin(this.t * 7) * 3, color: 16764794, a: 0.75 };
    }
    destroy() {
      this.img.destroy();
      this.flames.forEach((f) => f.destroy());
      this.extra.forEach((f) => f.destroy());
    }
  }
  register("shrine", (g, d, x, y) => new Shrine(g, d, x, y));

  class Jar extends Entity {
    img;
    constructor(g, d, x, y) {
      super(g, d, x + 2, y + 4);
      this.w = 12;
      this.h = 12;
      this.hp = 3;
      this.hittable = true;
      this.img = g.scene.add.image(x + 8, y + T, "button_jar").setOrigin(0.5, 1).setScale(INV_ART * 0.4).setDepth(DEPTH.props);
    }
    onHit() {
      this.hp--;
      this.flashT = 0.1;
      sfx.clink();
      this.g.dropCoins(this.cx, this.cy, 3);
      if (this.hp <= 0) {
        this.dead = true;
        Game.taken.add(this.id);
        sfx.break();
        this.g.burst(this.cx, this.cy, 14, 12577535, { spd: 120, life: 0.5, size: 1.6, glow: true });
        this.g.dropCoins(this.cx, this.cy, (this.def.value ?? 12) - 6);
      }
      return true;
    }
    render(dt) {
      this.flashT = Math.max(0, this.flashT - dt);
      this.img.setAngle(this.flashT > 0 ? rand(-8, 8) : 0);
      if (this.flashT > 0)
        this.img.setTintFill(16777215);
      else
        this.img.clearTint();
    }
    destroy() {
      this.img.destroy();
    }
  }
  register("jar", (g, d, x, y) => Game.taken.has(d.id) ? null : new Jar(g, d, x, y));
  var PICKUP_ART = {
    needle: { key: "needle", scale: 0.9, glow: 16777215, color: 16777215 },
    dash: { key: "relic_dash", scale: 0.4, glow: 9075455, color: 12562687 },
    wings: { key: "relic_wings", scale: 0.4, glow: 15327999, color: 15327999 },
    slipper: { key: "slipper", scale: 0.4, glow: 16761040, color: 16761040 },
    shade: { key: "shade", scale: 0.4, glow: 12577535, color: 12577535 }
  };

  class Pickup extends Entity {
    img;
    art;
    baseY;
    constructor(g, d, x, y) {
      super(g, d, x, y);
      this.w = 14;
      this.h = 16;
      this.art = PICKUP_ART[d.kind] ?? PICKUP_ART.needle;
      this.baseY = y + 6;
      this.img = g.scene.add.image(x + 7, this.baseY, this.art.key).setScale(INV_ART * this.art.scale).setDepth(DEPTH.props + 3);
      if (d.kind === "needle")
        this.img.setRotation(-1.2);
      if (d.kind === "shade")
        this.img.setAlpha(0.85);
    }
    update() {
      if (this.g.inCutscene)
        return;
      if (overlap(this.g.player, this))
        this.collect();
    }
    async collect() {
      if (this.dead)
        return;
      this.dead = true;
      Game.taken.add(this.id);
      sfx.pickup();
      this.g.shake(4);
      this.g.burst(this.cx, this.cy, 40, this.art.color, { spd: 200, life: 1, size: 2, grav: 0, glow: true });
      if (this.def.cutscene)
        await this.g.runCutscene(this.def.cutscene, { entity: this });
      this.g.saveNow?.();
    }
    render(dt) {
      this.t += dt;
      this.img.setY(this.baseY + Math.sin(this.t * 2.2) * 2);
      if (this.def.kind === "needle")
        this.img.setRotation(-1.2 + Math.sin(this.t * 1.5) * 0.05);
      if (this.def.kind === "shade")
        this.img.setScale(INV_ART * this.art.scale * (1 + Math.sin(this.t * 3) * 0.03)).setAlpha(0.7 + Math.sin(this.t * 2) * 0.15);
    }
    light() {
      return { x: this.cx, y: this.cy, r: 46 + Math.sin(this.t * 3) * 4, color: this.art.glow, a: 0.7 };
    }
    destroy() {
      this.img.destroy();
    }
  }
  register("pickup", (g, d, x, y) => Game.taken.has(d.id) || !visible(d) ? null : new Pickup(g, d, x, y));

  class Coin extends Entity {
    img;
    constructor(g, d, x, y) {
      super(g, d, x + 4, y + 4);
      this.w = 8;
      this.h = 8;
      this.img = g.scene.add.image(x + 8, y + 8, "button_coin").setScale(INV_ART * 1).setDepth(DEPTH.props);
    }
    update() {
      if (overlap(this.g.player, this)) {
        this.dead = true;
        Game.taken.add(this.id);
        this.g.dropCoins(this.cx, this.cy, this.def.value ?? 1);
      }
    }
    render(dt) {
      this.t += dt;
      this.img.setScale(INV_ART * Math.abs(Math.cos(this.t * 2)), INV_ART);
    }
    light() {
      return { x: this.cx, y: this.cy, r: 14, color: 16769184, a: 0.4 };
    }
    destroy() {
      this.img.destroy();
    }
  }
  register("coin", (g, d, x, y) => Game.taken.has(d.id) ? null : new Coin(g, d, x, y));
  var NPC_RIGS = {
    moth: { rig: mothRig, scale: 0.8, w: 22, h: 22, light: [16764794, 60] },
    mouse: { rig: mouseRig, scale: 0.75, w: 22, h: 16 }
  };

  class Npc extends Entity {
    puppet;
    kind;
    talking = false;
    hover = 0;
    constructor(g, d, x, y) {
      super(g, d, x, y);
      this.kind = d.rig ?? "moth";
      const R = NPC_RIGS[this.kind];
      this.w = R.w;
      this.h = R.h;
      this.y = y + T - this.h;
      this.puppet = new Puppet(g.scene, R.rig(), R.scale, DEPTH.npc);
      this.face = d.face ?? -1;
      this.name = d.name ?? World.speakers[d.speaker]?.name ?? "";
    }
    interactLabel() {
      return this.def.talk ? "Talk" : null;
    }
    interact() {
      const talk = this.def.talk || [];
      const pick = talk.find((t) => Game.test(t.if));
      if (!pick)
        return false;
      this.face = this.g.player.cx > this.cx ? 1 : -1;
      this.g.runCutscene(pick.cutscene, { entity: this });
      return true;
    }
    update(dt) {
      if (!this.g.inCutscene && Math.abs(this.g.player.cx - this.cx) < 60 && this.def.watch !== false)
        this.face = this.g.player.cx > this.cx ? 1 : -1;
      this.hover = damp(this.hover, this.kind === "moth" ? 1 : 0, 3, dt);
    }
    render(dt) {
      this.t += dt;
      const p = this.puppet, t = this.t;
      const bob = this.kind === "moth" ? Math.sin(t * 2.4) * 2 - 3 : 0;
      p.place(this.cx, this.y + this.h + bob, this.face);
      if (this.kind === "moth") {
        const flap = this.talking ? Math.sin(t * 16) * 0.35 : Math.sin(t * 5) * 0.2;
        p.set("wingF", { rot: flap, sy: 1 + flap * 0.2 });
        p.set("wingB", { rot: -flap * 0.8 });
        p.set("antF", { rot: Math.sin(t * 3) * 0.12 });
        p.set("antB", { rot: Math.sin(t * 3 + 1) * 0.12 });
        p.set("body", { rot: Math.sin(t * 1.6) * 0.06 });
        p.set("flame", { sy: 1 + Math.sin(t * 11) * 0.1, alpha: 0.85 + Math.sin(t * 17) * 0.15 });
      } else {
        p.set("head", { rot: Math.sin(t * 1.2) * 0.05 + (this.talking ? Math.sin(t * 14) * 0.06 : 0) });
        p.set("earF", { rot: Math.sin(t * 0.7) > 0.95 ? 0.3 : 0 });
        p.set("tail", { rot: Math.sin(t * 2) * 0.15 });
        p.set("body", { sy: 1 + Math.sin(t * 2.2) * 0.02 });
      }
    }
    light() {
      const R = NPC_RIGS[this.kind];
      return R.light ? { x: this.cx + this.face * 6, y: this.cy, r: R.light[1] + Math.sin(this.t * 9) * 3, color: R.light[0], a: 0.7 } : null;
    }
    destroy() {
      this.puppet.destroy();
    }
  }
  register("npc", (g, d, x, y) => visible(d) ? new Npc(g, d, x, y) : null);

  class Gate extends Entity {
    img;
    open = 1;
    tiles = [];
    closedGrid = false;
    constructor(g, d, x, y) {
      super(g, d, x, y);
      const n = d.h ?? 3;
      this.w = T;
      this.h = n * T;
      const r = g.room;
      for (let i = 0;i < n; i++)
        this.tiles.push([d.x, d.y + i]);
      this.img = g.scene.add.image(x + T / 2, y, d.art ?? "gate_bars").setOrigin(0.5, 0).setScale(INV_ART * 0.5, n * T / 96).setDepth(DEPTH.props + 5);
      if (d.art === "deco_rockfall")
        this.img.setScale(INV_ART * 0.75).setOrigin(0.5, 0.15);
      this.open = this.shouldBeOpen() ? 1 : 0;
      this.apply();
    }
    shouldBeOpen() {
      if (this.def.mode === "flag")
        return Game.test(this.def.flag);
      return !this.g.bossActive;
    }
    apply() {
      const closed = this.open < 0.5;
      if (closed === this.closedGrid)
        return;
      this.closedGrid = closed;
      for (const [lx, ly] of this.tiles)
        this.g.room.grid[ly][lx] = closed ? "#" : ".";
    }
    update(dt) {
      const target = this.shouldBeOpen() ? 1 : 0;
      if (target !== Math.round(this.open)) {
        if (this.def.art !== "deco_rockfall")
          sfx.gate();
        this.g.shake(3);
      }
      this.open = damp(this.open, target, 10, dt);
      if (Math.abs(this.open - target) < 0.02)
        this.open = target;
      this.apply();
    }
    render() {
      if (this.def.art === "deco_rockfall") {
        this.img.setAlpha(1 - this.open);
        return;
      }
      this.img.setY(this.y - this.open * this.h).setAlpha(this.open > 0.97 ? 0 : 1);
    }
    destroy() {
      for (const [lx, ly] of this.tiles)
        this.g.room.grid[ly][lx] = ".";
      this.img.destroy();
    }
  }
  register("gate", (g, d, x, y) => new Gate(g, d, x, y));

  class Decal extends Entity {
    img;
    constructor(g, d, x, y) {
      super(g, d, x, y);
      this.w = (d.w ?? 2) * T;
      this.h = (d.h ?? 2) * T;
      const depth = d.layer === "fg" ? DEPTH.fgDecor : d.layer === "bg" ? DEPTH.bgDecor : DEPTH.decor;
      this.img = g.scene.add.image(x + (d.ox ?? 0) * T, y + T + (d.oy ?? 0) * T, d.art).setOrigin(d.originX ?? 0.5, d.originY ?? 1).setScale(INV_ART * (d.scale ?? 0.5)).setDepth(depth);
      if (d.alpha !== undefined)
        this.img.setAlpha(d.alpha);
      if (d.flip)
        this.img.setFlipX(true);
      if (d.rot)
        this.img.setRotation(d.rot);
      if (d.tint)
        this.img.setTint(Number(d.tint));
      this.x = this.img.x - this.w / 2;
      this.y = y + T - this.h;
    }
    interactLabel() {
      return this.def.read ? this.def.label ?? "Read" : null;
    }
    interact() {
      if (!this.def.read)
        return false;
      this.g.runCutscene(this.def.read, { entity: this });
      return true;
    }
    render(dt) {
      this.t += dt;
      if (this.def.sway)
        this.img.setRotation((this.def.rot ?? 0) + Math.sin(this.t * (this.def.swaySpeed ?? 0.8) + this.x) * this.def.sway);
    }
    light() {
      return this.def.glow ? { x: this.img.x, y: this.img.y - 8, r: this.def.glow, color: Number(this.def.glowColor ?? 16764794), a: 0.6 } : null;
    }
    destroy() {
      this.img.destroy();
    }
  }
  register("decal", (g, d, x, y) => visible(d) ? new Decal(g, d, x, y) : null);

  class Trigger extends Entity {
    constructor(g, d, x, y) {
      super(g, d, x, y);
      this.w = (d.w ?? 1) * T;
      this.h = (d.h ?? 1) * T;
      this.y = y + T - this.h;
    }
    update() {
      if (this.g.inCutscene || this.g.player.dead)
        return;
      if (!overlap(this.g.player, this))
        return;
      if (!Game.test(this.def.if))
        return;
      if (this.def.once !== false) {
        if (Game.taken.has(this.id))
          return;
        Game.taken.add(this.id);
      }
      this.g.runCutscene(this.def.cutscene, { entity: this });
    }
  }
  register("trigger", (g, d, x, y) => d.once !== false && Game.taken.has(d.id) ? null : new Trigger(g, d, x, y));

  // src/scenes/GameScene.ts
  var GROUNDED = new Set(["shrine", "jar", "npc", "pickup", "warden"]);

  class GameScene extends Phaser.Scene {
    room;
    player;
    ents = [];
    fx;
    ui;
    light;
    backdrop;
    roomImg = null;
    cracks = [];
    staticLights = [];
    lightList = [];
    time_ = 0;
    acc = 0;
    hitstopT = 0;
    shakeAmt = 0;
    inCutscene = false;
    paused = false;
    bossActive = false;
    camX = 0;
    camY = 0;
    camFocus = null;
    camRelease = 0;
    promptTarget = null;
    lastArea = "";
    autosaveT = 0;
    playtimeT = 0;
    emotes = [];
    startOpts = {};
    constructor() {
      super("game");
    }
    get time() {
      return this.sys.time;
    }
    set time(_v) {}
    get scene() {
      return this;
    }
    set scene(_v) {}
    init(data) {
      this.startOpts = data || {};
    }
    create() {
      const cam = this.cameras.main;
      cam.setZoom(ZOOM);
      cam.setRoundPixels(false);
      cam.transparent = true;
      this.fx = new Fx(this);
      const sp = this.sys.scenePlugin;
      sp.launch("backdrop");
      sp.launch("light");
      sp.launch("ui");
      this.backdrop = sp.get("backdrop");
      this.light = sp.get("light");
      this.ui = sp.get("ui");
      this.ui.game_ = this;
      this.started = false;
    }
    started = false;
    begin() {
      this.started = true;
      this.player = new Player(this);
      this.ents = [];
      const s = Game.save;
      let startRoom = World.def.start.room, sx = World.def.start.x, sy = World.def.start.y;
      if (this.startOpts.continue && s.pos && World.byId.has(s.pos.room)) {
        startRoom = s.pos.room;
      }
      const q = new URLSearchParams(location.search);
      if (q.get("room") && World.byId.has(q.get("room"))) {
        startRoom = q.get("room");
        sx = Number(q.get("x") ?? 3);
        sy = Number(q.get("y") ?? 3);
      }
      const r = World.byId.get(startRoom);
      if (this.startOpts.continue && s.pos && s.pos.room === startRoom && !q.get("room"))
        this.player.place(s.pos.x, s.pos.y);
      else {
        const spawn = r.spawns.find((e) => e.type === "spawn");
        const tx = q.get("room") ? sx : spawn ? spawn.x : sx, ty = q.get("room") ? sy : spawn ? spawn.y : sy;
        this.player.place((r.x + tx) * T + 3, (r.y + ty) * T + 2);
      }
      this.player.hp = this.startOpts.continue ? Math.max(1, s.hp) : s.maxHp;
      this.enterRoom(r, { snap: true, noSave: true });
      Platform.onExit(() => {
        this.saveNow();
      });
      Platform.onPause(() => this.ui?.openPause?.());
      window.__NP = this;
      window.__NP_GAME = Game;
      window.__NP_WORLD = World;
      this.events.on("shutdown", () => {
        Music.stop();
      });
      if (this.startOpts.cutscene)
        this.time.delayedCall(10, () => this.runCutscene(this.startOpts.cutscene));
    }
    enterRoom(r, o = {}) {
      for (const e of this.ents)
        e.destroy();
      this.ents = [];
      for (const c of this.cracks)
        c.img.destroy();
      this.cracks = [];
      this.emotes.forEach((e) => e.destroy());
      this.emotes = [];
      this.fx.clear();
      this.room = r;
      setCurrentRoom(r);
      const art = roomTexture(this, r);
      if (this.roomImg)
        this.roomImg.destroy();
      this.roomImg = this.add.image(r.px, r.py, art.key).setOrigin(0, 0).setScale(INV_ART).setDepth(DEPTH.room);
      this.staticLights = art.lights;
      this.spawnAll();
      for (let y = 0;y < r.h; y++)
        for (let x = 0;x < r.w; x++) {
          if (r.grid[y][x] !== "X")
            continue;
          const key = `wall:${r.id}:${x},${y}`;
          if (Game.taken.has(key))
            continue;
          const img = this.add.image((r.x + x) * T, (r.y + y) * T, `${r.area.tileset}_rock`).setOrigin(0, 0).setCrop(0, 0, 64, 64).setScale(INV_ART).setDepth(DEPTH.room + 1).setTint(12103888);
          const crack = this.add.image((r.x + x) * T + T / 2, (r.y + y) * T + T / 2, "crack_wall").setScale(INV_ART).setDepth(DEPTH.room + 2).setAlpha(0.8);
          this.cracks.push({ img, key, tx: r.x + x, ty: r.y + y }, { img: crack, key, tx: r.x + x, ty: r.y + y });
        }
      const first = !Game.visited.has(r.id);
      Game.visited.add(r.id);
      const music = this.bossActive ? "boss" : r.music ?? r.area.music;
      if (music && !this.inCutscene)
        Music.play(music);
      Audio.ambience(r.ambience ?? r.area.ambience ?? "hollows");
      this.backdrop?.setArea(r.area, r);
      this.light?.setDark(r.dark ?? r.area.dark);
      if (r.area.id !== this.lastArea) {
        if (this.lastArea)
          this.ui?.titleCard(r.area.name, r.area.subtitle);
        this.lastArea = r.area.id;
      }
      this.cameras.main.setBounds(r.px, r.py, Math.max(r.pw, VIEW_W), Math.max(r.ph, VIEW_H));
      if (o.snap)
        this.snapCamera();
      if (!o.noSave)
        this.saveNow();
      if (r.onEnter && Game.test(r.onEnterIf) && !this.inCutscene) {
        const key = `enter:${r.id}`;
        if (!Game.taken.has(key)) {
          Game.taken.add(key);
          this.time.delayedCall(30, () => this.runCutscene(r.onEnter));
        }
      }
    }
    spawnAll() {
      const r = this.room;
      for (const d of r.spawns) {
        let x = (r.x + d.x) * T, y = (r.y + d.y) * T;
        if (GROUNDED.has(d.type) && d.float !== true)
          y = (r.y + groundBelow(r, d.x, d.y) - 1) * T;
        const e = create(this, d, x, y);
        if (e)
          this.ents.push(e);
      }
    }
    refreshEntities() {
      for (const e of this.ents)
        e.destroy();
      this.ents = [];
      this.spawnAll();
    }
    respawnRoomEnemies() {}
    spawn(e) {
      this.ents.push(e);
    }
    burst(x, y, n, color, o) {
      this.fx.burst(x, y, n, color, o);
    }
    dropCoins(x, y, n) {
      this.fx.coins(x, y, n);
    }
    shake(a) {
      this.shakeAmt = Math.max(this.shakeAmt, a);
    }
    hitstop(s) {
      this.hitstopT = Math.max(this.hitstopT, s);
    }
    prompt(text, x, y) {
      this.ui?.prompt(text, x, y);
    }
    bossBar(e, name) {
      this.ui?.bossBar(e, name);
      if (!e) {
        this.bossActive = false;
      }
    }
    get time_s() {
      return this.time_;
    }
    hurtPlayer(n, fromX, hazard = false) {
      const P2 = this.player;
      if (P2.invuln > 0 || P2.dead || this.inCutscene || P2.hazardT > 0)
        return;
      P2.hp -= n;
      P2.invuln = 1.1;
      P2.resting = false;
      P2.knockT = 0.18;
      P2.knockVx = hazard ? 0 : (P2.cx < fromX ? -1 : 1) * 150;
      P2.vy = -200;
      P2.dashT = 0;
      sfx.hurt();
      this.shake(8);
      this.hitstop(0.12);
      this.ui?.hurtFlash();
      this.burst(P2.cx, P2.cy, 14, 723472, { spd: 140, life: 0.5, size: 2.5 });
      if (P2.hp <= 0)
        this.killPlayer();
      else if (hazard) {
        P2.hazardT = 0.35;
      }
    }
    afterHazard() {
      this.ui?.flashFade(0.8);
    }
    killPlayer() {
      const P2 = this.player;
      P2.dead = true;
      P2.deadT = 0;
      P2.vx = 0;
      sfx.die();
      this.shake(10);
      Game.save.deaths++;
      this.burst(P2.cx, P2.cy, 30, 723472, { spd: 180, life: 1, size: 3, grav: 60 });
      this.burst(P2.cx, P2.cy, 16, 12577535, { spd: 60, life: 1.4, size: 1.6, glow: true, grav: -60 });
      this.time.delayedCall(1700, async () => {
        await this.ui.fade(1, 500);
        const sh = Game.save.shrine;
        const r = sh && World.byId.get(sh.room) ? World.byId.get(sh.room) : World.byId.get(World.def.start.room);
        this.bossActive = false;
        this.ui.bossBar(null);
        P2.dead = false;
        P2.hp = Game.save.maxHp;
        P2.invuln = 1;
        if (sh)
          P2.place(sh.x, sh.y);
        else {
          const sp = r.spawns.find((e) => e.type === "spawn");
          P2.place((r.x + (sp?.x ?? 3)) * T + 3, (r.y + (sp?.y ?? 3)) * T + 2);
        }
        this.enterRoom(r, { snap: true });
        if (sh)
          P2.resting = true;
        await this.ui.fade(0, 700);
      });
    }
    hitWall(tx, ty, _face) {
      const r = this.room;
      const group = [];
      const seen = new Set;
      const stack = [[tx - r.x, ty - r.y]];
      while (stack.length) {
        const [x, y] = stack.pop();
        const k = `${x},${y}`;
        if (seen.has(k) || x < 0 || y < 0 || x >= r.w || y >= r.h || r.grid[y][x] !== "X")
          continue;
        seen.add(k);
        group.push([x, y]);
        stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
      }
      for (const [x, y] of group) {
        const key = `wall:${r.id}:${x},${y}`;
        Game.taken.add(key);
        this.burst((r.x + x) * T + 8, (r.y + y) * T + 8, 10, 3814472, { spd: 160, life: 0.7, size: 3, grav: 400, key: "fx_dust" });
      }
      this.cracks = this.cracks.filter((c) => {
        if (seen.has(`${c.tx - r.x},${c.ty - r.y}`)) {
          c.img.destroy();
          return false;
        }
        return true;
      });
      sfx.break();
      this.shake(6);
      this.hitstop(0.08);
      this.time.delayedCall(300, () => sfx.pickup());
      Game.achieve("secret_wall");
      this.saveNow();
    }
    async runCutscene(id, opts = {}) {
      if (this.inCutscene) {
        this.time.delayedCall(100, () => this.runCutscene(id, opts));
        return;
      }
      this.inCutscene = true;
      const P2 = this.player;
      P2.locked = true;
      P2.scripted = null;
      P2.atkT = 0;
      P2.dashT = 0;
      this.ui.prompt(null);
      try {
        await runCutscene(this, id, opts);
      } catch (e) {
        console.error("cutscene failed", id, e);
      }
      P2.locked = false;
      P2.scripted = null;
      this.ui.letterbox(false);
      this.camFocus = null;
      this.inCutscene = false;
      Input.swallow();
      this.saveNow();
    }
    cam = {
      focus: (x, y, ms) => new Promise((res) => {
        const from = { x: this.camX, y: this.camY };
        this.camFocus = { ...from };
        this.tweens.add({ targets: this.camFocus, x, y, duration: ms, ease: "Sine.easeInOut", onComplete: () => res() });
      }),
      release: (ms = 600) => {
        this.camFocus = null;
        this.camRelease = ms / 1000;
      }
    };
    emote(target, kind) {
      const t = this.add.text(target.cx, target.y - (target === this.player ? 20 : 8), kind, { fontFamily: "Georgia, serif", fontSize: "48px", color: "#f0ecff", stroke: "#07060a", strokeThickness: 8 }).setOrigin(0.5, 1).setScale(INV_ART * 0.9).setDepth(DEPTH.fx + 5);
      this.emotes.push(t);
      this.tweens.add({ targets: t, y: t.y - 6, duration: 300, ease: "Back.easeOut" });
      this.tweens.add({ targets: t, alpha: 0, delay: 1300, duration: 300, onComplete: () => t.destroy() });
    }
    teleport(room, x, y) {
      const r = World.byId.get(room);
      if (!r)
        return;
      this.player.place((r.x + x) * T + 3, (r.y + y) * T + 2);
      this.enterRoom(r, { snap: true, noSave: true });
    }
    wakeBoss(_id) {
      const b = this.ents.find((e) => e instanceof Warden);
      if (!b)
        return;
      b.wake();
      this.bossActive = true;
      this.bossBar(b, b.name);
      this.bossActive = true;
      Music.play("boss");
      Audio.ambience("boss");
    }
    saveNow() {
      const P2 = this.player;
      if (!P2 || P2.dead)
        return;
      Game.save.pos = { room: this.room.id, x: P2.safeX, y: P2.safeY };
      Game.save.hp = Math.max(1, P2.hp);
      Game.persist();
      this.ui?.saveIcon();
    }
    async endDemo() {
      await this.ui.fade(1, 1200);
      Music.stop();
      Audio.ambience("none");
      this.saveNow();
      await this.ui.storybook([{ image: "sb_card_bg", title: "End of the Hollows", lines: ["Nightpaw climbs toward the sound of water,", "and a music box playing somewhere below.", "", "The Drowned Nursery is coming soon."] }], { card: true });
      this.goTitle();
    }
    goTitle() {
      const sp = this.sys.scenePlugin;
      Music.stop();
      sp.stop("ui");
      sp.stop("light");
      sp.stop("backdrop");
      sp.start("title");
    }
    update(_time, deltaMs) {
      if (!this.started) {
        if (this.backdrop?.far && this.light?.rt && this.ui?.fadeRect)
          this.begin();
        return;
      }
      const dt = Math.min(0.05, deltaMs / 1000);
      Input.poll();
      if (this.ui?.modal) {
        this.ui.updateModal(dt);
        Input.endStep();
        this.renderAll(dt);
        return;
      }
      if (!this.inCutscene && !this.player.dead && Input.pressed("pause")) {
        this.ui.openPause();
        Input.endStep();
        return;
      }
      if (!this.inCutscene && !this.player.dead && Input.pressed("map")) {
        this.ui.openMap();
        Input.endStep();
        return;
      }
      if (this.inCutscene)
        this.ui.cutsceneInput?.();
      this.acc += dt;
      let steps = 0;
      while (this.acc >= STEP && steps < 8) {
        this.acc -= STEP;
        steps++;
        if (this.hitstopT > 0) {
          this.hitstopT -= STEP;
          Input.endStep();
          continue;
        }
        this.step(STEP);
        Input.endStep();
      }
      this.renderAll(dt);
      this.time_ += dt;
      this.playtimeT += dt;
      if (this.playtimeT > 1) {
        Game.save.playSeconds += Math.floor(this.playtimeT);
        this.playtimeT %= 1;
      }
      this.autosaveT += dt;
      if (this.autosaveT > 25 && !this.inCutscene && !this.player.dead) {
        this.autosaveT = 0;
        this.saveNow();
        Platform.reportPlaytime();
      }
    }
    step(dt) {
      const P2 = this.player;
      P2.update(dt);
      for (const e of this.ents) {
        if (!e.dead)
          e.update(dt);
        if (e.harm > 0 && !e.dead && !P2.dead && overlap(P2, e))
          this.hurtPlayer(e.harm, e.cx);
      }
      const dead = this.ents.filter((e) => e.dead);
      if (dead.length) {
        dead.forEach((e) => e.destroy());
        this.ents = this.ents.filter((e) => !e.dead);
      }
      const got = this.fx.update(dt, P2.cx, P2.cy, (x, y) => isSolid(tileAt(Math.floor(x / T), Math.floor(y / T))));
      if (got) {
        Game.save.buttons += got;
        for (let i = 0;i < got; i++)
          this.time.delayedCall(i * 30, () => sfx.coin());
        this.ui?.coinsChanged();
      }
      if (!this.inCutscene && !P2.dead) {
        const near = this.ents.find((e) => !e.dead && e.interactLabel() && overlap({ x: P2.x - 6, y: P2.y - 4, w: P2.w + 12, h: P2.h + 8 }, e));
        if (near !== this.promptTarget) {
          this.promptTarget = near ?? null;
          this.prompt(near ? near.interactLabel() : null, near ? near.cx : 0, near ? near.y - 4 : 0);
        }
        if (near && Input.pressed("up") && P2.onGround && !P2.resting) {
          if (near.interact()) {
            this.promptTarget = null;
            this.prompt(null);
          }
        }
      } else if (this.promptTarget) {
        this.promptTarget = null;
        this.prompt(null);
      }
      const { cx, cy } = P2, r = this.room;
      if (cx < r.px || cx >= r.px + r.pw || cy < r.py || cy >= r.py + r.ph) {
        const next = World.roomAt(cx, cy);
        if (next && next !== r) {
          const goingUp = cy < r.py;
          this.enterRoom(next, { snap: true });
          this.ui.flashFade(0.55);
          if (goingUp) {
            P2.vy = Math.min(P2.vy, -390);
            P2.airJumps = Game.has("wings") ? 1 : 0;
          }
        } else if (!next) {
          P2.x = P2.safeX;
          P2.y = P2.safeY;
          P2.vx = P2.vy = 0;
        }
      }
      if (P2.dead === false && P2.y > r.py + r.ph + 64) {
        P2.x = P2.safeX;
        P2.y = P2.safeY;
      }
    }
    camTarget() {
      const P2 = this.player;
      if (this.camFocus)
        return { x: this.camFocus.x, y: this.camFocus.y };
      return { x: P2.cx + P2.face * 18, y: P2.cy - 10 + clamp(P2.vy * 0.06, -10, 24) };
    }
    clampCam(x, y) {
      const r = this.room;
      const hw = VIEW_W / 2, hh = VIEW_H / 2;
      const cx = r.pw <= VIEW_W ? r.px + r.pw / 2 : clamp(x, r.px + hw, r.px + r.pw - hw);
      const cy = r.ph <= VIEW_H ? r.py + r.ph / 2 : clamp(y, r.py + hh, r.py + r.ph - hh);
      return { x: cx, y: cy };
    }
    snapCamera() {
      const t = this.clampCam(this.camTarget().x, this.camTarget().y);
      this.camX = t.x;
      this.camY = t.y;
      this.applyCam();
    }
    applyCam() {
      const cam = this.cameras.main;
      let sx = 0, sy = 0;
      if (this.shakeAmt > 0.1) {
        sx = rand(-1, 1) * this.shakeAmt * 0.5;
        sy = rand(-1, 1) * this.shakeAmt * 0.5;
      }
      cam.setScroll(this.camX + sx - SCREEN_W / 2, this.camY + sy - SCREEN_H / 2);
    }
    renderAll(dt) {
      const P2 = this.player;
      P2.render(dt);
      for (const e of this.ents)
        e.render(dt);
      this.fx.render(dt);
      const t = this.clampCam(this.camTarget().x, this.camTarget().y);
      const k = this.camFocus ? 100 : this.camRelease > 0 ? 3 : 7;
      this.camRelease = Math.max(0, this.camRelease - dt);
      this.camX = damp(this.camX, t.x, k, dt);
      this.camY = damp(this.camY, t.y, this.camFocus ? 100 : 5, dt);
      this.shakeAmt = Math.max(0, this.shakeAmt - dt * 30);
      this.applyCam();
      const L = [...this.staticLights];
      if (!P2.dead)
        L.push({ x: P2.cx, y: P2.cy - 2, r: 56, color: 12103935, a: 0.28 });
      for (const e of this.ents) {
        const l = e.light();
        if (l)
          L.push(l);
      }
      L.push(...this.fx.lights());
      this.lightList = L;
      this.backdrop?.follow(this.camX, this.camY, dt);
      for (const em of this.emotes)
        if (!em.active)
          this.emotes = this.emotes.filter((x) => x.active);
    }
  }

  // src/scenes/LightScene.ts
  var RES = 2;

  class LightScene extends Phaser.Scene {
    rt;
    glow;
    brush;
    fg;
    vig;
    dark = 0.55;
    darkTarget = 0.55;
    constructor() {
      super("light");
    }
    create() {
      this.rt = this.add.renderTexture(0, 0, SCREEN_W / RES, SCREEN_H / RES).setOrigin(0).setScale(RES);
      this.glow = this.add.renderTexture(0, 0, SCREEN_W / RES, SCREEN_H / RES).setOrigin(0).setScale(RES).setBlendMode(Phaser.BlendModes.ADD);
      this.brush = this.make.image({ key: "fx_light", add: false });
      this.fg = this.add.tileSprite(0, -20, SCREEN_W, 256, "hol_fg").setOrigin(0).setTileScale(1.4).setAlpha(0.95);
      const key = "vignette_gen";
      if (!this.textures.exists(key)) {
        const cv = document.createElement("canvas");
        cv.width = 640;
        cv.height = 360;
        const c = cv.getContext("2d");
        const g = c.createRadialGradient(320, 180, 120, 320, 180, 380);
        g.addColorStop(0, "rgba(0,0,0,0)");
        g.addColorStop(1, "rgba(0,0,0,0.75)");
        c.fillStyle = g;
        c.fillRect(0, 0, 640, 360);
        this.textures.addCanvas(key, cv);
      }
      this.vig = this.add.image(0, 0, key).setOrigin(0).setDisplaySize(SCREEN_W, SCREEN_H);
    }
    setDark(d) {
      this.darkTarget = d;
    }
    pool = [];
    brushPair(i) {
      if (!this.pool[i])
        this.pool[i] = [this.make.image({ key: "fx_light", add: false }), this.make.image({ key: "fx_light", add: false })];
      return this.pool[i];
    }
    update(_t, deltaMs) {
      const game = this.scene.get("game");
      if (!game || !game.lightList)
        return;
      const dt = deltaMs / 1000;
      this.dark = damp(this.dark, this.darkTarget, 2, dt);
      const cam = game.cameras.main;
      const mx = cam.midPoint.x, my = cam.midPoint.y;
      const toX = (x) => ((x - mx) * ZOOM + SCREEN_W / 2) / RES;
      const toY = (y) => ((y - my) * ZOOM + SCREEN_H / 2) / RES;
      this.rt.clear();
      this.rt.fill(328714, this.dark);
      this.glow.clear();
      const holes = [], glows = [];
      let n = 0;
      for (const l of game.lightList) {
        const sx = toX(l.x), sy = toY(l.y), r = l.r * ZOOM / RES;
        if (sx < -r || sy < -r || sx > SCREEN_W / RES + r || sy > SCREEN_H / RES + r)
          continue;
        const scale = r * 2 / 256;
        const [h, g] = this.brushPair(n++);
        h.setPosition(sx, sy).setScale(scale).setAlpha(Math.min(1, l.a * 1.3));
        g.setPosition(sx, sy).setScale(scale * 0.8).setAlpha(l.a * 0.28).setTint(l.color);
        holes.push(h);
        glows.push(g);
      }
      if (holes.length) {
        this.rt.erase(holes);
        this.glow.draw(glows);
      }
      const room = game.room;
      const showFg = room && room.area && room.area.backdrop.fg;
      this.fg.setVisible(!!showFg);
      if (showFg) {
        this.fg.tilePositionX = mx * ZOOM * 1.25 / 1.4;
        const topScreen = toY(room.py) * RES;
        this.fg.setY(topScreen - 40);
        this.fg.setVisible(topScreen > -220);
      }
    }
  }

  // src/main.ts
  Input.init();
  new Phaser.Game({
    type: Phaser.AUTO,
    parent: "game",
    width: SCREEN_W,
    height: SCREEN_H,
    backgroundColor: "#07060a",
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    render: { antialias: true, pixelArt: false, roundPixels: false, powerPreference: "high-performance" },
    fps: { target: 60, smoothStep: true },
    input: { gamepad: false },
    audio: { noAudio: true },
    scene: [BootScene, TitleScene, BackdropScene, GameScene, LightScene, UIScene]
  });
})();
