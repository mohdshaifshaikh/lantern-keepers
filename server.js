// Lantern Keepers — server
// Real-time multiplayer party game. Node + Express + Socket.IO.
// The server is the single source of truth for all game state.

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' }, maxHttpBufferSize: 1e6 });

app.use(express.static(path.join(__dirname, 'public')));

const PROMPTS = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'prompts.json'), 'utf8'));
const PORT = process.env.PORT || 3000;

// ---- Game configuration -------------------------------------------------
// LK_FAST=1 shortens every phase timer for automated testing.
const FAST = process.env.LK_FAST === '1';
const T = (ms) => (FAST ? Math.max(250, Math.round(ms * 0.05)) : ms);

const CONFIG = {
  maxWatches: 5,          // a Night = 5 Watches (rounds)
  startFlame: 100,        // flame meter 0..100
  baseDim: 9,             // flame drops this much at the start of each Watch
  lightsPerPlayer: 2,     // each keeper has 2 lights to distribute
  phaseTimers: {
    riddle: T(8000),     // read your prompt
    sparks: T(32000),    // type your spark
    reveal: T(6000),     // see all sparks
    lighting: T(26000),  // distribute lights + cast suspicion
    resolution: T(9000), // watch the results
  },
  igniteThreshold: 1,     // sparks need >=1 light to ignite
  flame: {
    igniteKeeper: 7,      // a genuine spark ignites -> flame up
    igniteShadow: -11,   // a Shadow's dark spark ignites -> flame down
    exposeShadow: 18,     // a Shadow is exposed -> flame surges
    falseAccuse: -6,      // accusing a genuine keeper -> flame dips
  },
  points: {
    igniteAuthor: 10,    // your spark ignites (keeper)
    igniteLighter: 5,    // you lit a genuine spark
    shadowFool: 14,      // you fooled keepers into lighting your dark spark
    foolLighterPenalty: -4, // you lit a dark spark
    exposeCorrect: 16,   // you helped expose a Shadow
    exposeWrong: -6,      // you accused a genuine keeper
  },
};

// Need >= this many suspicions on a spark to trigger an accusation.
const suspectThreshold = (n) => Math.max(2, Math.ceil(n / 2));
// Shadow count by player count. 2 = cooperative (no Shadow); 3-6 = 1; 7-8 = 2.
const shadowsForCount = (n) => (n >= 7 ? 2 : n >= 3 ? 1 : 0);

// ---- Rooms ---------------------------------------------------------------
const rooms = new Map();
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no easily confused chars

function genCode() {
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  } while (rooms.has(code));
  return code;
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function newRoom(code, hostId) {
  return {
    code, host: hostId, players: [], phase: 'lobby', watch: 0, flame: CONFIG.startFlame,
    prompt: null, sparks: [], lights: {}, suspicions: {}, usedPrompts: [], timers: [],
    lastResult: null, started: false, outcome: null, phaseEndsAt: 0,
  };
}

function addPlayer(room, id, name) {
  const player = {
    id, name: (name || 'Keeper').toString().slice(0, 16) || 'Keeper',
    role: null, score: 0, exposed: false, connected: true,
    submittedSpark: false, lightingDone: false, lightsUsed: 0, suspectedSpark: null,
  };
  room.players.push(player);
  return player;
}

const getPlayer = (room, id) => room.players.find((p) => p.id === id);

function clearTimers(room) {
  room.timers.forEach((t) => clearTimeout(t));
  room.timers = [];
}
function setTimer(room, ms, fn) {
  room.timers.push(setTimeout(fn, ms));
}

function pickPrompt(room) {
  let avail = PROMPTS.filter((p) => !room.usedPrompts.includes(p.category));
  if (avail.length === 0) { room.usedPrompts = []; avail = PROMPTS.slice(); }
  const prompt = avail[Math.floor(Math.random() * avail.length)];
  room.usedPrompts.push(prompt.category);
  return prompt;
}

function assignRoles(room) {
  const sc = shadowsForCount(room.players.length);
  const roles = shuffle([
    ...Array(sc).fill('shadow'),
    ...Array(room.players.length - sc).fill('keeper'),
  ]);
  room.players.forEach((p, i) => { p.role = roles[i]; p.exposed = false; });
}

function countLights(room, sparkId) {
  let c = 0;
  for (const pid in room.lights) if (room.lights[pid].includes(sparkId)) c++;
  return c;
}

function resetRoundFlags(room) {
  room.players.forEach((p) => {
    p.submittedSpark = false; p.lightingDone = false; p.lightsUsed = 0; p.suspectedSpark = null;
  });
}

// ---- Phase / state machine ----------------------------------------------
function startWatch(room) {
  room.watch++;
  room.prompt = pickPrompt(room);
  room.sparks = []; room.lights = {}; room.suspicions = {};
  resetRoundFlags(room);
  room.lastResult = null;
  room.flame -= CONFIG.baseDim;
  if (room.flame <= 0) { room.flame = 0; return endGame(room, 'darkness'); }
  setPhase(room, 'riddle');
}

function setPhase(room, phase) {
  room.phase = phase;
  room.phaseEndsAt = CONFIG.phaseTimers[phase] ? Date.now() + CONFIG.phaseTimers[phase] : 0;
  broadcast(room);
  const t = CONFIG.phaseTimers[phase];
  if (t) setTimer(room, t, () => advance(room, phase));
}

function advance(room, from) {
  if (room.phase !== from) return; // guard against double-advance
  switch (from) {
    case 'riddle': setPhase(room, 'sparks'); break;
    case 'sparks': finishSparks(room); break;
    case 'reveal': setPhase(room, 'lighting'); break;
    case 'lighting': finishLighting(room); break;
    case 'resolution': nextOrEnd(room); break;
  }
}

function finishSparks(room) {
  shuffle(room.sparks); // anonymize order
  setPhase(room, 'reveal');
}

function finishLighting(room) {
  resolveWatch(room);
  setPhase(room, 'resolution');
}

function resolveWatch(room) {
  const before = Math.round(room.flame);
  const result = {
    ignited: [], fizzled: [], exposed: null, falseAccuse: null,
    flameBefore: before, flameAfter: 0, suspicions: {},
  };

  // Resolve sparks
  room.sparks.forEach((spark) => {
    const count = countLights(room, spark.id);
    const author = getPlayer(room, spark.authorId);
    const isShadow = author && author.role === 'shadow';
    if (count >= CONFIG.igniteThreshold) {
      if (isShadow) {
        room.flame += CONFIG.flame.igniteShadow;
        author.score += CONFIG.points.shadowFool;
        room.players.forEach((p) => {
          if ((room.lights[p.id] || []).includes(spark.id)) p.score += CONFIG.points.foolLighterPenalty;
        });
        result.ignited.push({ id: spark.id, text: spark.text, dark: true });
      } else {
        room.flame += CONFIG.flame.igniteKeeper;
        author.score += CONFIG.points.igniteAuthor;
        room.players.forEach((p) => {
          if ((room.lights[p.id] || []).includes(spark.id)) p.score += CONFIG.points.igniteLighter;
        });
        result.ignited.push({ id: spark.id, text: spark.text, dark: false });
      }
    } else {
      result.fizzled.push({ id: spark.id, text: spark.text, dark: isShadow });
    }
  });

  // Resolve suspicions (private until now)
  const susp = {};
  room.players.forEach((p) => {
    if (p.suspectedSpark) susp[p.suspectedSpark] = (susp[p.suspectedSpark] || 0) + 1;
  });
  result.suspicions = susp;
  let topSpark = null, topCount = 0;
  for (const id in susp) if (susp[id] > topCount) { topCount = susp[id]; topSpark = id; }

  const thr = suspectThreshold(room.players.length);
  if (topSpark && topCount >= thr) {
    const spark = room.sparks.find((s) => s.id === topSpark);
    const author = spark && getPlayer(room, spark.authorId);
    if (author && author.role === 'shadow' && !author.exposed) {
      author.exposed = true;
      room.flame += CONFIG.flame.exposeShadow;
      room.players.forEach((p) => {
        if (p.suspectedSpark === topSpark) p.score += CONFIG.points.exposeCorrect;
      });
      result.exposed = { name: author.name, sparkText: spark.text };
    } else if (author && author.role === 'keeper') {
      room.flame += CONFIG.flame.falseAccuse;
      room.players.forEach((p) => {
        if (p.suspectedSpark === topSpark) p.score += CONFIG.points.exposeWrong;
      });
      result.falseAccuse = { name: author.name, sparkText: spark.text };
    }
  }

  room.flame = Math.max(0, Math.min(100, room.flame));
  room.players.forEach((p) => { p.score = Math.max(0, p.score); });
  result.flameAfter = Math.round(room.flame);
  room.lastResult = result;
}

function nextOrEnd(room) {
  if (room.flame <= 0) return endGame(room, 'darkness');
  if (room.watch >= CONFIG.maxWatches) return endGame(room, 'dawn');
  startWatch(room);
}

function endGame(room, outcome) {
  room.phase = 'gameover';
  room.outcome = outcome;
  room.phaseEndsAt = 0;
  clearTimers(room);
  broadcast(room);
}

// ---- Sanitize state for a given player ----------------------------------
function sanitize(room, pid) {
  const me = getPlayer(room, pid);
  if (!me) return null;
  const revealRoles = room.phase === 'gameover';

  const players = room.players.map((p) => ({
    id: p.id, name: p.name, score: p.score, exposed: p.exposed, connected: p.connected,
    isYou: p.id === pid,
    role: p.exposed || revealRoles ? p.role : null,
  }));

  let myPrompt = null;
  if (room.prompt && ['riddle', 'sparks', 'reveal', 'lighting', 'resolution'].includes(room.phase)) {
    if (me.role === 'shadow' && !me.exposed) myPrompt = { text: room.prompt.hint, isHint: true };
    else myPrompt = { text: room.prompt.category, isHint: false };
  }

  let sparks = [];
  const showSparks = ['reveal', 'lighting', 'resolution', 'gameover'].includes(room.phase);
  if (showSparks) {
    const revealDark = room.phase === 'resolution' || room.phase === 'gameover';
    sparks = room.sparks.map((s) => {
      const author = getPlayer(room, s.authorId); // may be undefined if author left
      return {
        id: s.id,
        text: s.text,
        lights: countLights(room, s.id),
        author: author && (author.exposed || revealRoles) ? author.name : null,
        authorIsYou: s.authorId === pid,
        dark: author && revealDark ? author.role === 'shadow' : null,
      };
    });
  }

  return {
    code: room.code,
    phase: room.phase,
    watch: room.watch,
    maxWatches: CONFIG.maxWatches,
    flame: Math.max(0, Math.round(room.flame)),
    players,
    myRole: me.role,
    myExposed: me.exposed,
    myPrompt,
    sparks,
    myLights: room.lights[pid] || [],
    mySuspect: me.suspectedSpark,
    submittedSpark: me.submittedSpark,
    lightingDone: me.lightingDone,
    isHost: room.host === pid,
    outcome: room.outcome,
    result: room.lastResult,
    started: room.started,
    phaseEndsAt: room.phaseEndsAt,
    shadowCount: shadowsForCount(room.players.length),
  };
}

function broadcast(room) {
  room.players.forEach((p) => {
    const s = sanitize(room, p.id);
    if (s) io.to(p.id).emit('state', s);
  });
}

// ---- Socket events -------------------------------------------------------
io.on('connection', (socket) => {
  socket.on('create', ({ name }) => {
    if (rooms.size > 500) return socket.emit('app_error', { message: 'Server is busy. Try again shortly.' });
    const code = genCode();
    const room = newRoom(code, socket.id);
    rooms.set(code, room);
    socket.join(code);
    addPlayer(room, socket.id, name);
    socket.roomCode = code;
    socket.emit('joined', { code });
    broadcast(room);
  });

  socket.on('join', ({ code, name }) => {
    code = (code || '').toUpperCase().trim();
    const room = rooms.get(code);
    if (!room) return socket.emit('app_error', { message: 'No room with that code.' });
    if (room.phase !== 'lobby') return socket.emit('app_error', { message: 'That game has already started.' });
    if (room.players.length >= 8) return socket.emit('app_error', { message: 'That room is full (max 8 players).' });
    socket.join(code);
    addPlayer(room, socket.id, name);
    socket.roomCode = code;
    socket.emit('joined', { code });
    broadcast(room);
  });

  socket.on('start', () => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.host !== socket.id) return;
    if (room.players.length < 2) return socket.emit('app_error', { message: 'Need at least 2 players to begin.' });
    clearTimers(room);
    room.started = true;
    room.flame = CONFIG.startFlame;
    room.watch = 0;
    room.outcome = null;
    assignRoles(room);
    startWatch(room);
  });

  socket.on('submit_spark', ({ text }) => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.phase !== 'sparks') return;
    const p = getPlayer(room, socket.id);
    if (!p || p.submittedSpark) return;
    text = (text || '').trim().slice(0, 40);
    if (!text) return;
    const id = 's' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    room.sparks.push({ id, authorId: socket.id, text });
    p.submittedSpark = true;
    broadcast(room);
    if (room.players.every((pl) => pl.submittedSpark)) advance(room, 'sparks');
  });

  socket.on('lighting', ({ lights, suspect }) => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.phase !== 'lighting') return;
    const p = getPlayer(room, socket.id);
    if (!p || p.lightingDone) return;
    lights = (lights || []).slice(0, CONFIG.lightsPerPlayer).filter((id) => room.sparks.some((s) => s.id === id));
    room.lights[socket.id] = lights;
    p.lightsUsed = lights.length;
    p.suspectedSpark = suspect && room.sparks.some((s) => s.id === suspect) ? suspect : null;
    p.lightingDone = true;
    broadcast(room);
    if (room.players.every((pl) => pl.lightingDone)) advance(room, 'lighting');
  });

  socket.on('restart', () => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.host !== socket.id) return;
    clearTimers(room);
    room.phase = 'lobby'; room.started = false; room.watch = 0; room.flame = CONFIG.startFlame;
    room.outcome = null; room.lastResult = null; room.prompt = null; room.sparks = [];
    room.lights = {}; room.suspicions = {}; room.phaseEndsAt = 0;
    room.players.forEach((p) => { p.role = null; p.score = 0; p.exposed = false; });
    broadcast(room);
  });

  socket.on('leave_room', () => {
    leaveRoom(socket);
  });

  socket.on('disconnect', () => {
    leaveRoom(socket);
  });
});

function leaveRoom(socket) {
  const room = rooms.get(socket.roomCode);
  if (!room) return;
  room.players = room.players.filter((pl) => pl.id !== socket.id);
  if (room.host === socket.id && room.players.length > 0) room.host = room.players[0].id;
  if (room.players.length === 0) { clearTimers(room); rooms.delete(room.code); return; }
  if (room.started && room.players.length < 2) {
    clearTimers(room);
    endGame(room, room.flame > 0 ? 'dawn' : 'darkness');
    return;
  }
  broadcast(room);
}

server.listen(PORT, () => {
  console.log(`Lantern Keepers is lit on port ${PORT}`);
});
