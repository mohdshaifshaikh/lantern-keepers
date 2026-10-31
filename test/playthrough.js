// Automated end-to-end playthrough for Lantern Keepers.
// Assumes a server is already running (FAST mode) at http://localhost:3299
const { io } = require('socket.io-client');

const URL = process.env.LK_URL || 'http://localhost:3299';
const N = parseInt(process.env.LK_PLAYERS || '4', 10);

const WORDS = ['lantern', 'ember', 'glow', 'shadow', 'spark', 'keeper', 'flame', 'dusk', 'mist', 'tide'];

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function makeActor(name, ordinal) {
  const sock = io(URL, { reconnection: false });
  let latest = null;
  let code = null;
  let done = false;
  const log = [];
  const react = (st) => {
    if (st.phase === 'sparks' && !st.submittedSpark) {
      sock.emit('submit_spark', { text: WORDS[ordinal % WORDS.length] });
    } else if (st.phase === 'lighting' && !st.lightingDone && st.sparks && st.sparks.length) {
      // light up to 2 sparks, suspect one
      const ids = st.sparks.map((p) => p.id);
      const lights = ids.slice(0, Math.min(2, ids.length));
      const suspect = ids[ordinal % ids.length] || null;
      sock.emit('lighting', { lights, suspect });
    } else if (st.phase === 'gameover') {
      done = true;
    }
  };
  sock.on('state', (st) => { latest = st; react(st); });
  sock.on('joined', (d) => { code = d.code; });
  sock.on('app_error', (e) => log.push('ERR ' + e.message));
  return { sock, latest: () => latest, code: () => code, isDone: () => done, log };
}

async function main() {
  console.log('connecting', N, 'players to', URL);
  const actors = [];
  for (let i = 0; i < N; i++) actors.push(makeActor('P' + i, i));

  // Wait for all connections
  await sleep(800);

  // Player 0 creates the room
  const out = { started: false, gameover: false, outcome: null, finalScores: null, errors: [] };
  await new Promise((resolve) => {
    let created = false;
    actors[0].sock.emit('create', { name: 'P0' });
    const waitJoin = setInterval(() => {
      if (actors[0].code() && !created) {
        created = true;
        for (let i = 1; i < N; i++) actors[i].sock.emit('join', { code: actors[0].code(), name: 'P' + i });
        // wait for joins, then start
        setTimeout(() => {
          actors[0].sock.emit('start');
          out.started = true;
          console.log('started; code=' + actors[0].code());
        }, 600);
        clearInterval(waitJoin);
        resolve();
      }
    }, 100);
  });

  // Wait for gameover across all actors
  const deadline = Date.now() + 60000;
  await new Promise((resolve) => {
    const iv = setInterval(() => {
      const allDone = actors.every((a) => a.isDone());
      if (allDone || Date.now() > deadline) {
        clearInterval(iv);
        resolve();
      }
    }, 200);
  });

  // Collect results from actor 0
  const st = actors[0].latest();
  out.gameover = st && st.phase === 'gameover';
  out.outcome = st ? st.outcome : null;
  out.finalScores = st && st.players ? st.players.map((p) => ({ name: p.name, score: p.score, role: p.role })) : null;
  actors.forEach((a) => { out.errors.push(...a.log); });

  console.log('RESULT', JSON.stringify(out, null, 2));

  actors.forEach((a) => a.sock.disconnect());
  // pass if gameover reached, scores present, roles revealed, and at least one shadow existed or coop (N<3)
  let pass = out.gameover && out.finalScores && out.finalScores.length === N;
  if (pass && N >= 3) {
    pass = out.finalScores.some((p) => p.role === 'shadow') && out.finalScores.some((p) => p.role === 'keeper');
  }
  console.log(pass ? 'PASS' : 'FAIL');
  process.exit(pass ? 0 : 1);
}

main().catch((e) => { console.error('FATAL', e); process.exit(2); });
