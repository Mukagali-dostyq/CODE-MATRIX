(() => {
'use strict';

const G = window.GAME;
const root = document.getElementById('app');
const KEY = 'code-matrix-v1';
const STAGES = ['home', 'mixer', 'rules', 'round', 'question', 'review', 'submit', 'answer', 'roundEnd', 'break', 'final', 'tie', 'tieAnswer'];
const ROUNDS_WITH_BREAK = [1, 3];

const zeros = () => [0, 0, 0, 0, 0, 0];
const makeTeams = n => Array.from({ length: n }, (_, i) => ({ name: G.teamNames[i] || `Команда ${i + 1}`, scores: zeros(), members: [] }));
const initial = () => ({
  lang: 'both', stage: 'home', r: 0, q: 0, hints: 1,
  teams: makeTeams(4), roster: '', teamSize: 4, mixed: false, revealed: 0,
  elapsed: 0, eventRunning: false, eventAt: 0,
  remaining: 45, deadline: 0, running: false, sound: true, volume: .25
});

let s = initial();
try {
  const old = JSON.parse(localStorage.getItem(KEY));
  if (old && ['kk', 'ru', 'both'].includes(old.lang) && Array.isArray(old.teams) && old.teams.length >= 2 && old.teams.length <= 10
    && old.teams.every(t => typeof t.name === 'string' && t.scores?.length === 6 && Array.isArray(t.members))
    && old.r >= 0 && old.r < 6 && old.q >= 0 && old.q < G.rounds[old.r].questions.length && STAGES.includes(old.stage)) s = { ...s, ...old };
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
const roundMax = r => r.points * r.questions.length;

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
  else if (s.remaining > 0) { s.deadline = Date.now() + s.remaining * 1000; s.running = true; }
  save(); render();
}
function eventToggle() {
  if (s.eventRunning) { s.elapsed = elapsed(); s.eventRunning = false; }
  else { s.eventAt = Date.now(); s.eventRunning = true; }
  save(); render();
}
const stageDuration = () => s.stage === 'question' ? (question().time || round().time) : s.stage === 'break' || s.stage === 'rules' ? 300 : s.stage === 'submit' ? 10 : s.stage === 'tie' ? 30 : 0;
function change(stage, { r = s.r, q = 0 } = {}) {
  stopMusic();
  s.stage = stage; s.r = r; s.q = q; s.hints = 1;
  timerReset(stageDuration());
  if (stage === 'submit') { s.deadline = Date.now() + 10000; s.running = true; }
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
const svg = (inner, label) => `<svg viewBox="0 0 640 270" class="diagram" role="img" aria-label="${esc(label)}">${inner}</svg>`;
const line = (x1, y1, x2, y2) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="currentColor" stroke-width="3"/>`;
const node = (x, y, t) => `<circle cx="${x}" cy="${y}" r="28" fill="#172338" stroke="currentColor" stroke-width="2"/><text x="${x}" y="${y + 8}" text-anchor="middle" fill="#f4f6fd" font-size="23">${t}</text>`;
function visual(kind, mini = false) {
  switch (kind) {
    case 'binary': return '<div class="bits" aria-label="10110">' + [1, 0, 1, 1, 0].map((n, i) => `<span><b>${n}</b><small>2<sup>${4 - i}</sup></small></span>`).join('') + '</div>';
    case 'graph': return svg(line(130, 70, 320, 40) + line(320, 40, 510, 90) + line(510, 90, 380, 220) + line(380, 220, 130, 70) + line(130, 70, 150, 220) + line(150, 220, 380, 220) + [[130, 70, 'A'], [320, 40, 'B'], [510, 90, 'C'], [380, 220, 'D'], [150, 220, 'E']].map(n => node(...n)).join(''), txt('A–E төбелері және олардың қырлары', 'Вершины A–E и соединяющие их рёбра'));
    case 'stack': return '<div class="stack-demo"><div class="stack-ops">push(30)<br>pop() = 30</div><div class="stack"><div class="top">30</div><div>20</div><div>10</div></div></div>';
    case 'search': return '<div class="search-demo">' + [[2, 5, 8, 11, 14, 17, 20, 23], [14, 17, 20, 23], [17]].map((ar, i) => `<div><small>0${i + 1}</small>${ar.map(n => `<span class="${n === 17 ? 'target' : ''}">${n}</span>`).join('')}</div>`).join('') + '</div>';
    case 'flow': return svg('<path d="M320 20 L415 70 L320 120 L225 70 Z" fill="#172338" stroke="currentColor" stroke-width="2"/><text x="320" y="77" text-anchor="middle" fill="white" font-size="22">x &gt; 5?</text>' + line(225, 70, 130, 70) + line(130, 70, 130, 160) + line(415, 70, 510, 70) + line(510, 70, 510, 160) + `<text x="135" y="56" fill="white" font-size="18">${txt('Иә', 'Да')}</text><text x="450" y="56" fill="white" font-size="18">${txt('Жоқ', 'Нет')}</text>` + '<rect x="60" y="160" width="140" height="50" fill="#172338" stroke="currentColor"/><rect x="440" y="160" width="140" height="50" fill="#172338" stroke="currentColor"/><text x="130" y="192" text-anchor="middle" fill="white" font-size="22">y = 2 × x</text><text x="510" y="192" text-anchor="middle" fill="white" font-size="22">y = x + 2</text>' + line(130, 210, 130, 240) + line(510, 210, 510, 240) + line(130, 240, 510, 240) + `<text x="320" y="264" text-anchor="middle" fill="white" font-size="18">${txt('y мәнін шығару', 'Вывести y')}</text>`, txt('x > 5 болса y = 2 × x, әйтпесе y = x + 2', 'Если x > 5, то y = 2 × x, иначе y = x + 2'));
    case 'sound': return `<div class="sound-task"><div class="waveform" aria-hidden="true">${Array.from({ length: 31 }, (_, i) => `<i style="height:${15 + ((i * 29) % 65)}px"></i>`).join('')}</div>${mini ? `<p>${txt('Қысқа / ұзын / қысқа / ұзын', 'Короткий / длинный / короткий / длинный')}</p>` : button('playSound', 'Сигналды тыңдау', 'Прослушать сигнал', 'primary') + button('fallback', 'Дыбыссыз нұсқа', 'Вариант без звука', 'subtle')}<p id="sound-fallback" hidden>${txt('Қысқа / ұзын / қысқа / ұзын', 'Короткий / длинный / короткий / длинный')}</p></div>`;
    default: return '';
  }
}
const code = q => q.code ? `<pre><code>${esc(q.code)}</code></pre>` : '';

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
function rainHtml() {
  let seed = 11;
  const nx = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed >>> 8; };
  return Array.from({ length: 12 }, () => `<span style="--o:${(.2 + (nx() % 50) / 100).toFixed(2)};--d:${18 + nx() % 14}s;margin-top:-${nx() % 120}px">${Array.from({ length: 24 }, () => nx() % 2).join('\n')}</span>`).join('');
}
function home() {
  const started = s.elapsed > 0 || s.resume;
  return `<div class="home-layout"><section class="home-main"><h1>CODE<br><em>MATRIX</em><span class="title-dot">_</span></h1><p class="home-sub">${tr(B('Информатикадан білімдеріңізді тексереміз.', 'Проверим ваши знания по информатике.'))}</p><div class="home-meta"><div><strong>06</strong><span>${txt('раунд', 'раундов')}</span></div><div><strong>50</strong><span>${txt('ұпай', 'баллов')}</span></div><div><strong>90<span>${txt('мин', 'мин')}</span></strong><span>${txt('үзілістермен', 'с перерывами')}</span></div></div><div class="home-start">${button('start', started ? 'Жалғастыру' : 'Ойынды бастау', started ? 'Продолжить' : 'Начать игру', 'primary large')}${button('toMixer', 'Командалар жеребесі', 'Жеребьёвка команд', 'large')}${button('agenda', '90 минут жоспары', 'План на 90 минут', 'subtle large')}</div></section><aside class="rain-panel" aria-hidden="true"><div class="rain">${rainHtml()}</div><div class="rain-caption"><p class="mono">${txt('БІЛІМ ТЕСТІ', 'ТЕСТ ЗНАНИЙ')}</p><strong>${txt('Кодтағы бір қате — бәрі өзгереді.', 'Одна ошибка в коде — и всё меняется.')}</strong></div></aside></div>`;
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
    B('Барлығы 50 ұпай. Қате жауапқа айып жоқ.', 'Всего 50 баллов. За неверный ответ штрафов нет.'),
    B('2 және 4-раундтан кейін 5 минут үзіліс.', 'После раундов 2 и 4 — перерывы по 5 минут.')
  ];
  return `<div class="stage-intro"><div><p class="eyebrow">BRIEFING / 05:00</p><h1>${tr(B('Ойын ережелері', 'Правила игры'))}</h1><div class="rules-list">${items.map((b, i) => `<p><span>0${i + 1}</span>${tr(b)}</p>`).join('')}</div></div>${timer()}</div>`;
}
function roundIntro() {
  const r = round();
  const points = r.ladder ? '3 / 2 / 1' : r.points;
  return `<div class="stage-intro round-intro"><div><p class="eyebrow">ROUND ${String(s.r + 1).padStart(2, '0')} / 06</p><h1>${tr(r.name)}</h1><p class="lead">${tr(r.sub)}</p><div class="round-facts"><span>${r.questions.length} ${txt('тапсырма', 'заданий')}</span><span>${r.minutes} ${txt('минут', 'минут')}</span><span>${points} ${txt('ұпай / жауап', 'балл(а) / ответ')}</span></div><p class="rule-copy">${tr(r.rule)}</p></div><div class="giant-number" aria-hidden="true">${String(s.r + 1).padStart(2, '0')}</div></div>`;
}
function questionView() {
  const q = question(), r = round();
  const label = r.cards ? `${r.name[s.lang === 'ru' ? 'ru' : 'kk'].toUpperCase()} № ${s.q + 1}` : `${txt('СҰРАҚ', 'ВОПРОС')} ${String(s.q + 1).padStart(2, '0')} <span>/ ${String(r.questions.length).padStart(2, '0')}</span>`;
  const cipher = r.cards ? `<div class="cipher-box"><span class="mono">${txt('ЖАУАП', 'ОТВЕТ')}</span><strong>?</strong></div><p class="detail">${tr(B('Қажетті барлығы үстеліңізде жатыр. Жауапты бланкіге жазыңыз.', 'Всё необходимое лежит у вас на столе. Ответ запишите в бланк.'))}</p>` : '';
  const hints = q.hints ? `<div class="hints">${q.hints.slice(0, s.hints).map((h, i) => `<p><b>0${i + 1}</b>${tr(h)}</p>`).join('')}</div>${s.hints < 3 ? button('hint', 'Келесі белгі', 'Следующая подсказка', 'subtle') : ''}` : '';
  const aside = q.hints
    ? `<div class="ladder">${txt('Қазір жауап берсе', 'Если ответить сейчас')}<b>+${4 - s.hints}</b></div>`
    : `<p class="write-note">${tr(B('Жауапты бланкіге жазыңыз', 'Запишите ответ в бланк'))}</p>`;
  return `<div class="question-layout"><section><p class="eyebrow">${label}</p><h1 class="question-title">${tr(q.q)}</h1>${q.detail ? `<p class="detail">${tr(q.detail)}</p>` : ''}${code(q)}${cipher}${hints}${q.visual ? `<div class="visual">${visual(q.visual)}</div>` : ''}</section><aside>${timer()}${aside}</aside></div>`;
}
function review() {
  return `<p class="eyebrow">RECAP</p><h1 class="medium-title">${tr(B('Жауаптарды тексеріңіз', 'Проверьте свои ответы'))}</h1><div class="review-list">${round().questions.map((q, i) => `<article><b class="review-number">0${i + 1}</b><div><h2>${tr(q.q)}</h2>${q.detail ? `<p>${tr(q.detail)}</p>` : ''}${code(q)}${q.hints ? `<p>${q.hints.map(h => tr(h)).join('<br>')}</p>` : ''}${q.visual ? `<div class="mini-visual">${visual(q.visual, true)}</div>` : ''}</div></article>`).join('')}</div>`;
}
function submit() {
  return `<div class="center-stage"><p class="eyebrow">PENS DOWN</p><h1>${tr(B('Бланкілерді тапсырыңыз', 'Сдайте бланки'))}</h1><p class="lead">${tr(B('Жүргізуші бланкілерді жинаған соң жауаптарды ашады.', 'Ведущий откроет ответы после сбора бланков.'))}</p>${timer()}</div>`;
}
function answer() {
  const q = question(), r = round();
  const pts = r.ladder ? `+3 / +2 / +1 ${txt('ұпай', 'балл(а)')}` : `+${r.points} ${txt('ұпай', 'балл(а)')}`;
  return `<div class="answer-screen"><p class="eyebrow">${txt('ЖАУАП', 'ОТВЕТ')} 0${s.q + 1} / 0${r.questions.length}</p><p class="answer-question">${tr(q.q)}</p><h1 class="answer-value">${tr(q.answer)}</h1><p class="answer-explain">${tr(q.explain)}</p><span class="points">${pts}</span></div>`;
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
function tie() { return `<div class="question-layout"><section><p class="eyebrow">TIEBREAK</p><h1 class="question-title">${tr(G.tie.q)}</h1><p class="detail">${tr(G.tie.explain)}</p></section>${timer()}</div>`; }
function body() {
  return ({
    home, mixer, rules, round: roundIntro, question: questionView, review, submit, answer, roundEnd: endRound, break: breakView, final, tie,
    tieAnswer: () => `<div class="answer-screen"><p class="eyebrow">TIEBREAK</p><h1 class="answer-value">${tr(G.tie.answer)}</h1></div>`
  }[s.stage] || home)();
}
function nextLabel() {
  return ({
    mixer: B('Ережелерге', 'К правилам'),
    rules: B('1-раунд', 'Раунд 1'),
    round: B('Тапсырмаларға көшу', 'К заданиям'),
    question: s.q === round().questions.length - 1 ? B('Қайталау', 'Повтор заданий') : B('Келесі тапсырма', 'Следующее задание'),
    review: B('Бланкілерді жинау', 'Собрать бланки'),
    submit: B('Бланкілер жиналды · жауаптар', 'Бланки собраны · к ответам'),
    answer: s.q === round().questions.length - 1 ? B('Ұпайларды санау', 'Подсчёт баллов') : B('Келесі жауап', 'Следующий ответ'),
    roundEnd: ROUNDS_WITH_BREAK.includes(s.r) ? B('5 минут үзіліс', 'Перерыв 5 минут') : s.r === 5 ? B('Қорытынды', 'Итоги') : B('Келесі раунд', 'Следующий раунд'),
    break: B('Ойынды жалғастыру', 'Продолжить игру'),
    tie: B('Жауапты ашу', 'Открыть ответ'),
    tieAnswer: B('Қорытындыға оралу', 'Вернуться к итогам')
  })[s.stage];
}
function footer() {
  const n = nextLabel();
  return `<footer><div class="session"><span id="event-time">${fmt(elapsed())}</span><span>/ 90:00</span>${button('event', s.eventRunning ? 'Ⅱ' : '▶', s.eventRunning ? 'Ⅱ' : '▶', 'icon-button', `aria-label="${txt('Жалпы уақытты кідірту немесе қосу', 'Пауза или запуск общего времени')}"`)}${button('agenda', 'Жоспар', 'План', 'subtle')}${button('scores', 'Ұпайлар', 'Баллы', 'subtle')}</div><div class="step-actions">${['question', 'answer'].includes(s.stage) && s.q > 0 ? button('prev', 'Артқа', 'Назад', 'subtle') : ''}${n ? `<button class="primary" data-a="next" ${s.stage === 'submit' && left() > 0 ? 'disabled' : ''}>${tr(n)}</button>` : ''}</div></footer>`;
}

/* ---------- dialogs ---------- */
function scoreDialog() {
  return `<h2>${txt('Ұпайлар кестесі', 'Таблица баллов')}</h2><p class="muted">${tr(B('Әр раундтың жиынтық ұпайын енгізіңіз. Шектеулер автоматты тексеріледі.', 'Введите сумму за каждый раунд. Допустимые значения проверяются автоматически.'))}</p><div class="table-wrap"><table><thead><tr><th>${txt('Команда', 'Команда')}</th>${G.rounds.map((r, i) => `<th title="${esc(r.name[s.lang === 'ru' ? 'ru' : 'kk'])}">R${i + 1}<small>max ${roundMax(r)}</small></th>`).join('')}<th>Σ</th></tr></thead><tbody>${s.teams.map((t, i) => `<tr><th>${esc(t.name)}</th>${t.scores.map((v, r) => `<td><input type="number" min="0" max="${roundMax(G.rounds[r])}" step="${G.rounds[r].step}" value="${v}" data-score="${i},${r}" aria-label="${esc(t.name)}, ${txt('раунд', 'раунд')} ${r + 1}"></td>`).join('')}<td id="sum-${i}">${total(t)}</td></tr>`).join('')}</tbody></table></div><p class="small muted">${txt('3-раунд: әр жауап 1–3 ұпай. 4–6 раунд: 0, 3, 6, 9.', 'Раунд 3: каждый ответ 1–3 балла. Раунды 4–6: 0, 3, 6, 9.')}</p>`;
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
  return `<h2>${txt('Жүргізушіге', 'Ведущему')}</h2><p>Показывайте сайт с одного устройства на проекторе. Команды отвечают на бумажных бланках. Это окно ученикам не показывайте.</p><h3>Подготовка</h3><div class="row">${button('prep', 'Список игроков и жеребьёвка', 'Список игроков', '')}${button('print', 'Печать бланков', 'Печать бланков', '')}${button('printCards', 'Печать карточек «Шифр» и «Эхо»', 'Карточки', '')}${button('printGrowth', 'Печать карт роста', 'Карты роста', '')}</div><h3>Что делать в каждом раунде</h3>${G.rounds.map((r, i) => `<p class="host-note"><strong>${i + 1}. ${esc(r.name.ru)}.</strong> ${esc(r.host)}</p>`).join('')}<h3>Клавиши</h3><p>→ — следующий шаг, ← — предыдущее задание, пробел — таймер, Esc — закрыть окно.</p><p>В раунде «Видишь, слышишь» включите звук. Если звук не работает, используйте вариант без звука. Фоновая музыка доступна на перерыве.</p><label class="volume-label">${txt('Дыбыс деңгейі', 'Громкость')}<input type="range" id="volume" min="0" max="0.8" step="0.05" value="${s.volume}"></label><p class="small muted">Прогресс сохраняется только в этом браузере. «Новая игра» сбрасывает баллы.</p>`;
}

/* ---------- render ---------- */
function render() {
  document.documentElement.lang = s.lang === 'ru' ? 'ru' : 'kk';
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

function next() {
  switch (s.stage) {
    case 'mixer': change('rules'); break;
    case 'rules': sting(); change('round', { r: 0 }); break;
    case 'round': change('question'); break;
    case 'question': s.q < round().questions.length - 1 ? change('question', { q: s.q + 1 }) : change('review'); break;
    case 'review': change('submit'); break;
    case 'submit': if (left() === 0) change('answer'); break;
    case 'answer': s.q < round().questions.length - 1 ? change('answer', { q: s.q + 1 }) : change('roundEnd'); break;
    case 'roundEnd':
      if (ROUNDS_WITH_BREAK.includes(s.r)) change('break');
      else if (s.r === 5) { if (s.eventRunning) { s.elapsed = elapsed(); s.eventRunning = false; } change('final'); }
      else { sting(); change('round', { r: s.r + 1 }); }
      break;
    case 'break': sting(); change('round', { r: s.r + 1 }); break;
    case 'tie': change('tieAnswer'); break;
    case 'tieAnswer': change('final'); break;
  }
}
function playSound() {
  if (soundBusy) return;
  if (!s.sound) { s.sound = true; render(); }
  stopMusic(); soundBusy = true;
  const d = [.18, .65, .18, .65];
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
  printHtml(s.teams.map(t => `<article><h1>CODE MATRIX</h1><h2>${esc(t.name)}</h2>${G.rounds.map((r, i) => `<section><h3>${i + 1}. ${esc(r.name.kk)} / ${esc(r.name.ru)}</h3><div>${r.questions.map((_, j) => `<p>${j + 1}. ${r.ladder ? 'подсказка № ___ &nbsp; ' : ''}_______________________________________</p>`).join('')}</div></section>`).join('')}</article>`).join(''));
}
function printCards() {
  const intro = '<article><h1>Карточки раундов «Шифр» и «Эхо»</h1><p>На одну команду нужен один лист каждого задания. Копируйте по числу команд и режьте по пунктирным линиям.</p><p><b>«Шифр»:</b> карточки А (правила) получает 11 класс, карточки Б (данные) получает 10 класс.</p><p><b>«Эхо»:</b> карточки А (правила) получает 10 класс, карточки Б (данные) получает 11 класс.</p><p>Вслух не объясняйте, почему карточки разные. Этот лист ученикам не показывайте.</p></article>';
  const pages = [3, 4].flatMap(ri => G.rounds[ri].questions.map((q, qi) => {
    const title = `${G.rounds[ri].name.ru} № ${qi + 1}`;
    const card = (l, c) => `<div class="cut-card"><h3>${esc(title)} · ${l}</h3><p>${esc(c.ru)}</p><p>${esc(c.kk)}</p></div>`;
    return `<article><div class="cards-page">${card('А', q.cards.a)}${card('А', q.cards.a)}${card('Б', q.cards.b)}${card('Б', q.cards.b)}</div></article>`;
  }));
  printHtml(intro + pages.join(''));
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
    case 'start':
      if (!s.eventRunning && s.elapsed === 0) { s.eventAt = Date.now(); s.eventRunning = true; }
      if (s.resume) { const v = s.resume; delete s.resume; change(v.stage, { r: v.r, q: v.q }); s.hints = v.hints; s.remaining = v.remaining; render(); }
      else change(s.mixed ? 'rules' : 'mixer');
      break;
    case 'toMixer': change('mixer'); break;
    case 'home': if (s.stage !== 'home') { s.resume = { stage: s.stage, r: s.r, q: s.q, hints: s.hints, remaining: left() }; change('home'); } break;
    case 'next': next(); break;
    case 'prev': if (s.q > 0) change(s.stage, { q: s.q - 1 }); break;
    case 'jump': if (confirm(txt('Осы раундтың басына өту керек пе? Ұпайлар сақталады.', 'Перейти к началу этого раунда? Баллы сохранятся.'))) change('round', { r: Number(el.dataset.i) }); break;
    case 'timer': timerToggle(); break;
    case 'resetTimer': timerReset(stageDuration() || 30); save(); render(); break;
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
    case 'fallback': document.getElementById('sound-fallback').hidden = false; break;
    case 'print': printSheets(); break;
    case 'printCards': printCards(); break;
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
    const v = Number(e.target.value), max = roundMax(G.rounds[r]), step = G.rounds[r].step;
    if (e.target.value === '' || !Number.isInteger(v) || v < 0 || v > max || v % step !== 0) {
      e.target.value = s.teams[i].scores[r];
      e.target.setCustomValidity(txt(`0–${max}, қадам ${step}`, `От 0 до ${max}, шаг ${step}`));
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
  if (e.target.matches('input, select, textarea, button')) return;
  if (e.key === 'ArrowRight') { e.preventDefault(); next(); }
  if (e.key === 'ArrowLeft' && ['question', 'answer'].includes(s.stage) && s.q > 0) change(s.stage, { q: s.q - 1 });
  if (e.key === ' ' && ['question', 'break', 'rules', 'tie'].includes(s.stage)) { e.preventDefault(); timerToggle(); }
});
setInterval(() => {
  if (s.running && left() === 0) {
    s.running = false; s.remaining = 0;
    tone(880, .18); tone(880, .18, .3); tone(440, .5, .6);
    save(); render();
  }
  const t = document.getElementById('countdown');
  if (t) { t.textContent = fmt(left()); t.classList.toggle('urgent', left() <= 10); }
  const et = document.getElementById('event-time');
  if (et) { et.textContent = fmt(elapsed()); et.classList.toggle('urgent', elapsed() > 5400); }
  if (s.eventRunning || s.running) save();
}, 1000);
window.addEventListener('beforeunload', save);
render();
})();
