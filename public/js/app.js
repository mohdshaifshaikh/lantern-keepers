// Lantern Keepers — client app logic
const socket = io();

let state = null;
let myRoomCode = null;
let lastPhase = null;
let selectedLights = [];
let selectedSuspect = null;
let lockAnimating = false;

const $ = (id) => document.getElementById(id);
const el = (tag, cls) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
};

const lightBtn = $('btn-light'); // may not exist; safe ignore

// ---- renderers / engines (created lazily)
let bgRenderer = null;
let flameRenderer = null;
let logoFlame = null;

function toast(msg, ms = 2600) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add('hidden'), ms);
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.add('hidden'));
  $(id).classList.remove('hidden');
}

// ---- background + flame init
window.addEventListener('load', () => {
  bgRenderer = new BgRenderer($('bg-canvas'));
  logoFlame = new FlameRenderer($('logo-flame'));
  logoFlame.setIntensity(0.62);
  logoFlame.setMood('light');
});

// ---- landing interactions
$('btn-create').onclick = () => {
  const name = $('name-input').value.trim();
  if (!name) return toast('Enter a name first');
  socket.emit('create', { name });
};
$('name-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('btn-create').click();
});

$('btn-join').onclick = () => {
  const name = $('name-input').value.trim();
  const code = $('code-input').value.trim().toUpperCase();
  if (!name) return toast('Enter a name first');
  if (!code) return toast('Enter a room code');
  socket.emit('join', { code, name });
};
$('code-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('btn-join').click();
});
$('code-input').addEventListener('input', (e) => {
  e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
});

// ---- rules modal
function openRules() { $('rules-modal').classList.remove('hidden'); }
function closeRules() { $('rules-modal').classList.add('hidden'); }
$('btn-rules').onclick = openRules;
$('btn-lobby-rules').onclick = openRules;
$('btn-close-rules').onclick = closeRules;
$('rules-modal').onclick = (e) => { if (e.target === $('rules-modal')) closeRules(); };

// ---- lobby interactions
$('btn-start').onclick = () => socket.emit('start');
$('btn-copy').onclick = () => {
  const link = location.origin + '/#' + myRoomCode;
  navigator.clipboard?.writeText(link).then(
    () => toast('Link copied — share it with friends'),
    () => toast('Copy this: ' + link, 4000)
  );
};
$('btn-leave-lobby').onclick = () => {
  socket.emit('leave_room');
  myRoomCode = null;
  showScreen('screen-landing');
};

// ---- socket events
socket.on('joined', ({ code }) => { myRoomCode = code; });
socket.on('app_error', (e) => toast(e.message));
socket.on('state', (s) => {
  const prevPhase = state ? state.phase : null;
  state = s;
  render(s, prevPhase);
});

// ---- main render
function render(s, prevPhase) {
  if (s.phase === 'lobby') {
    showScreen('screen-lobby');
    renderLobby(s);
    return;
  }
  showScreen('screen-game');
  renderGame(s);
  if (s.phase === 'gameover') renderGameover(s);
  updateFlame(s, prevPhase);
}

// ---- lobby render
function renderLobby(s) {
  $('lobby-code').textContent = s.code;
  $('lobby-count').textContent = `(${s.players.length}/8)`;
  const list = $('lobby-players');
  list.innerHTML = '';
  s.players.forEach((p) => {
    const li = el('li', 'player-list-item');
    const dot = el('span', 'player-dot');
    const nm = el('span');
    nm.textContent = p.name + (p.isYou ? ' (you)' : '') + (s.isHost && p.isYou ? ' · host' : (!s.isHost && p.id === s.players[0].id ? ' · host' : ''));
    li.appendChild(dot);
    li.appendChild(nm);
    list.appendChild(li);
  });
  const startBtn = $('btn-start');
  if (s.isHost) {
    startBtn.classList.remove('hidden');
    startBtn.disabled = s.players.length < 2;
    startBtn.textContent = s.players.length < 2 ? 'Waiting for players…' : 'Light the first flame';
  } else {
    startBtn.classList.add('hidden');
  }
  $('lobby-hint').textContent = s.isHost
    ? 'Share this code (or copy the link) with your friends. You need at least 2 to begin.'
    : 'Waiting for the host to start the game…';
}

// ---- game render
function renderGame(s) {
  $('watch-num').textContent = s.watch;
  $('watch-max').textContent = s.maxWatches;
  $('game-code').textContent = s.code;
  $('flame-val').textContent = s.flame;
  const bar = $('flame-bar');
  bar.style.width = s.flame + '%';
  bar.classList.toggle('low', s.flame <= 35);
  bar.classList.toggle('critical', s.flame <= 18);

  renderRoleBanner(s);
  renderPlayers(s);
  renderPhase(s);

  // flame engine init
  if (!flameRenderer) {
    flameRenderer = new FlameRenderer($('flame-canvas'));
  }
}

function renderRoleBanner(s) {
  const banner = $('role-banner');
  if (!s.myRole) { banner.classList.add('hidden'); return; }
  banner.classList.remove('hidden');
  if (s.myRole === 'shadow') {
    banner.className = 'role-banner shadow';
    banner.innerHTML = `<span class="role-icon">☾</span> You are a <strong>Shadow</strong>. Blend in. Feed the dark. Don't get exposed.`;
  } else {
    banner.className = 'role-banner keeper';
    banner.innerHTML = `<span class="role-icon">✦</span> You are a <strong>Keeper</strong>. Light genuine sparks. Hunt the Shadow${s.shadowCount > 1 ? 's' : ''}.`;
  }
  if (s.myExposed && s.myRole === 'shadow') {
    banner.className = 'role-banner exposed';
    banner.innerHTML = `<span class="role-icon">⚠</span> You have been <strong>exposed</strong>. Your sparks are known. Keep dragging the flame down.`;
  }
}

function renderPlayers(s) {
  const list = $('players-list');
  list.innerHTML = '';
  const sorted = [...s.players].sort((a, b) => b.score - a.score);
  sorted.forEach((p) => {
    const chip = el('div', 'player-chip' + (p.isYou ? ' me' : ''));
    if (p.role === 'shadow' && (p.exposed || s.phase === 'gameover')) chip.classList.add('shadow');
    const name = el('div', 'pname');
    name.textContent = p.name + (p.isYou ? ' (you)' : '');
    if (p.role === 'shadow' && (p.exposed || s.phase === 'gameover')) name.innerHTML += ' <span class="tag-shadow">SHADOW</span>';
    if (p.role === 'keeper' && s.phase === 'gameover') name.innerHTML += ' <span class="tag-keeper">keeper</span>';
    const score = el('div', 'pscore');
    score.textContent = p.score + ' pts';
    chip.appendChild(name);
    chip.appendChild(score);
    list.appendChild(chip);
  });
}

// ---- phase panel
function renderPhase(s) {
  const panel = $('phase-panel');
  switch (s.phase) {
    case 'riddle': panel.innerHTML = renderRiddle(s); bindRiddle(s); break;
    case 'sparks': panel.innerHTML = renderSparks(s); bindSparks(s); break;
    case 'reveal': panel.innerHTML = renderReveal(s); break;
    case 'lighting': renderLighting(s, panel); break;
    case 'resolution': panel.innerHTML = renderResolution(s); break;
  }
}

function phaseTimer(s) {
  if (!s.phaseEndsAt) return '';
  const remaining = Math.max(0, Math.round((s.phaseEndsAt - Date.now()) / 1000));
  return `<span class="timer-pill">${remaining}s</span>`;
}

function renderRiddle(s) {
  const p = s.myPrompt;
  let promptHtml = '';
  if (p.isHint) {
    promptHtml = `<div class="prompt-hint"><span class="hint-tag">SHADOW HINT</span><div class="prompt-text">${escapeHtml(p.text)}</div></div>`;
  } else {
    promptHtml = `<div class="prompt-category"><span class="cat-tag">CATEGORY</span><div class="prompt-text big">${escapeHtml(p.text)}</div></div>`;
  }
  return `
    <div class="phase-card">
      <div class="phase-title">The Riddle</div>
      ${promptHtml}
      ${s.myRole === 'shadow' && !s.myExposed
        ? '<p class="phase-note">You don\'t see the real category. Watch for the reveal — then bluff a spark that fits.</p>'
        : '<p class="phase-note">Memorize it. Everyone will type a spark that fits this category.</p>'}
      ${phaseTimer(s)}
    </div>`;
}
function bindRiddle(s) {}

function renderSparks(s) {
  const p = s.myPrompt;
  const cat = p.isHint
    ? `<span class="hint-tag">SHADOW HINT</span> ${escapeHtml(p.text)}`
    : `<span class="cat-tag">CATEGORY</span> ${escapeHtml(p.text)}`;
  if (s.submittedSpark) {
    const waiting = s.players.length - s.players.filter((pl) => hasSubmitted(s, pl)).length;
    return `
      <div class="phase-card">
        <div class="phase-title">Sparks</div>
        <div class="prompt-line">${cat}</div>
        <div class="waiting-spark">Your spark is in.<div class="waiting-sub">Waiting for ${waiting} other keeper${waiting === 1 ? '' : 's'}…</div></div>
        ${phaseTimer(s)}
      </div>`;
  }
  return `
    <div class="phase-card">
      <div class="phase-title">Sparks</div>
      <div class="prompt-line">${cat}</div>
      <p class="phase-note">${p.isHint ? 'Bluff a single word that might fit the hidden category.' : 'Type one word that fits the category.'}</p>
      <div class="spark-input-row">
        <input id="spark-input" class="input" placeholder="Your spark…" maxlength="40" autocomplete="off" />
        <button id="btn-spark" class="btn btn-primary">Light it</button>
      </div>
      ${phaseTimer(s)}
    </div>`;
}
function hasSubmitted(s, p) {
  // we only know our own; assume others status not exposed — show generic waiting
  return p.isYou ? s.submittedSpark : null;
}
function bindSparks(s) {
  const input = $('spark-input');
  const btn = $('btn-spark');
  if (!input) return;
  const submit = () => {
    const v = input.value.trim();
    if (!v) return toast('Type a spark first');
    socket.emit('submit_spark', { text: v });
  };
  btn.onclick = submit;
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  setTimeout(() => input?.focus(), 50);
}

function renderReveal(s) {
  if (!s.sparks || !s.sparks.length) {
    return `<div class="phase-card"><div class="phase-title">The Reveal</div><p class="phase-note">No sparks this watch.</p>${phaseTimer(s)}</div>`;
  }
  const cards = s.sparks.map((sp) => sparkCard(sp, 'reveal', s)).join('');
  return `
    <div class="phase-card">
      <div class="phase-title">The Reveal</div>
      <p class="phase-note">All sparks appear, shuffled and anonymous. Read them — who's the odd one out?</p>
      <div class="sparks-grid">${cards}</div>
      ${phaseTimer(s)}
    </div>`;
}

function renderLighting(s, panel) {
  if (s.lightingDone) {
    const cards = s.sparks.map((sp) => sparkCard(sp, 'lighting-locked', s)).join('');
    panel.innerHTML = `
      <div class="phase-card">
        <div class="phase-title">Lighting</div>
        <p class="phase-note">Locked in. Waiting for the others…</p>
        <div class="sparks-grid">${cards}</div>
        ${phaseTimer(s)}
      </div>`;
    return;
  }
  if (lastPhase !== 'lighting') {
    selectedLights = [...(s.myLights || [])];
    selectedSuspect = s.mySuspect || null;
    lastPhase = 'lighting';
  }
  const remaining = Math.max(0, 2 - selectedLights.length);
  const cards = s.sparks.map((sp) => lightingCard(sp, s)).join('');
  panel.innerHTML = `
    <div class="phase-card">
      <div class="phase-title">Lighting</div>
      <div class="lighting-help">
        <span>Light the sparks you believe are genuine (${remaining} left).</span>
        <span>Pick one spark to <em>suspect</em> as the Shadow's.</span>
      </div>
      <div class="sparks-grid">${cards}</div>
      <button id="btn-lock" class="btn btn-primary btn-big">Lock in</button>
      ${phaseTimer(s)}
    </div>`;
  bindLighting(s);
}

function lightingCard(sp, s) {
  const lit = selectedLights.includes(sp.id);
  const susp = selectedSuspect === sp.id;
  return `
    <div class="spark-card ${lit ? 'lit' : ''} ${susp ? 'suspected' : ''}" data-id="${sp.id}">
      <div class="spark-text">${escapeHtml(sp.text)}</div>
      <div class="spark-lights">★ ${sp.lights}</div>
      <div class="spark-actions">
        <button class="mini-btn light-btn ${lit ? 'on' : ''}" data-act="light">${lit ? 'Lit' : 'Light'}</button>
        <button class="mini-btn suspect-btn ${susp ? 'on' : ''}" data-act="suspect">${susp ? 'Suspected' : 'Suspect'}</button>
      </div>
    </div>`;
}

function bindLighting(s) {
  document.querySelectorAll('#phase-panel .spark-card').forEach((card) => {
    const id = card.getAttribute('data-id');
    card.querySelector('.light-btn').onclick = (e) => {
      e.stopPropagation();
      toggleLight(id);
      renderLighting(s, $('phase-panel'));
    };
    card.querySelector('.suspect-btn').onclick = (e) => {
      e.stopPropagation();
      selectedSuspect = selectedSuspect === id ? null : id;
      renderLighting(s, $('phase-panel'));
    };
  });
  $('btn-lock').onclick = () => {
    socket.emit('lighting', { lights: selectedLights, suspect: selectedSuspect });
  };
}

function toggleLight(id) {
  const i = selectedLights.indexOf(id);
  if (i >= 0) selectedLights.splice(i, 1);
  else if (selectedLights.length < 2) selectedLights.push(id);
  else selectedLights = [selectedLights[1], id]; // replace oldest
}

function sparkCard(sp, mode, s) {
  let extra = '';
  if (mode === 'resolution' || mode === 'reveal' || mode === 'lighting-locked') {
    if (sp.dark === true) extra = '<span class="dark-tag">dark spark</span>';
    if (sp.author) extra += `<span class="author-tag">— ${escapeHtml(sp.author)}${sp.authorIsYou ? ' (you)' : ''}</span>`;
  }
  const lightCount = (mode === 'lighting-locked' || mode === 'resolution') ? `<div class="spark-lights">★ ${sp.lights}</div>` : '';
  const cls = (sp.dark === true ? 'dark ' : '') + (sp.dark === false ? 'genuine ' : '');
  return `
    <div class="spark-card ${cls}static">
      <div class="spark-text">${escapeHtml(sp.text)}</div>
      ${lightCount}
      ${extra ? `<div class="spark-meta">${extra}</div>` : ''}
    </div>`;
}

function renderResolution(s) {
  const r = s.result;
  if (!r) return `<div class="phase-card"><div class="phase-title">Resolution</div></div>`;
  const igniteHtml = r.ignited.map((sp) => {
    const cls = sp.dark ? 'dark' : 'genuine';
    return `<div class="res-spark ${cls}">${sp.dark ? '✦ dark spark lit — flame dims' : '✦ genuine spark lit — flame rises'}<div class="res-text">“${escapeHtml(sp.text)}”</div></div>`;
  }).join('');
  let suspectHtml = '';
  if (r.exposed) {
    suspectHtml = `<div class="res-expose"><span class="big-good">A Shadow is exposed!</span><div class="res-text">${escapeHtml(r.exposed.name)} wrote “${escapeHtml(r.exposed.sparkText)}”</div></div>`;
  } else if (r.falseAccuse) {
    suspectHtml = `<div class="res-false"><span class="big-bad">False accusation.</span><div class="res-text">${escapeHtml(r.falseAccuse.name)} was a true Keeper (“${escapeHtml(r.falseAccuse.sparkText)}”)</div></div>`;
  } else {
    suspectHtml = `<div class="res-neutral">The shadows stayed hidden this watch.</div>`;
  }
  const delta = r.flameAfter - r.flameBefore;
  const deltaCls = delta >= 0 ? 'good' : 'bad';
  return `
    <div class="phase-card">
      <div class="phase-title">Resolution</div>
      <div class="flame-delta ${deltaCls}">Flame ${delta >= 0 ? '+' : ''}${delta}</div>
      <div class="res-list">${igniteHtml || '<div class="res-neutral">No sparks were lit this watch.</div>'}</div>
      ${suspectHtml}
    </div>`;
}

// ---- gameover
function renderGameover(s) {
  const panel = $('phase-panel');
  const win = s.outcome === 'dawn';
  const sorted = [...s.players].sort((a, b) => b.score - a.score);
  const best = sorted[0];
  const rows = sorted.map((p) => {
    const role = p.role === 'shadow' ? '<span class="tag-shadow">Shadow</span>' : '<span class="tag-keeper">Keeper</span>';
    return `<div class="result-row ${p.isYou ? 'me' : ''}"><span class="rr-name">${escapeHtml(p.name)}${p.isYou ? ' (you)' : ''}</span><span class="rr-role">${role}</span><span class="rr-score">${p.score}</span></div>`;
  }).join('');
  panel.innerHTML = `
    <div class="phase-card gameover-card">
      <div class="go-banner ${win ? 'win' : 'lose'}">${win ? 'Dawn breaks — the Keepers hold the light!' : 'The dark wins. The Last Lantern goes out.'}</div>
      <div class="go-best">Best Keeper: <strong>${escapeHtml(best.name)}</strong> — ${best.score} pts</div>
      <div class="result-list">${rows}</div>
      ${s.isHost ? '<button id="btn-restart" class="btn btn-primary btn-big">Play another Night</button><button id="btn-leave-end" class="btn-link danger-link">Leave room</button>' : '<button id="btn-leave-end" class="btn-link danger-link">Leave room</button>'}
    </div>`;
  if ($('btn-restart')) $('btn-restart').onclick = () => socket.emit('restart');
  $('btn-leave-end').onclick = () => {
    socket.emit('leave_room');
    myRoomCode = null;
    showScreen('screen-landing');
  };
}

// ---- flame sync
function updateFlame(s, prevPhase) {
  if (!flameRenderer) return;
  flameRenderer.setIntensity(s.flame / 100);
  flameRenderer.setMood(s.flame <= 30 ? 'dark' : 'light');
  // burst on phase transitions that matter
  if (prevPhase !== s.phase) {
    if (s.phase === 'resolution' && s.result) {
      const delta = s.result.flameAfter - s.result.flameBefore;
      if (delta > 0) flameRenderer.burst('light');
      else if (delta < -3) flameRenderer.burst('dark');
      if (s.result.exposed) flameRenderer.burst('light');
    }
    if (s.phase === 'riddle' && prevPhase === 'resolution') {
      // new watch, gentle settle
    }
    lastPhase = s.phase;
  }
}

// ---- helpers
function escapeHtml(str) {
  return (str || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// ---- countdown ticker
setInterval(() => {
  if (state && state.phaseEndsAt) {
    const timerEl = $('phase-timer');
    if (timerEl) {
      const r = Math.max(0, Math.round((state.phaseEndsAt - Date.now()) / 1000));
      timerEl.textContent = r + 's';
    }
  } else if (state) {
    const timerEl = $('phase-timer');
    if (timerEl) timerEl.textContent = '';
  }
}, 250);

// ---- handle deep link: /#CODE
window.addEventListener('load', () => {
  const code = (location.hash || '').replace('#', '').toUpperCase();
  if (code.length === 4) {
    $('code-input').value = code;
    setTimeout(() => $('name-input').focus(), 100);
  } else {
    setTimeout(() => $('name-input').focus(), 100);
  }
});
