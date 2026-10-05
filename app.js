(() => {
'use strict';

const G = window.GAME;
const root = document.getElementById('app');
const KEY = 'code-matrix-v5';
const STAGES = ['home', 'mixer', 'rules', 'round', 'question', 'review', 'submit', 'answer', 'roundEnd', 'break', 'bet', 'bankQ', 'bankAnswer', 'final', 'tie', 'tieAnswer'];
const ROUNDS_WITH_BREAK = [1, 3];

const STEPS = (() => {
  const steps = [{ stage: 'mixer', r: 0, q: 0 }, { stage: 'rules', r: 0, q: 0, timed: true }];
  G.rounds.forEach((rd, r) => {
    steps.push({ stage: 'round', r, q: 0 });
    rd.questions.forEach((_, q) => steps.push({ stage: 'question', r, q, timed: true }));
    steps.push({ stage: 'review', r, q: 0 }, { stage: 'submit', r, q: 0, timed: true });
    rd.questions.forEach((_, q) => steps.push({ stage: 'answer', r, q }));
    if (rd.bankQuestion) steps.push({ stage: 'bet', r, q: 0, timed: true }, { stage: 'bankQ', r, q: 0, timed: true }, { stage: 'bankAnswer', r, q: 0 });
    steps.push({ stage: 'roundEnd', r, q: 0 });
    if (ROUNDS_WITH_BREAK.includes(r)) steps.push({ stage: 'break', r, q: 0, timed: true });
  });
  steps.push({ stage: 'final', r: G.rounds.length - 1, q: 0 });
  return steps;
})();
const stepIdx = (stage, r = 0) => STEPS.findIndex(x => x.stage === stage && x.r === r);

const zeros = () => [0, 0, 0, 0, 0, 0, 0];
const makeTeams = n => Array.from({ length: n }, (_, i) => ({ name: G.teamNames[i] || `Команда ${i + 1}`, scores: zeros(), members: [] }));
const initial = () => ({
  lang: 'both', stage: 'home', r: 0, q: 0, hints: 1, i: 0, phase: 'ready',
  teams: makeTeams(4), roster: '', teamSize: 4, mixed: false, revealed: 0,
  elapsed: 0, eventRunning: false, eventAt: 0,
  remaining: 45, deadline: 0, running: false, sound: true, volume: .25
});

let s = initial();
try {
  const old = JSON.parse(localStorage.getItem(KEY));
  if (old && ['kk', 'ru', 'both'].includes(old.lang) && Array.isArray(old.teams) && old.teams.length >= 2 && old.teams.length <= 10
    && old.teams.every(t => typeof t.name === 'string' && t.scores?.length === 7 && Array.isArray(t.members))
    && Number.isInteger(old.i) && old.i >= 0 && old.i < STEPS.length && ['ready', 'run'].includes(old.phase) && old.r >= 0 && old.r < 6 && old.q >= 0 && old.q < G.rounds[old.r].questions.length && STAGES.includes(old.stage)) s = { ...s, ...old };
} catch { /* start fresh */ }

let modal = '', prepWarn = false, audio = null, music = null, soundBusy = false, storageFailed = false;

const esc = x => String(x).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const txt = (kk, ru) => s.lang === 'ru' ? ru : kk;
const tr = (b, cls = '') => !b ? '' : s.lang === 'both' && b.kk !== b.ru
  ? `<span class="bilingual ${cls}"><span>${esc(b.kk)}</span><span class="translation">${esc(b.ru)}</span></span>`
  : esc(b[s.lang === 'ru' ? 'ru' : 'kk']);
const button = (a, kk, ru, cl = '', extra = '') => `<button data-a="${a}" class="${cl}" ${extra}>${esc(txt(kk, ru))}</button>`;
const round = () => G.rounds[s.r];
const question = () => round().questions[s.q];
const left = () => s.running ? Math.max(0, Math.ceil((s.deadline - Date.now()) / 1000)) : s.remaining;
const elapsed = () => s.elapsed + (s.eventRunning ? (Date.now() - s.eventAt) / 1000 : 0);
const fmt = n => { n = Math.max(0, Math.floor(n)); return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`; };
const total = t => t.scores.reduce((a, b) => a + b, 0);
const pointsOf = (r, q) => q.points || r.points;
const roundMax = r => r.questions.reduce((sum, q) => sum + pointsOf(r, q), 0);
const limits = r => r === 6 ? { min: G.bank.min, max: G.bank.max, step: 1 } : { min: 0, max: roundMax(G.rounds[r]), step: G.rounds[r].step };
const bank = () => G.rounds[5].bankQuestion;

function save() { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { storageFailed = true; } }

/* ---------- sound ---------- */
function audioContext() { if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)(); if (audio.state === 'suspended') audio.resume(); return audio; }
function tone(freq, duration, delay = 0, gain = .25) {
  if (!s.sound) return;
  try {
    const a = audioContext(), o = a.createOscillator(), g = a.createGain(), t = a.currentTime + delay;
    o.frequency.value = freq; o.type = 'sine';
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(s.volume * gain, t + .015);
    g.gain.setValueAtTime(s.volume * gain, t + Math.max(.02, duration - .03));
    g.gain.linearRampToValueAtTime(0, t + duration);
    o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + duration + .02);
  } catch { /* audio unavailable */ }
}
const sting = () => [440, 554.37, 659.25].forEach((f, i) => tone(f, i === 2 ? .45 : .16, i * .2));
function stopMusic() { if (music) { clearInterval(music); music = null; } }
function musicToggle() {
  if (music) { stopMusic(); render(); return; }
  if (!s.sound) s.sound = true;
  const notes = [220, 277.18, 329.63, 277.18, 246.94, 329.63, 369.99, 329.63];
  let i = 0;
  music = setInterval(() => tone(notes[i++ % notes.length], .35, 0, .07), 450);
  render();
}

/* ---------- timers and navigation ---------- */
function timerReset(seconds) { s.remaining = seconds; s.running = false; s.deadline = 0; }
function timerToggle() {
  if (s.running) { s.remaining = left(); s.running = false; }
  else if (s.remaining > 0) { s.deadline = Date.now() + s.remaining * 1000; s.running = true; if (STEPS[s.i]?.timed) s.phase = 'run'; }
  save(); render();
}
function eventToggle() {
  if (s.eventRunning) { s.elapsed = elapsed(); s.eventRunning = false; }
  else { s.eventAt = Date.now(); s.eventRunning = true; }
  save(); render();
}
const stageDuration = () => s.stage === 'question' ? (question().time || round().time) : s.stage === 'break' || s.stage === 'rules' ? 300 : s.stage === 'submit' ? 10 : s.stage === 'tie' ? 30 : s.stage === 'bet' ? 30 : s.stage === 'bankQ' ? bank().time : 0;
function change(stage, { r = s.r, q = 0 } = {}) {
  stopMusic();
  s.stage = stage; s.r = r; s.q = q; s.hints = 1;
  timerReset(stageDuration());
  save(); render();
  window.scrollTo({ top: 0, behavior: 'instant' });
}

/* ---------- teams ---------- */
const rnd = n => {
  if (window.crypto?.getRandomValues) { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % n; }
  return Math.floor(Math.random() * n);
};
const shuffle = a => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
function parseRoster(text) {
  return text.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => {
    const m = l.match(/^(.*?)[\s,;\t]+(\d{1,2})\s*[А-Яа-яA-Za-z]?$/);
    return m ? { name: m[1].replace(/[,;\t\s]+$/, ''), grade: Number(m[2]) } : { name: l, grade: 0 };
  }).filter(p => p.name);
}
function mix() {
  const players = parseRoster(s.roster);
  if (players.length < 4) { prepWarn = true; modal = 'prep'; render(); return; }
  if (s.elapsed > 0 && s.teams.some(t => total(t) > 0) && !confirm(txt('Командаларды қайта араластырсақ, ұпайлар өшеді. Жалғастыру керек пе?', 'При новой жеребьёвке баллы сбросятся. Продолжить?'))) return;
  const size = Math.min(5, Math.max(3, Number(s.teamSize) || 4));
  const n = Math.min(10, Math.max(2, Math.round(players.length / size)));
  const by = g => shuffle(players.filter(p => p.grade === g));
  const ordered = [...by(10), ...by(11), ...shuffle(players.filter(p => p.grade !== 10 && p.grade !== 11))];
  const teams = makeTeams(n);
  ordered.forEach((p, i) => teams[i % n].members.push(p.name));
  teams.forEach(t => { t.members = shuffle(t.members); });
  s.teams = teams; s.mixed = true; s.revealed = 0;
  save(); render();
}

/* ---------- visuals ---------- */
const svg = (inner, label, box = '0 0 640 270', cls = '') => `<svg viewBox="${box}" class="diagram ${cls}" role="img" aria-label="${esc(label)}">${inner}</svg>`;
const line = (x1, y1, x2, y2, w = 3) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="currentColor" stroke-width="${w}"/>`;
const arrow = (x1, y1, x2, y2) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="currentColor" stroke-width="3" marker-end="url(#ah)"/>`;
const node = (x, y, t) => `<circle cx="${x}" cy="${y}" r="28" fill="#172338" stroke="currentColor" stroke-width="2"/><text x="${x}" y="${y + 8}" text-anchor="middle" fill="#f4f6fd" font-size="23">${t}</text>`;
const box = (x, y, w, h, t, r = 4) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="#172338" stroke="currentColor" stroke-width="2"/><text x="${x + w / 2}" y="${y + h / 2 + 7}" text-anchor="middle" fill="#f4f6fd" font-size="20">${t}</text>`;
const diamond = (cx, text, cy) => `<polygon points="${cx},${cy - 36} ${cx + 110},${cy} ${cx},${cy + 36} ${cx - 110},${cy}" fill="#172338" stroke="currentColor" stroke-width="2"/><text x="${cx}" y="${cy + 7}" text-anchor="middle" fill="#f4f6fd" font-size="20">${text}</text>`;
const tag = (x, y, t) => `<text x="${x}" y="${y}" fill="#c6ff63" font-size="17">${t}</text>`;
const lcg = seed => { let x = seed; return () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648; };
function comparePuzzle(p) {
  const rand = lcg(p.seed), left = [];
  for (let i = 0; i < p.cols * p.rows; i++) left.push(String.fromCharCode(65 + Math.floor(rand() * 26)));
  const right = [...left];
  p.positions.forEach((pos, i) => {
    const ch = p.word[i];
    if (left[pos] === ch) left[pos] = String.fromCharCode(65 + (ch.charCodeAt(0) - 64) % 26);
    right[pos] = ch;
  });
  return { left, right };
}
const gridPic = (cells, cols) => `<div class="grid-pic" style="grid-template-columns:repeat(${cols},1fr)">${cells.map(c => `<span>${c}</span>`).join('')}</div>`;
const soundWords = q => q.sound.map(b => b ? txt('ұзын', 'длинный') : txt('қысқа', 'короткий')).join(' / ');
function visual(kind, mini = false, q = question()) {
  switch (kind) {
    case 'lamps': return `<div class="lamps${mini ? ' mini' : ''}" aria-hidden="true">${q.lamps.map(row => `<div>${row.split('').map(c => `<i class="${c === '1' ? 'on' : ''}"></i>`).join('')}</div>`).join('')}</div>`;
    case 'pic': return `<div class="pics${mini ? ' mini' : ''}" aria-hidden="true">${q.silhouette && !mini ? `<span class="sil-frame"><img src="img/${q.pic}.svg" alt=""></span>` : `<img src="img/${q.pic}.svg" alt="">`}</div>`;
    case 'row': return `<div class="pics row${mini ? ' mini' : ''}" aria-hidden="true">${q.pics.map(p => `<img src="img/${p}.svg" alt="">`).join('')}</div>`;
    case 'pixel': return `<div class="pixel-shot${mini ? ' mini' : ''}" aria-hidden="true" style="grid-template-columns:repeat(${q.bitmap[0].length},1fr)">${q.bitmap.join('').split('').map(ch => `<i class="${ch === '#' ? 'k' : ch === 'o' ? 'w' : ''}"></i>`).join('')}</div>`;
    case 'melody': return `<div class="sound-task"><div class="waveform" aria-hidden="true">${Array.from({ length: 31 }, (_, i) => `<i style="height:${15 + ((i * 37) % 65)}px"></i>`).join('')}</div>${mini ? '' : button('playMelody', 'Әуенді тыңдау', 'Прослушать мелодию', 'primary')}</div>`;
    case 'pics': return `<div class="pics${mini ? ' mini' : ''}" aria-hidden="true"><img src="img/${q.pics[0]}.svg" alt=""><span>+</span><img src="img/${q.pics[1]}.svg" alt=""><span>=</span><b>?</b></div>`;
    case 'compare': {
      const p = q.puzzle, { left, right } = comparePuzzle(p);
      return `<div class="compare"><figure><figcaption>1</figcaption>${gridPic(left, p.cols)}</figure><figure><figcaption>2</figcaption>${gridPic(right, p.cols)}</figure></div>`;
    }
    case 'path': {
      const g = G.graph;
      const edges = g.edges.map(([a, b, w]) => { const [x1, y1] = g.nodes[a], [x2, y2] = g.nodes[b]; return line(x1, y1, x2, y2, 2) + `<text x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 + 5}" text-anchor="middle" fill="#c6ff63" stroke="#080d16" stroke-width="5" paint-order="stroke" font-size="17">${w}</text>`; }).join('');
      return svg(edges + Object.entries(g.nodes).map(([k, [x, y]]) => node(x, y, k)).join(''), txt('Салмақты граф: S және T төбелері', 'Взвешенный граф с вершинами S и T'));
    }
    case 'tree': {
      const n = { R: [320, 40], A: [190, 120], X: [450, 120], M: [120, 205], T: [260, 205], I: [390, 205] };
      const e = [['R', 'A'], ['R', 'X'], ['A', 'M'], ['A', 'T'], ['X', 'I']];
      return svg(e.map(([a, b]) => line(...n[a], ...n[b])).join('') + Object.entries(n).map(([k, [x, y]]) => node(x, y, k)).join(''), txt('Әріптері бар екілік ағаш', 'Двоичное дерево с буквами'));
    }
    case 'flow': {
      const defs = '<defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="currentColor"/></marker></defs>';
      return svg(defs + box(220, 10, 200, 40, 'n = 7, k = 0', 20) + arrow(320, 50, 320, 79) + diamond(320, 'n = 1 ?', 115) + arrow(430, 115, 500, 115) + box(500, 95, 120, 40, txt('k шығару', 'вывести k')) + tag(446, 100, txt('Иә', 'Да')) + arrow(320, 151, 320, 179) + tag(342, 172, txt('Жоқ', 'Нет')) + diamond(320, txt('n жұп?', 'n чётное?'), 215) + arrow(210, 215, 160, 215) + box(40, 195, 120, 40, 'n = n / 2') + tag(168, 200, txt('Иә', 'Да')) + arrow(430, 215, 480, 215) + box(480, 195, 130, 40, 'n = 3n + 1') + tag(438, 200, txt('Жоқ', 'Нет')) + line(100, 235, 100, 295) + arrow(100, 295, 260, 295) + line(545, 235, 545, 295) + arrow(545, 295, 380, 295) + box(260, 275, 120, 40, 'k = k + 1') + line(320, 315, 320, 334) + line(320, 334, 12, 334) + line(12, 334, 12, 115) + arrow(12, 115, 210, 115), txt('Блок-схема: n = 7 басталады, n = 1 болғанша қайталанады', 'Блок-схема: цикл с n = 7, пока n не станет равно 1'), '0 0 640 345', 'tall');
    }
    case 'sound': return `<div class="sound-task"><div class="waveform" aria-hidden="true">${Array.from({ length: 31 }, (_, i) => `<i style="height:${15 + ((i * 29) % 65)}px"></i>`).join('')}</div>${mini ? `<p>${soundWords(q)}</p>` : button('playSound', 'Сигналды тыңдау', 'Прослушать сигнал', 'primary') + button('fallback', 'Дыбыссыз нұсқа', 'Вариант без звука', 'subtle')}<p id="sound-fallback" hidden>${soundWords(q)}</p></div>`;
    default: return '';
  }
}
const LETTERS = 'ABCD';
const options = (q, reveal = false) => q.options ? `<div class="options">${q.options.map((o, i) => `<div class="option${reveal && i === q.correct ? ' correct' : ''}"><b>${LETTERS[i]}</b><span>${tr(o)}</span></div>`).join('')}</div>` : '';
const answerOf = q => q.options ? { kk: `${LETTERS[q.correct]} · ${q.options[q.correct].kk}`, ru: `${LETTERS[q.correct]} · ${q.options[q.correct].ru}` } : q.answer;
const mark = html => html.replace(/(ХОМЯК[А-ЯЁ]*|АТЖАЛМАН[А-ЯӘІҢҒҮҰҚӨҺ]*)/g, '<mark>$1</mark>');
const clues = q => q.clues ? `<div class="clues">${q.clues.map((c, i) => `<div><b>0${i + 1}</b>${tr(c)}</div>`).join('')}</div>` : '';
const story = q => q.story ? `<p class="story">${mark(tr(q.story, 'story-text'))}</p>` : '';
const code = q => q.code ? `<pre><code>${esc(q.code)}</code></pre>` : '';

/* ---------- background: 0/1 rain ---------- */
function startRain() {
  const canvas = document.createElement('canvas');
  canvas.id = 'rain-bg';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.prepend(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const CW = 22, CH = 26, TRAIL = 16;
  let cols = 0, rows = 0, bits = [], heads = [], speeds = [], timer = 0;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr;
    canvas.style.width = innerWidth + 'px'; canvas.style.height = innerHeight + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = '500 18px "IBM Plex Mono", Consolas, monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    cols = Math.ceil(innerWidth / CW); rows = Math.ceil(innerHeight / CH);
    bits = Array.from({ length: cols * rows }, () => rnd(2));
    heads = Array.from({ length: cols }, () => rnd(rows + TRAIL));
    speeds = Array.from({ length: cols }, () => .25 + rnd(60) / 100);
    draw();
  }
  function draw() {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    const span = rows + TRAIL;
    for (let c = 0; c < cols; c++) {
      const x = c * CW + CW / 2;
      for (let r = 0; r < rows; r++) {
        const d = (heads[c] - r + span) % span;
        const alpha = d < TRAIL ? .07 + .75 * (1 - d / TRAIL) ** 2 : .07;
        ctx.fillStyle = d < 1 ? 'rgba(235,255,200,.95)' : `rgba(198,255,99,${alpha})`;
        ctx.fillText(bits[r * cols + c], x, r * CH + CH / 2);
      }
    }
  }
  function tick() {
    for (let c = 0; c < cols; c++) {
      const before = Math.floor(heads[c]);
      heads[c] = (heads[c] + speeds[c]) % (rows + TRAIL);
      const after = Math.floor(heads[c]);
      if (after !== before && after < rows) bits[after * cols + c] ^= 1;
    }
    for (let i = 0; i < cols * rows * .004; i++) bits[rnd(cols * rows)] ^= 1;
    draw();
  }
  function loop() { clearInterval(timer); if (!reduce && !document.hidden) timer = setInterval(tick, 55); }
  addEventListener('resize', () => { resize(); });
  document.addEventListener('visibilitychange', loop);
  resize(); loop();
}

/* ---------- views ---------- */
function timer() {
  return `<div class="timer-widget"><div class="timer-read" id="countdown" role="timer">${fmt(left())}</div><div>${button('timer', s.running ? 'Кідірту' : 'Іске қосу', s.running ? 'Пауза' : 'Запустить', 'timer-btn')}${button('resetTimer', 'Қайта', 'Сброс', 'timer-btn')}</div><p id="timer-status" aria-live="polite">${left() === 0 ? txt('Уақыт бітті', 'Время вышло') : txt('Уақыт', 'Время')}</p></div>`;
}
function header() {
  return `<header><button class="brand" data-a="home" aria-label="${txt('Басты экран', 'Главный экран')}"><span class="brand-mark">&lt;/&gt;</span><span>CODE MATRIX<small>INFORMATICS</small></span></button><div class="top-actions"><label class="sr-only" for="lang">Язык / Тіл</label><select id="lang"><option value="both" ${s.lang === 'both' ? 'selected' : ''}>ҚАЗ + РУС</option><option value="kk" ${s.lang === 'kk' ? 'selected' : ''}>Қазақша</option><option value="ru" ${s.lang === 'ru' ? 'selected' : ''}>Русский</option></select>${button('sound', s.sound ? 'Дыбыс: қосулы' : 'Дыбыс: өшірулі', s.sound ? 'Звук: вкл.' : 'Звук: выкл.', 'quiet')}${button('fullscreen', 'Толық экран', 'На весь экран', 'quiet')}${button('help', '?', '?', 'help-button', `aria-label="${txt('Жүргізушіге', 'Ведущему')}"`)}</div></header>`;
}
function nav() {
  return `<nav class="round-nav" aria-label="${txt('Раундтар', 'Раунды')}">${G.rounds.map((r, i) => `<button data-a="jump" data-i="${i}" class="${s.r === i && !['home', 'mixer', 'rules'].includes(s.stage) ? 'active' : ''}"><span>0${i + 1}</span>${esc(r.name[s.lang === 'ru' ? 'ru' : 'kk'])}</button>`).join('')}</nav>`;
}
function home() {
  const started = s.elapsed > 0 || s.resume;
  return `<div class="home-layout"><section class="home-main"><h1>CODE<br><em>MATRIX</em><span class="title-dot">_</span></h1><p class="home-sub">${tr(B('Информатикадан білімдеріңізді тексереміз.', 'Проверим ваши знания по информатике.'))}</p><div class="home-meta"><div><strong>06</strong><span>${txt('раунд', 'раундов')}</span></div><div><strong>${G.maxScore}</strong><span>${txt('ұпай', 'баллов')}</span></div><div><strong>×2</strong><span>${txt('ва-банк', 'ва-банк')}</span></div><div><strong>90<span>${txt('мин', 'мин')}</span></strong><span>${txt('үзілістермен', 'с перерывами')}</span></div></div><div class="home-start">${button('start', started ? 'Жалғастыру' : 'Ойынды бастау', started ? 'Продолжить' : 'Начать игру', 'primary large')}${button('toMixer', 'Командалар жеребесі', 'Жеребьёвка команд', 'large')}${button('agenda', '90 минут жоспары', 'План на 90 минут', 'subtle large')}</div></section></div>`;
}
function mixer() {
  const revealed = s.mixed ? s.revealed : 0;
  const cards = s.mixed ? s.teams.map((t, i) => i < revealed
    ? `<article class="team-card"><div class="team-top"><strong>${esc(t.name)}</strong><span>${txt('КОМАНДА', 'КОМАНДА')} ${String(i + 1).padStart(2, '0')}</span></div>${t.members.map(m => `<div class="member">${esc(m)}</div>`).join('')}</article>`
    : `<article class="team-card hidden"><strong>?</strong><span>${txt('Команда', 'Команда')} ${String(i + 1).padStart(2, '0')}</span></article>`).join('')
    : `<div class="empty-state">${tr(B('Командалар әлі құрылған жоқ. «Араластыру» батырмасын басыңыз.', 'Команды ещё не собраны. Нажмите «Смешать в команды».'))}</div>`;
  const count = parseRoster(s.roster).length;
  return `<div class="mixer-head"><div><p class="eyebrow">${count ? `${count} ${txt('ойыншы', 'игроков')} · ${s.mixed ? s.teams.length : '?'} ${txt('команда', 'команд')}` : txt('ЖЕРЕБЕ', 'ЖЕРЕБЬЁВКА')}</p><h1>${tr(B('Командалар жеребесі', 'Жеребьёвка команд'))}</h1><p>${tr(B('Атыңызды тауып, командаңыздың атауы бар үстелге отырыңыз.', 'Найдите своё имя и садитесь за стол с названием вашей команды.'))}</p></div><div class="inline-actions">${s.mixed
    ? button('revealNext', 'Келесі команда', 'Следующая команда', 'primary', revealed >= s.teams.length ? 'disabled' : '') + button('revealAll', 'Барлығын көрсету', 'Показать все', '', revealed >= s.teams.length ? 'disabled' : '') + button('mix', 'Қайта араластыру', 'Перемешать заново', 'subtle')
    : button('mix', 'Командаларға араластыру', 'Смешать в команды', 'primary large')}${button('prep', 'Дайындық', 'Подготовка', 'subtle')}</div></div><div class="team-grid">${cards}</div>`;
}
function rules() {
  const items = [
    B('Командада 3–5 адам. Телефондар үзіліске дейін қолданылмайды.', 'В команде 3–5 человек. Телефоны используются только на перерывах.'),
    B('Әр раунд: сұрақтар, қайталау, бланкілерді тапсыру, жауаптар.', 'Каждый раунд: задания, повтор, сдача бланков, ответы.'),
    B(`Барлығы ${G.maxScore} ұпай және финалда ва-банк. Ва-банктен басқа қате жауапқа айып жоқ.`, `Всего ${G.maxScore} баллов и ва-банк в финале. Штрафов нет, кроме ва-банка.`),
    B('2 және 4-раундтан кейін 5 минут үзіліс.', 'После раундов 2 и 4 — перерывы по 5 минут.')
  ];
  return `<div class="stage-intro"><div><p class="eyebrow">BRIEFING / 05:00</p><h1>${tr(B('Ойын ережелері', 'Правила игры'))}</h1><div class="rules-list">${items.map((b, i) => `<p><span>0${i + 1}</span>${tr(b)}</p>`).join('')}</div></div>${timer()}</div>`;
}
function roundIntro() {
  const r = round();
  const points = r.ladder ? '3 / 2 / 1' : r.questions.some(q => q.points) ? `${r.points}–${Math.max(...r.questions.map(q => pointsOf(r, q)))}` : r.points;
  const hook = ['kk', 'ru'].filter(l => s.lang === 'both' || s.lang === l).map(l => `<p class="hook" lang="${l}" style="--n:${r.hook[l].length}">${esc(r.hook[l])}</p>`).join('');
  return `<div class="stage-intro round-intro"><div><p class="eyebrow">ROUND ${String(s.r + 1).padStart(2, '0')} / 06</p><div class="hooks">${hook}</div><h1>${tr(r.name)}</h1><p class="lead">${tr(r.sub)}</p><div class="round-facts"><span>${r.questions.length} ${txt('тапсырма', 'заданий')}${r.bankQuestion ? txt(' + ва-банк', ' + ва-банк') : ''}</span><span>${r.minutes} ${txt('минут', 'минут')}</span><span>${points} ${txt('ұпай / жауап', 'балл(а) / ответ')}</span></div><p class="rule-copy">${tr(r.rule)}</p>${r.example ? `<div class="example"><span class="mono">${txt('МЫСАЛ', 'ПРИМЕР')}</span><div class="pics mini" aria-hidden="true"><img src="img/${r.example.pics[0]}.svg" alt=""><span>+</span><img src="img/${r.example.pics[1]}.svg" alt=""><span>=</span><img src="img/${r.example.result}.svg" alt=""></div><strong>${tr(r.example.answer)}</strong></div>` : ''}</div><div class="giant-number" aria-hidden="true">${String(s.r + 1).padStart(2, '0')}</div></div>`;
}
function questionView() {
  const q = question(), r = round();
  const label = `${txt('СҰРАҚ', 'ВОПРОС')} ${String(s.q + 1).padStart(2, '0')} <span>/ ${String(r.questions.length).padStart(2, '0')}</span>`;
  const hints = q.hints ? `<div class="hints">${q.hints.slice(0, s.hints).map((h, i) => `<p><b>0${i + 1}</b>${tr(h)}</p>`).join('')}</div>${s.hints < 3 ? button('hint', 'Келесі белгі', 'Следующая подсказка', 'subtle') : ''}` : '';
  const aside = q.hints
    ? `<div class="ladder">${txt('Қазір жауап берсе', 'Если ответить сейчас')}<b>+${4 - s.hints}</b></div>`
    : `<p class="write-note">${tr(B('Жауапты бланкіге жазыңыз', 'Запишите ответ в бланк'))}</p>`;
  const rush = q.rush ? `<div class="rush-banner"><b>${txt('АСЫҒЫС', 'СПЕШКА')}</b><span>${q.time} ${txt('секунд', 'секунд')} · ${q.points} ${txt('ұпай', 'балла')}</span></div>` : '';
  return `<div class="question-layout"><section>${rush}<p class="eyebrow">${label}</p><h1 class="question-title${q.q.ru.length > 90 || q.story ? ' long' : ''}">${q.story ? mark(tr(q.q)) : tr(q.q)}</h1>${story(q)}${clues(q)}${q.detail ? `<p class="detail">${tr(q.detail)}</p>` : ''}${code(q)}${options(q)}${hints}${q.visual ? `<div class="visual">${visual(q.visual, false, q)}</div>` : ''}</section><aside>${timer()}${aside}</aside></div>`;
}
function review() {
  return `<p class="eyebrow">RECAP</p><h1 class="medium-title">${tr(B('Жауаптарды тексеріңіз', 'Проверьте свои ответы'))}</h1><div class="review-list">${round().questions.map((q, i) => `<article><b class="review-number">0${i + 1}</b><div><h2>${tr(q.q)}</h2>${story(q)}${clues(q)}${q.detail ? `<p>${tr(q.detail)}</p>` : ''}${code(q)}${options(q)}${q.hints ? `<p>${q.hints.map(h => tr(h)).join('<br>')}</p>` : ''}${q.visual ? `<div class="mini-visual">${visual(q.visual, true, q)}</div>` : ''}</div></article>`).join('')}</div>`;
}
function submit() {
  return `<div class="center-stage"><p class="eyebrow">PENS DOWN</p><h1>${tr(B('Бланкілерді тапсырыңыз', 'Сдайте бланки'))}</h1><p class="lead">${tr(B('Жүргізуші бланкілерді жинаған соң жауаптарды ашады.', 'Ведущий откроет ответы после сбора бланков.'))}</p>${timer()}</div>`;
}
function answer() {
  const q = question(), r = round();
  const pts = r.ladder ? `+3 / +2 / +1 ${txt('ұпай', 'балл(а)')}` : `+${pointsOf(r, q)} ${txt('ұпай', 'балл(а)')}`;
  return `<div class="answer-screen"><p class="eyebrow">${txt('ЖАУАП', 'ОТВЕТ')} 0${s.q + 1} / 0${r.questions.length}</p><p class="answer-question">${tr(q.q)}</p>${story(q)}${clues(q)}${q.detail ? `<p class="detail">${tr(q.detail)}</p>` : ''}${code(q)}${options(q, true)}${q.hints ? `<p class="detail">${q.hints.map(h => tr(h)).join('<br>')}</p>` : ''}${q.visual ? `<div class="mini-visual">${visual(q.visual, true, q)}</div>` : ''}<h1 class="answer-value${answerOf(q).ru.length > 24 ? ' long' : ''}">${tr(answerOf(q))}</h1>${q.solution ? `<pre><code>${esc(q.solution)}</code></pre>` : ''}<p class="answer-explain">${tr(q.explain)}</p><span class="points">${pts}</span></div>`;
}
const ranking = () => s.teams.map(t => ({ ...t, total: total(t) })).sort((a, b) => b.total - a.total);
function leaderboard() {
  return `<div class="leaderboard">${ranking().map((t, i, all) => {
    const place = all.findIndex(a => a.total === t.total) + 1;
    return `<div><span>${String(place).padStart(2, '0')}</span><strong>${esc(t.name)}</strong><div class="bar"><i style="width:${Math.min(100, t.total / G.maxScore * 100)}%"></i></div><b>${t.total}<small>/${G.maxScore}</small></b></div>`;
  }).join('')}</div>`;
}
function endRound() {
  return `<div class="result-head"><div><p class="eyebrow">ROUND ${s.r + 1} COMPLETE</p><h1 class="medium-title">${tr(B('Раунд аяқталды', 'Раунд завершён'))}</h1></div>${button('scores', 'Ұпайларды енгізу', 'Внести баллы', 'primary')}</div>${leaderboard()}<p class="muted">${tr(B('Кесте жүргізуші енгізген ұпайларды көрсетеді.', 'Таблица показывает баллы, внесённые ведущим.'))}</p>`;
}
function breakView() {
  return `<div class="center-stage"><p class="eyebrow">INTERMISSION / ${s.r === 1 ? '01' : '02'}</p><h1>${tr(B('Үзіліс', 'Перерыв'))}</h1><p class="lead">${tr(B('5 минут демалыс. Келесі раундқа дайындалыңыз.', '5 минут отдыха. Подготовьтесь к следующему раунду.'))}</p>${timer()}${button('music', music ? 'Әуенді тоқтату' : 'Фондық әуен', music ? 'Остановить музыку' : 'Фоновая музыка', 'subtle')}</div>`;
}
function growthCard() {
  return `<aside class="growth-card"><p class="eyebrow">${txt('ӨСУ КАРТАСЫ', 'КАРТА РОСТА')}</p><div><h3>${tr(B('Командадағы серіктестерден не білдім', 'Что я узнал(а) у партнёров по команде'))}</h3><div class="rule"></div><div class="rule"></div></div><div><h3>${tr(B('Серіктестеріме кеңесім', 'Мой совет партнёрам по команде'))}</h3><div class="rule"></div></div><div><h3>${tr(B('Әрі қарай қайда өсемін', 'Куда я расту дальше'))}</h3><div class="check"><i></i>${tr(B('Алгоритмдер және олимпиадалар', 'Алгоритмы и олимпиады'))}</div><div class="check"><i></i>${tr(B('Әзірлеу және жеке жобалар', 'Разработка и свои проекты'))}</div><div class="check"><i></i>${tr(B('Деректер және жасанды интеллект', 'Данные и искусственный интеллект'))}</div></div></aside>`;
}
function final() {
  return `<div class="result-head"><div><p class="eyebrow">GAME COMPLETE</p><h1 class="medium-title">${tr(B('Ойын қорытындысы', 'Итоги игры'))}</h1></div>${button('scores', 'Ұпайларды тексеру', 'Проверить баллы', 'primary')}</div><div class="final-grid"><div>${leaderboard()}<p class="lead">${tr(B('Қатысқандарыңызға рақмет!', 'Спасибо за игру!'))}</p><div class="inline-actions">${button('printGrowth', 'Өсу карталарын басып шығару', 'Распечатать карты роста', 'primary')}${button('tie', 'Тең ұпайға қосымша сұрақ', 'Вопрос при равенстве баллов', 'subtle')}${button('new', 'Жаңа ойын', 'Новая игра', 'subtle')}</div></div>${growthCard()}</div>`;
}
function betView() {
  const b = bank();
  return `<div class="center-stage bank"><p class="eyebrow">VA-BANQUE</p><h1>${tr(B('Ва-банк', 'Ва-банк'))}</h1><p class="lead bank-topic">${txt('Тақырып', 'Тема')}: ${tr(b.topic)}</p><p class="lead">${tr(B('Ставканы бланкіге жазыңыз: 0-ден 10 ұпайға дейін, бірақ өз ұпайыңыздан артық емес. Дұрыс жауап ставканың екі еселенген мөлшерін әкеледі, қате жауап ставканы алып кетеді.', 'Запишите ставку на бланке: от 0 до 10 баллов, но не больше ваших баллов. Верный ответ приносит удвоенную ставку, неверный отнимает ставку.'))}</p>${timer()}</div>`;
}
function bankQView() {
  const b = bank();
  return `<div class="question-layout"><section><div class="rush-banner bank-banner"><b>${txt('ВА-БАНК', 'ВА-БАНК')}</b><span>${tr(b.topic)}</span></div><h1 class="question-title long">${tr(b.q)}</h1>${b.detail ? `<p class="detail">${tr(b.detail)}</p>` : ''}${b.visual ? `<div class="visual">${visual(b.visual, false, b)}</div>` : ''}</section><aside>${timer()}<p class="write-note">${tr(B('Жауапты бланкіге жазыңыз', 'Запишите ответ в бланк'))}</p></aside></div>`;
}
function bankAnswerView() {
  const b = bank();
  return `<div class="answer-screen"><p class="eyebrow">VA-BANQUE · ${txt('ЖАУАП', 'ОТВЕТ')}</p><p class="answer-question">${tr(b.q)}</p>${b.detail ? `<p class="detail">${tr(b.detail)}</p>` : ''}${b.visual ? `<div class="visual">${visual(b.visual, true, b)}</div>` : ''}<h1 class="answer-value">${tr(b.answer)}</h1><p class="answer-explain">${tr(b.explain)}</p><span class="points">${txt('Дұрыс: +2 × ставка · қате: − ставка', 'Верно: +2 × ставка · неверно: −ставка')}</span></div>`;
}
function tie() { return `<div class="question-layout"><section><p class="eyebrow">TIEBREAK</p><h1 class="question-title">${tr(G.tie.q)}</h1><p class="detail">${tr(G.tie.explain)}</p></section>${timer()}</div>`; }
function body() {
  return ({
    home, mixer, rules, round: roundIntro, question: questionView, review, submit, answer, bet: betView, bankQ: bankQView, bankAnswer: bankAnswerView, roundEnd: endRound, break: breakView, final, tie,
    tieAnswer: () => `<div class="answer-screen"><p class="eyebrow">TIEBREAK</p><h1 class="answer-value">${tr(G.tie.answer)}</h1></div>`
  }[s.stage] || home)();
}
function nextLabel() {
  if (s.stage === 'tie') return B('Жауапты ашу', 'Открыть ответ');
  if (s.stage === 'tieAnswer') return B('Қорытындыға оралу', 'Вернуться к итогам');
  const st = STEPS[s.i];
  if (!st || st.stage === 'final') return null;
  if (st.timed && s.phase === 'ready') return B('Таймерді қосу', 'Запустить таймер');
  switch (st.stage) {
    case 'mixer': return !s.mixed ? B('Командаларға араластыру', 'Смешать в команды') : s.revealed < s.teams.length ? B('Келесі команданы ашу', 'Открыть следующую команду') : B('Ережелерге', 'К правилам');
    case 'rules': return B('1-раунд', 'Раунд 1');
    case 'round': return B('Тапсырмаларға көшу', 'К заданиям');
    case 'question': return question().hints && s.hints < 3 && left() > 0 ? B('Келесі белгі', 'Следующая подсказка') : s.q === round().questions.length - 1 ? B('Қайталау', 'Повтор заданий') : B('Келесі тапсырма', 'Следующее задание');
    case 'review': return B('Бланкілерді жинау', 'Собрать бланки');
    case 'submit': return B('Бланкілер жиналды · жауаптар', 'Бланки собраны · к ответам');
    case 'answer': return s.q < round().questions.length - 1 ? B('Келесі жауап', 'Следующий ответ') : s.r === 5 ? B('Ва-банк', 'Ва-банк') : B('Ұпайларды санау', 'Подсчёт баллов');
    case 'bet': return B('Сұрақты көрсету', 'Показать вопрос');
    case 'bankQ': return B('Жауапты ашу', 'Открыть ответ');
    case 'bankAnswer': return B('Ұпайларды санау', 'Подсчёт баллов');
    case 'roundEnd': return ROUNDS_WITH_BREAK.includes(s.r) ? B('5 минут үзіліс', 'Перерыв 5 минут') : s.r === 5 ? B('Қорытынды', 'Итоги') : B('Келесі раунд', 'Следующий раунд');
    case 'break': return B('Ойынды жалғастыру', 'Продолжить игру');
  }
  return null;
}
function footer() {
  const n = nextLabel();
  return `<footer><div class="session"><span id="event-time">${fmt(elapsed())}</span><span>/ 90:00</span>${button('event', s.eventRunning ? 'Ⅱ' : '▶', s.eventRunning ? 'Ⅱ' : '▶', 'icon-button', `aria-label="${txt('Жалпы уақытты кідірту немесе қосу', 'Пауза или запуск общего времени')}"`)}${button('agenda', 'Жоспар', 'План', 'subtle')}${button('scores', 'Ұпайлар', 'Баллы', 'subtle')}</div><div class="step-actions">${s.i > 0 || ['tie', 'tieAnswer'].includes(s.stage) || (s.stage === 'mixer' && s.revealed > 0) ? button('prev', 'Артқа', 'Назад', 'subtle') : ''}${n ? `<button class="primary" data-a="next">${tr(n)}</button>` : ''}</div></footer>`;
}

/* ---------- dialogs ---------- */
function scoreDialog() {
  return `<h2>${txt('Ұпайлар кестесі', 'Таблица баллов')}</h2><p class="muted">${tr(B('Әр раундтың жиынтық ұпайын енгізіңіз. Шектеулер автоматты тексеріледі.', 'Введите сумму за каждый раунд. Допустимые значения проверяются автоматически.'))}</p><div class="table-wrap"><table><thead><tr><th>${txt('Команда', 'Команда')}</th>${G.rounds.map((r, i) => `<th title="${esc(r.name[s.lang === 'ru' ? 'ru' : 'kk'])}">R${i + 1}<small>max ${roundMax(r)}</small></th>`).join('')}<th title="${txt('Ва-банк', 'Ва-банк')}">VB<small>${G.bank.min}…+${G.bank.max}</small></th><th>Σ</th></tr></thead><tbody>${s.teams.map((t, i) => `<tr><th>${esc(t.name)}</th>${t.scores.map((v, r) => `<td><input type="number" min="${limits(r).min}" max="${limits(r).max}" step="${limits(r).step}" value="${v}" data-score="${i},${r}" aria-label="${esc(t.name)}, ${r === 6 ? txt('ва-банк', 'ва-банк') : txt('раунд', 'раунд') + ' ' + (r + 1)}"></td>`).join('')}<td id="sum-${i}">${total(t)}</td></tr>`).join('')}</tbody></table></div><p class="small muted">${txt('3-раунд: әр жауап 1–3 ұпай. 4–6 раунд: 3-тің еселіктері. Ва-банк: дұрыс болса +2 × ставка, қате болса − ставка.', 'Раунд 3: каждый ответ 1–3 балла. Раунды 4–6: кратно 3. Ва-банк: верно — +2 × ставка, неверно — −ставка.')}</p>`;
}
function agenda() {
  let at = 0;
  return `<h2>${txt('90 минут жоспары', 'План на 90 минут')}</h2><p class="muted">${tr(B('Жүргізуші кезеңдерді өзі ауыстырады.', 'Ведущий переключает этапы вручную.'))}</p><div class="agenda">${G.agenda.map(a => { const start = at; at += a.min; return `<div><span class="mono">${String(start).padStart(2, '0')}–${String(at).padStart(2, '0')}</span><strong>${tr(a.name)}</strong><span>${a.min} мин</span></div>`; }).join('')}</div>`;
}
function prepDialog() {
  const p = parseRoster(s.roster);
  const g10 = p.filter(x => x.grade === 10).length, g11 = p.filter(x => x.grade === 11).length;
  return `<h2>Подготовка жеребьёвки</h2><p class="muted">Эти данные видите только вы. Закройте окно до того, как показывать экран ученикам.</p>${prepWarn ? '<p class="host-note">Нужно минимум 4 игрока. Впишите список и повторите жеребьёвку.</p>' : ''}<h3>Список игроков</h3><p class="small muted">По одному в строке: имя и класс через запятую или пробел. Например: «Айдана, 10» или «Тимур Ким 11А».</p><label class="sr-only" for="roster">Список игроков</label><textarea id="roster" placeholder="Айдана, 10&#10;Алишер, 11">${esc(s.roster)}</textarea><div class="row"><span id="roster-count" class="mono small">${p.length} игроков · 10 кл.: ${g10} · 11 кл.: ${g11}</span></div><div class="row"><label for="team-size">Размер команды (3–5)</label><input id="team-size" type="number" min="3" max="5" value="${s.teamSize}"></div><div class="row">${button('closePrep', 'Сохранить и закрыть', 'Сохранить и закрыть', 'primary')}</div>`;
}
function help() {
  return `<h2>${txt('Жүргізушіге', 'Ведущему')}</h2><p>Показывайте сайт с одного устройства на проекторе. Все задания видны на экране, команды пишут ответы на любом листе бумаги (бланки можно распечатать, но это не обязательно). Это окно ученикам не показывайте.</p><h3>Подготовка</h3><div class="row">${button('prep', 'Список игроков и жеребьёвка', 'Список игроков', '')}${button('print', 'Печать бланков', 'Печать бланков', '')}${button('printGrowth', 'Печать карт роста', 'Карты роста', '')}</div><h3>Что делать в каждом раунде</h3>${G.rounds.map((r, i) => `<p class="host-note"><strong>${i + 1}. ${esc(r.name.ru)}.</strong> ${esc(r.host)}</p>`).join('')}<h3>Пульт</h3><p>Всё ведётся одной кнопкой «Далее» (→ или PageDown на пульте). На экране с таймером первое нажатие запускает время, следующее открывает следующий экран. В раунде «Три подсказки» нажатия во время таймера открывают подсказки. «Назад» (← или PageUp) возвращает на шаг назад, пробел ставит таймер на паузу, Esc закрывает окно.</p><p>В раунде Shuffle включите звук: мелодия играет сама, когда запускается таймер. Фоновая музыка доступна на перерыве.</p><label class="volume-label">${txt('Дыбыс деңгейі', 'Громкость')}<input type="range" id="volume" min="0" max="0.8" step="0.05" value="${s.volume}"></label><p class="small muted">Прогресс сохраняется только в этом браузере. «Новая игра» сбрасывает баллы.</p><p class="small muted">Картинки: Twemoji, лицензия CC BY 4.0.</p>`;
}

/* ---------- render ---------- */
function render() {
  document.documentElement.lang = s.lang === 'ru' ? 'ru' : 'kk';
  document.body.dataset.stage = s.stage;
  root.innerHTML = header() + nav() + `<main class="main stage-${s.stage}" id="main">${body()}</main>` + (s.stage !== 'home' ? footer() : '') + (storageFailed ? `<p class="storage-warning">${txt('Сақтау мүмкін емес. Бетті жаңартпаңыз.', 'Сохранение недоступно. Не обновляйте страницу.')}</p>` : '');
  if (modal) {
    const content = { scores: scoreDialog, agenda, help, prep: prepDialog }[modal]();
    root.insertAdjacentHTML('beforeend', `<dialog open id="dialog" aria-labelledby="dialog-title"><div class="dialog-top">${button('close', 'Жабу ×', 'Закрыть ×', 'subtle')}</div><div class="dialog-content">${content}</div></dialog><div class="backdrop" data-a="close"></div>`);
    const heading = root.querySelector('dialog h2');
    if (heading) heading.id = 'dialog-title';
    root.querySelector('dialog button')?.focus();
  }
  save();
}

function go(i, phase = 'ready') {
  i = Math.max(0, Math.min(STEPS.length - 1, i));
  const st = STEPS[i];
  s.i = i; s.phase = phase;
  if (st.stage === 'final' && s.eventRunning) { s.elapsed = elapsed(); s.eventRunning = false; }
  if (st.stage === 'round') sting();
  change(st.stage, { r: st.r, q: st.q });
}
function startGame() {
  if (!s.eventRunning && s.elapsed === 0) { s.eventAt = Date.now(); s.eventRunning = true; }
  if (s.resume) { const v = s.resume; delete s.resume; go(v.i, v.phase); s.hints = v.hints; s.remaining = v.remaining; render(); }
  else if (s.i > 0) go(s.i, s.phase);
  else go(s.mixed ? stepIdx('rules') : 0);
}
/* One button drives the whole evening: on a timed screen the first press starts the timer, the next one moves on. */
function next() {
  if (s.stage === 'home') return startGame();
  if (s.stage === 'tie') return change('tieAnswer');
  if (s.stage === 'tieAnswer') return go(STEPS.length - 1);
  const st = STEPS[s.i];
  if (!st) return;
  if (st.stage === 'mixer') {
    if (!s.mixed) return mix();
    if (s.revealed < s.teams.length) { s.revealed++; return render(); }
    return go(s.i + 1);
  }
  if (st.timed) {
    if (s.phase === 'ready') {
      s.phase = 'run';
      if (s.remaining > 0) { s.deadline = Date.now() + s.remaining * 1000; s.running = true; }
      save(); render();
      if (st.stage === 'question' && question().visual === 'sound') setTimeout(playSound, 50);
      if (st.stage === 'question' && question().melody) { const notes = question().melody; setTimeout(() => playMelody(notes), 50); }
      return;
    }
    if (st.stage === 'question' && question().hints && s.hints < 3 && left() > 0) { s.hints++; return render(); }
    return go(s.i + 1);
  }
  if (st.stage !== 'final') go(s.i + 1);
}
function prev() {
  if (s.stage === 'tieAnswer') return change('tie');
  if (s.stage === 'tie') return go(STEPS.length - 1);
  const st = STEPS[s.i];
  if (!st || s.stage === 'home') return;
  if (st.stage === 'mixer') { if (s.mixed && s.revealed > 0) { s.revealed--; render(); } return; }
  if (st.timed && s.phase === 'run') return go(s.i);
  if (s.i > 0) go(s.i - 1);
}
function playMelody(notes = question().melody) {
  if (soundBusy || !notes) return;
  if (!s.sound) { s.sound = true; render(); }
  stopMusic(); soundBusy = true;
  const beat = .16;
  let t = .3;
  notes.forEach(([f, n]) => { tone(f, n * beat * .9, t, .5); t += n * beat; });
  setTimeout(() => { soundBusy = false; }, t * 1000);
}
function playSound() {
  if (soundBusy) return;
  if (!s.sound) { s.sound = true; render(); }
  stopMusic(); soundBusy = true;
  const d = (question().sound || [0, 1, 0, 1]).map(b => b ? .65 : .18);
  let t = .4;
  d.forEach(n => { tone(660, n, t, .6); t += n + .45; });
  const b = root.querySelector('[data-a="playSound"]');
  if (b) { b.disabled = true; b.textContent = txt('Тыңдаңыз…', 'Слушайте…'); }
  setTimeout(() => { soundBusy = false; if (s.stage === 'question' && question().visual === 'sound') render(); }, t * 1000);
}

/* ---------- printing ---------- */
function printHtml(html) {
  const p = document.createElement('section');
  p.id = 'print-sheets';
  p.innerHTML = html;
  document.body.appendChild(p);
  window.print();
  p.remove();
}
function printSheets() {
  printHtml(s.teams.map(t => `<article><h1>CODE MATRIX</h1><h2>${esc(t.name)}</h2>${G.rounds.map((r, i) => `<section><h3>${i + 1}. ${esc(r.name.kk)} / ${esc(r.name.ru)}</h3><div>${r.questions.map((_, j) => `<p>${j + 1}. ${r.ladder ? 'подсказка № ___ &nbsp; ' : ''}_______________________________________</p>`).join('')}</div></section>`).join('')}<section><h3>VA-BANQUE</h3><p>Ставка (0–10): ______ &nbsp; Ответ: ______________________</p></section></article>`).join(''));
}
function printGrowth() {
  const people = s.teams.flatMap(t => t.members.length ? t.members.map(m => ({ name: m, team: t.name })) : [{ name: '', team: t.name }]);
  const card = p => `<div class="growth-print"><h2>КАРТА РОСТА / ӨСУ КАРТАСЫ</h2><p>Имя: <b>${esc(p.name) || '______________________'}</b> · Команда: <b>${esc(p.team)}</b></p><h3>Что я узнал(а) у партнёров по команде</h3><div class="ln"></div><div class="ln"></div><h3>Мой совет партнёрам по команде</h3><div class="ln"></div><h3>Куда я расту дальше</h3><p>☐ Алгоритмы и олимпиады &nbsp; ☐ Разработка и свои проекты &nbsp; ☐ Данные и ИИ</p></div>`;
  printHtml(`<article>${people.map(card).join('')}</article>`);
}

/* ---------- events ---------- */
root.addEventListener('click', e => {
  const el = e.target.closest('[data-a]');
  if (!el || el.disabled) return;
  const a = el.dataset.a;
  switch (a) {
    case 'start': startGame(); break;
    case 'toMixer': go(0); break;
    case 'home': if (s.stage !== 'home') { s.resume = { i: s.i, phase: s.phase, hints: s.hints, remaining: left() }; change('home'); } break;
    case 'next': next(); break;
    case 'prev': prev(); break;
    case 'jump': if (confirm(txt('Осы раундтың басына өту керек пе? Ұпайлар сақталады.', 'Перейти к началу этого раунда? Баллы сохранятся.'))) go(stepIdx('round', Number(el.dataset.i))); break;
    case 'timer': timerToggle(); break;
    case 'resetTimer': timerReset(stageDuration() || 30); if (STEPS[s.i]?.timed) s.phase = 'ready'; save(); render(); break;
    case 'event': eventToggle(); break;
    case 'hint': s.hints = Math.min(3, s.hints + 1); render(); break;
    case 'help': case 'agenda': case 'scores': modal = a; render(); break;
    case 'prep': prepWarn = false; modal = 'prep'; render(); break;
    case 'closePrep': case 'close': prepWarn = false; modal = ''; render(); break;
    case 'mix': mix(); break;
    case 'revealNext': s.revealed = Math.min(s.teams.length, s.revealed + 1); render(); break;
    case 'revealAll': s.revealed = s.teams.length; render(); break;
    case 'sound': s.sound = !s.sound; if (!s.sound) stopMusic(); render(); break;
    case 'music': musicToggle(); break;
    case 'playSound': playSound(); break;
    case 'playMelody': playMelody(question().melody); break;
    case 'fallback': document.getElementById('sound-fallback').hidden = false; break;
    case 'print': printSheets(); break;
    case 'printGrowth': printGrowth(); break;
    case 'tie': change('tie'); break;
    case 'new':
      if (confirm(txt('Барлық ұпай мен ойын барысын тазарту керек пе?', 'Сбросить все баллы и прогресс игры?'))) {
        const { lang, roster, teamSize } = s;
        stopMusic();
        s = { ...initial(), lang, roster, teamSize };
        render();
      }
      break;
    case 'fullscreen': if (document.fullscreenElement) document.exitFullscreen?.(); else document.documentElement.requestFullscreen?.().catch(() => {}); break;
  }
});
root.addEventListener('change', e => {
  if (e.target.id === 'lang') { s.lang = e.target.value; render(); }
  if (e.target.id === 'team-size') { s.teamSize = Math.min(5, Math.max(3, Number(e.target.value) || 4)); e.target.value = s.teamSize; save(); }
  if (e.target.dataset.score) {
    const [i, r] = e.target.dataset.score.split(',').map(Number);
    const v = Number(e.target.value), { min, max, step } = limits(r);
    if (e.target.value === '' || !Number.isInteger(v) || v < min || v > max || v % step !== 0) {
      e.target.value = s.teams[i].scores[r];
      e.target.setCustomValidity(txt(`${min}…${max}, қадам ${step}`, `От ${min} до ${max}, шаг ${step}`));
      e.target.reportValidity();
      setTimeout(() => e.target.setCustomValidity(''), 2000);
      return;
    }
    s.teams[i].scores[r] = v;
    document.getElementById(`sum-${i}`).textContent = total(s.teams[i]);
    save();
  }
});
root.addEventListener('input', e => {
  if (e.target.id === 'roster') {
    s.roster = e.target.value; save();
    const p = parseRoster(s.roster);
    const c = document.getElementById('roster-count');
    if (c) c.textContent = `${p.length} игроков · 10 кл.: ${p.filter(x => x.grade === 10).length} · 11 кл.: ${p.filter(x => x.grade === 11).length}`;
  }
  if (e.target.id === 'volume') { s.volume = Number(e.target.value); save(); }
});
document.addEventListener('keydown', e => {
  if (modal) {
    if (e.key === 'Escape') { modal = ''; prepWarn = false; render(); }
    if (e.key === 'Tab') {
      const items = [...document.querySelectorAll('dialog button, dialog input, dialog select, dialog textarea')];
      const first = items[0], last = items.at(-1);
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    }
    return;
  }
  if (e.target.matches('input, select, textarea')) return;
  if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); next(); }
  if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); prev(); }
  if (e.key === ' ' && !e.target.matches('button') && STEPS[s.i]?.timed && s.stage !== 'home') { e.preventDefault(); timerToggle(); }
});
setInterval(() => {
  if (s.running && left() === 0) {
    s.running = false; s.remaining = 0;
    tone(880, .18); tone(880, .18, .3); tone(440, .5, .6);
    save(); render();
  }
  if (s.running && s.stage === 'question' && question().rush && left() > 0 && left() <= 10) tone(1000, .06, 0, .5);
  const t = document.getElementById('countdown');
  if (t) { t.textContent = fmt(left()); t.classList.toggle('urgent', left() <= 10); }
  const et = document.getElementById('event-time');
  if (et) { et.textContent = fmt(elapsed()); et.classList.toggle('urgent', elapsed() > 5400); }
  if (s.eventRunning || s.running) save();
}, 1000);
window.addEventListener('beforeunload', save);
startRain();
render();
})();
