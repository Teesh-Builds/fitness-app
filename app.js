/* Lift Block: all data lives in this browser's localStorage. No server. */
(() => {
  'use strict';

  const KEY = 'liftblock.v1';
  const LIB = window.EXERCISE_LIBRARY;
  const CATS = LIB.categories;
  const WEEKS = LIB.blockWeeks || 12;
  const DELOAD = LIB.deloadWeeks || [6, 12];
  const DEFAULT_SETS = LIB.defaultSets || 3;
  const LB_PER_KG = 2.20462;
  const MEAS = [['waist', 'Waist'], ['hips', 'Hips'], ['chest', 'Chest'], ['arm', 'Upper arm'], ['thigh', 'Thigh']];
  const FLOWS = {
    onboard: { title: 'Set up', steps: ['units', 'body', 'targets', 'plan'], finish: 'Start my plan' },
    edit: { title: 'Edit profile', steps: ['units', 'body', 'targets'], finish: 'Save' },
    checkin: { title: `Week ${WEEKS + 1} check-in`, steps: ['body', 'targets', 'plan'], finish: 'Start next 12 weeks' },
  };

  const app = document.getElementById('app');
  let state = load();
  const ui = { editPlan: false, view: 'today', week: null, day: null, flow: null, step: 0, draft: null, checkinLater: false, confirmReset: false, ctx: null, msg: '' };

  /* ---------- storage ---------- */
  function load() {
    try { const s = JSON.parse(localStorage.getItem(KEY)); return s && s.blocks && s.blocks.length ? s : null; }
    catch (e) { return null; }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* storage blocked: keep in memory */ }
  }

  /* ---------- helpers ---------- */
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
  const round1 = (n) => Math.round(n * 10) / 10;
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const isDeload = (w) => DELOAD.includes(w);

  function findEx(id) {
    for (const c of CATS) { const e = c.options.find((o) => o.id === id); if (e) return e; }
    return null;
  }
  function videoUrl(e) {
    return e.video ? e.video : 'https://www.youtube.com/results?search_query=' + encodeURIComponent('how to do ' + e.name + ' proper form');
  }
  function exLink(id) {
    const e = findEx(id);
    if (!e) return '<span class="exlink">Exercise no longer in list</span>';
    return `<a class="exlink" href="${esc(videoUrl(e))}" target="_blank" rel="noopener">${esc(e.name)}<span class="vid" aria-hidden="true">▶</span><span class="sr"> (how-to video)</span></a>`;
  }

  function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function parseISO(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
  function fmtDate(s) { return parseISO(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); }
  function addDays(s, n) { const d = parseISO(s); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
  function weekNow(block) {
    const days = Math.round((parseISO(todayISO()) - parseISO(block.startDate)) / 86400000);
    return Math.max(1, Math.floor(days / 7) + 1);
  }
  const curBlock = () => state.blocks[state.blocks.length - 1];
  const needsCheckin = () => weekNow(curBlock()) > WEEKS;

  /* ---------- macros ---------- */
  const toLb = (w, unit) => (unit === 'kg' ? w * LB_PER_KG : w);
  function macros(p) {
    const cur = num(p.weight), goal = num(p.goalWeight);
    if (!cur) return null;
    const lb = toLb(cur, p.weightUnit);
    const g = goal ? Math.round(toLb(goal, p.weightUnit)) : null;
    const f = p.factor || 12;
    return { low: Math.round(lb * 10), high: Math.round(lb * 12), target: Math.round(lb * f), factor: f, protein: g, mealLow: g ? Math.round(g / 5) : null, mealHigh: g ? Math.round(g / 3) : null };
  }
  function macroHTML(p) {
    const m = macros(p);
    if (!m) return '<p class="muted">Enter your current and goal weight to see your targets.</p>';
    return `<div class="targets">
      <div class="stat"><span class="eyebrow">Calories / day</span><span class="big">${m.target.toLocaleString()}</span><span class="sub">Range ${m.low.toLocaleString()}–${m.high.toLocaleString()} · using ×${m.factor}</span></div>
      <div class="stat"><span class="eyebrow">Protein / day</span><span class="big">${m.protein ?? '–'}<small> g</small></span><span class="sub">${m.protein ? `${m.mealLow}–${m.mealHigh} g per meal over 3–5 meals` : 'Add a goal weight'}</span></div>
    </div>
    <p class="tip">If fat loss stalls for 2+ weeks, eat about 100–150 fewer calories a day and/or add daily steps, then reassess.</p>`;
  }

  /* ---------- drafts & units ---------- */
  // One exercise per movement, used on all 3 days for the whole 12-week block.
  const planOf = (b) => (Array.isArray(b.plan) ? b.plan[0] : b.plan);
  function defaultPlan(prev) {
    if (prev) return clone(Array.isArray(prev) ? prev[0] : prev);
    return Object.fromEntries(CATS.map((c) => [c.key, c.options[0].id]));
  }
  function newDraft() {
    return { name: '', weightUnit: 'lb', heightUnit: 'ftin', lengthUnit: 'in', weight: '', goalWeight: '', heightFt: '', heightIn: '', heightCm: '', meas: {}, factor: 12, startDate: todayISO(), plan: defaultPlan() };
  }
  function profileFrom(d) {
    const { plan, startDate, prev, ...p } = d;
    return clone(p);
  }
  function statsFrom(d) {
    return { date: todayISO(), weight: d.weight, goalWeight: d.goalWeight, weightUnit: d.weightUnit, lengthUnit: d.lengthUnit, meas: clone(d.meas || {}) };
  }
  function setUnit(d, k, v) {
    if (d[k] === v) return;
    if (k === 'weightUnit') {
      const f = v === 'kg' ? 1 / LB_PER_KG : LB_PER_KG;
      ['weight', 'goalWeight'].forEach((x) => { const n = num(d[x]); if (n != null) d[x] = String(round1(n * f)); });
    }
    if (k === 'heightUnit') {
      if (v === 'cm') {
        const ft = num(d.heightFt) || 0, inch = num(d.heightIn) || 0;
        if (ft || inch) d.heightCm = String(Math.round((ft * 12 + inch) * 2.54));
      } else {
        const cm = num(d.heightCm);
        if (cm) { const t = Math.round(cm / 2.54); d.heightFt = String(Math.floor(t / 12)); d.heightIn = String(t % 12); }
      }
    }
    if (k === 'lengthUnit') {
      const f = v === 'cm' ? 2.54 : 1 / 2.54;
      for (const m in d.meas) { const n = num(d.meas[m]); if (n != null) d.meas[m] = String(round1(n * f)); }
    }
    d[k] = v;
  }
  function heightText(p) {
    if (p.heightUnit === 'cm') return p.heightCm ? `${p.heightCm} cm` : '–';
    return p.heightFt ? `${p.heightFt}′ ${p.heightIn || 0}″` : '–';
  }

  /* ---------- logs ---------- */
  const logKey = (n, w, d) => `${n}-${w}-${d}`;
  const getLog = (n, w, d) => state.logs[logKey(n, w, d)] || null;
  function ensureLog(n, w, d) {
    const k = logKey(n, w, d);
    if (!state.logs[k]) state.logs[k] = { warmup: false, dynamic: false, cardio: false, cardioMin: '', sets: {}, ex: {}, notes: '', done: false };
    return state.logs[k];
  }
  function blankSets() { return Array.from({ length: DEFAULT_SETS }, () => ({ w: '', r: '' })); }
  function prevSets(n, w, d, cat, exId) {
    for (let ww = w - 1; ww >= 1; ww--) {
      if (isDeload(ww)) continue;
      const l = getLog(n, ww, d);
      const s = l && l.ex[cat] === exId && l.sets[cat];
      if (s && s.some((x) => x.w || x.r)) return { week: ww, sets: s };
    }
    return null;
  }
  function firstOpenDay(n, w) {
    for (let d = 1; d <= 3; d++) { const l = getLog(n, w, d); if (!l || !l.done) return d; }
    return 1;
  }
  const daysDone = (n, w) => [1, 2, 3].filter((d) => getLog(n, w, d)?.done).length;

  /* ---------- flows ---------- */
  function startFlow(flow) {
    ui.flow = flow; ui.step = 0;
    if (flow === 'onboard') ui.draft = newDraft();
    if (flow === 'edit') ui.draft = clone(state.profile);
    if (flow === 'checkin') {
      const p = clone(state.profile);
      ui.draft = { ...p, prev: { weight: p.weight, meas: clone(p.meas || {}) }, weight: '', meas: {}, startDate: todayISO(), plan: defaultPlan(curBlock().plan) };
    }
    window.scrollTo(0, 0);
  }
  function validate(step, d) {
    if (step === 'units' && !String(d.name || '').trim()) return 'Add your name to continue.';
    if (step === 'body') {
      if (!(num(d.weight) > 0)) return 'Enter your current weight.';
      if (!(num(d.goalWeight) > 0)) return 'Enter your goal weight.';
      if (ui.flow !== 'checkin') {
        const ok = d.heightUnit === 'cm' ? num(d.heightCm) > 0 : num(d.heightFt) > 0;
        if (!ok) return 'Enter your height.';
      }
    }
    if (step === 'plan' && !d.startDate) return 'Pick a start date.';
    return '';
  }
  function finishFlow() {
    const d = ui.draft;
    if (ui.flow === 'onboard') {
      state = { version: 1, created: todayISO(), profile: profileFrom(d), blocks: [{ n: 1, startDate: d.startDate, plan: clone(d.plan), startStats: statsFrom(d) }], logs: {} };
    } else if (ui.flow === 'edit') {
      state.profile = profileFrom(d);
    } else if (ui.flow === 'checkin') {
      const b = curBlock();
      b.endDate = todayISO();
      state.profile = profileFrom(d);
      state.blocks.push({ n: b.n + 1, startDate: d.startDate, plan: clone(d.plan), startStats: statsFrom(d) });
      ui.checkinLater = false;
    }
    save();
    ui.flow = null; ui.draft = null; ui.week = null; ui.day = null; ui.view = 'today';
    window.scrollTo(0, 0);
  }

  const seg = (k, val, opts) => `<div class="seg" role="group">${opts.map(([v, l]) => `<button type="button" data-act="unit" data-k="${k}" data-v="${v}" aria-pressed="${val === v}">${l}</button>`).join('')}</div>`;
  const unitInput = (id, attr, value, unit, label, ph = '') => `<label class="field" for="${id}">${label}<span class="unitin"><input type="text" inputmode="decimal" id="${id}" ${attr} value="${esc(value)}" placeholder="${esc(ph)}" autocomplete="off"><span>${unit}</span></span></label>`;

  const STEPS = {
    units(d) {
      return `${ui.flow === 'onboard' ? `<h1>Your 12-week plan starts here</h1><p class="lede">A few details to set your calorie and protein targets. Everything you enter stays on this phone.</p>` : '<h1>Edit profile</h1>'}
        <label class="field" for="f-name">Your name<input type="text" id="f-name" data-draft="name" value="${esc(d.name)}" autocomplete="given-name"></label>
        <div class="card">
          <div class="segrow"><span>Body weight</span>${seg('weightUnit', d.weightUnit, [['lb', 'lb'], ['kg', 'kg']])}</div>
          <div class="segrow"><span>Height</span>${seg('heightUnit', d.heightUnit, [['ftin', 'ft / in'], ['cm', 'cm']])}</div>
          <div class="segrow"><span>Measurements</span>${seg('lengthUnit', d.lengthUnit, [['in', 'in'], ['cm', 'cm']])}</div>
        </div>`;
    },
    body(d) {
      const ci = ui.flow === 'checkin';
      const prev = d.prev || {};
      const wu = d.weightUnit, lu = d.lengthUnit;
      return `${ci ? `<h1>You finished ${WEEKS} weeks</h1><p class="lede">Update your weight and measurements. Your targets will be recalculated, then you'll pick exercises for the next 12 weeks.</p>` : '<h1>Your body today</h1><p class="lede">Current weight sets calories. Goal weight sets protein.</p>'}
        <div class="grid2">
          ${unitInput('f-weight', 'data-draft="weight"', d.weight, wu, 'Current weight', ci && prev.weight ? `Last: ${prev.weight}` : '')}
          ${unitInput('f-goal', 'data-draft="goalWeight"', d.goalWeight, wu, 'Goal weight')}
        </div>
        ${ci ? '' : `<div>${d.heightUnit === 'cm'
          ? unitInput('f-hcm', 'data-draft="heightCm"', d.heightCm, 'cm', 'Height')
          : `<div class="grid2">${unitInput('f-hft', 'data-draft="heightFt"', d.heightFt, 'ft', 'Height')}${unitInput('f-hin', 'data-draft="heightIn"', d.heightIn, 'in', '&nbsp;')}</div>`}</div>`}
        <div class="card">
          <h3>Measurements <small class="muted">(optional)</small></h3>
          <div class="grid2">${MEAS.map(([k, l]) => unitInput('f-m-' + k, `data-meas="${k}"`, (d.meas || {})[k] || '', lu, l, ci && prev.meas?.[k] ? `Last: ${prev.meas[k]}` : '')).join('')}</div>
        </div>`;
    },
    targets(d) {
      const opt = (f, t, s) => `<label class="radio"><input type="radio" name="factor" value="${f}" data-draft-radio="factor"${d.factor === f ? ' checked' : ''}><span><b>${t} (×${f})</b><small>${s}</small></span></label>`;
      return `<h1>Your daily targets</h1>
        <p class="lede">Calories are your bodyweight in lb × 10–12. Protein is 1 g per lb of your goal weight.</p>
        <div style="display:grid;gap:8px">
          ${opt(12, 'Newer to dieting', 'Less active day to day, or more to lose')}
          ${opt(11, 'Somewhere in between', 'Middle of the range')}
          ${opt(10, 'Already fairly lean', 'Very active, or have been dieting a while')}
        </div>
        <div class="card" id="macro-preview">${macroHTML(d)}</div>`;
    },
    plan(d) {
      return `<h1>${ui.flow === 'checkin' ? 'Pick your next 12 weeks' : 'Build your 3-day plan'}</h1>
        <p class="lede">Pick one exercise for each movement. You'll do these same exercises on all 3 days, every week, for the next 12 weeks. At week 13 you'll pick new ones. Tap a link to watch a how-to video.</p>
        <label class="field" for="f-start">Week 1 starts<input type="date" id="f-start" data-draft="startDate" value="${esc(d.startDate)}"></label>
        ${planBuilder(d.plan, 'draft')}`;
    },
  };

  function renderFlow() {
    const f = FLOWS[ui.flow];
    const step = f.steps[ui.step];
    const last = ui.step === f.steps.length - 1;
    const left = ui.step > 0
      ? '<button class="btn ghost" data-act="back">Back</button>'
      : ui.flow === 'edit' ? '<button class="btn ghost" data-act="flow-cancel">Cancel</button>'
      : ui.flow === 'checkin' ? '<button class="btn ghost" data-act="checkin-later">Later</button>' : '<span></span>';
    return `<div class="flow">
      <header class="flowhead"><p class="eyebrow">${esc(f.title)} · Step ${ui.step + 1} of ${f.steps.length}</p><div class="progress"><span style="width:${((ui.step + 1) / f.steps.length) * 100}%"></span></div></header>
      <div class="flowbody">${STEPS[step](ui.draft)}</div>
      <p class="err" id="flow-err" role="alert">${esc(ui.msg)}</p>
      <footer class="flowfoot">${left}<button class="btn primary" data-act="${last ? 'finish' : 'next'}">${last ? f.finish : 'Next'}</button></footer>
    </div>`;
  }

  /* ---------- plan builder ---------- */
  function planBuilder(plan, src) {
    return `<section class="card">
      <div class="prow"><span class="cat">Warm up</span><span class="warmline">Cardio 5–10 min, then 1–2 light warm-up sets per body part</span></div>
      ${CATS.map((c) => {
        const e = findEx(plan[c.key]);
        return `<div class="prow"><label class="cat" for="p-${src}-${c.key}">${esc(c.label)}</label><div class="pick">
          <select id="p-${src}-${c.key}" data-plan data-cat="${c.key}" data-src="${src}">
            ${e ? '' : '<option value="" selected>Choose…</option>'}
            ${c.options.map((o) => `<option value="${esc(o.id)}"${o.id === plan[c.key] ? ' selected' : ''}>${esc(o.name)}${o.detail ? ' (' + esc(o.detail) + ')' : ''}</option>`).join('')}
          </select>
          ${e ? `<a href="${esc(videoUrl(e))}" target="_blank" rel="noopener">▶ How to do ${esc(e.name)}</a>` : ''}
        </div></div>`;
      }).join('')}
    </section>`;
  }

  function planSummary(plan) {
    return `<section class="card">
      <div class="prow"><span class="cat">Warm up</span><span class="warmline">Cardio 5–10 min, then 1–2 light warm-up sets per body part</span></div>
      ${CATS.map((c) => { const e = findEx(plan[c.key]); return `<div class="prow"><span class="cat">${esc(c.label)}</span><div class="pick">${exLink(plan[c.key])}${e?.detail ? `<span class="detail">${esc(e.detail)}</span>` : ''}</div></div>`; }).join('')}
    </section>`;
  }

  /* ---------- shell views ---------- */
  const ICONS = {
    today: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6.5 6.5v11M17.5 6.5v11M3 9v6M21 9v6M6.5 12h11"/></svg>',
    plan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 9h8M8 13h8M8 17h5"/></svg>',
    me: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 19V5M4 19h16M8 15l3-4 3 2 5-6"/></svg>',
  };
  function renderShell() {
    const b = curBlock();
    const w = Math.min(weekNow(b), WEEKS);
    const views = { today: viewToday, plan: viewPlan, me: viewMe };
    return `<header class="topbar"><span class="brand">Lift<b>Block</b></span><span class="where num">Block ${b.n} · Week ${needsCheckin() ? WEEKS + 1 : w}${isDeload(w) && !needsCheckin() ? ' · Deload' : ''}</span></header>
      <main class="page">${views[ui.view]()}</main>
      <nav class="tabs" aria-label="Main"><div class="tabs-in">
        ${[['today', 'Workout'], ['plan', 'Plan'], ['me', 'Progress']].map(([v, l]) => `<button data-act="nav" data-view="${v}"${ui.view === v ? ' aria-current="page"' : ''}>${ICONS[v]}${l}</button>`).join('')}
      </div></nav>`;
  }

  function checkinBanner() {
    return `<div class="banner info"><strong>Week ${WEEKS + 1}: time for your check-in</strong><p>You've finished 12 weeks. Update your weight and measurements, then pick your exercises for the next block.</p><div><button class="btn primary sm" data-act="checkin-start">Start check-in</button></div></div>`;
  }

  function viewToday() {
    const b = curBlock();
    const now = Math.min(weekNow(b), WEEKS);
    const w = ui.week ?? now;
    const d = ui.day ?? firstOpenDay(b.n, w);
    ui.ctx = { n: b.n, w, d };
    const plan = planOf(b);
    const log = getLog(b.n, w, d);
    const unit = state.profile.weightUnit;
    const deload = isDeload(w);
    const cardio = CATS.find((c) => c.type === 'cardio');
    const cardioEx = cardio && findEx(plan[cardio.key]);

    const weekBtns = Array.from({ length: WEEKS }, (_, i) => i + 1).map((n) =>
      `<button data-act="week" data-w="${n}" aria-pressed="${n === w}" class="${isDeload(n) ? 'deload ' : ''}${n === now ? 'now ' : ''}${daysDone(b.n, n) === 3 ? 'full' : ''}" aria-label="Week ${n}${isDeload(n) ? ', deload' : ''}">${n}<small>${isDeload(n) ? 'Deload' : n === now ? 'Now' : ''}</small></button>`).join('');

    let banner = '';
    if (needsCheckin()) banner += checkinBanner();
    if (deload) banner += `<div class="banner deload"><strong>Deload week: lower your weights</strong><p>Use about 60% of the weight you lifted last week on every exercise. The grey numbers in each set are a suggested deload weight. Same exercises, same reps, clean form. This lets your body recover so you come back stronger next week.</p></div>`;
    else if (isDeload(w + 1)) banner += `<div class="banner deload"><strong>Heads up: week ${w + 1} is a deload week</strong><p>Push this week. Next week you'll lower your weights to recover.</p></div>`;

    const chk = (k, t, s) => `<label class="check"><input type="checkbox" data-check="${k}"${log?.[k] ? ' checked' : ''}><span>${t}<small>${s}</small></span></label>`;

    const exCards = CATS.filter((c) => c.type !== 'cardio').map((c) => {
      const exId = log?.ex?.[c.key] || plan[c.key];
      const sets = log?.sets?.[c.key] || blankSets();
      const prev = prevSets(b.n, w, d, c.key, exId);
      const e = findEx(exId);
      const ph = (i) => { const pw = num(prev?.sets[i]?.w); return deload && pw ? String(Math.round(pw * 0.6)) : (prev?.sets[i]?.w || ''); };
      return `<section class="card${deload ? ' deloadcard' : ''}">
        <div class="exhead"><span class="cat">${esc(c.label)}</span>${exLink(exId)}${e?.detail ? `<span class="detail">${esc(e.detail)}</span>` : ''}</div>
        <div class="sets">
          <div class="sethead"><span>Set</span><span>Weight (${unit})</span><span>Reps</span></div>
          ${sets.map((s, i) => `<div class="set"><span class="setn">${i + 1}</span>
            <input type="text" inputmode="decimal" data-set="${c.key}" data-i="${i}" data-f="w" value="${esc(s.w)}" placeholder="${esc(ph(i))}" aria-label="${esc(c.label)} set ${i + 1} weight" autocomplete="off">
            <input type="text" inputmode="numeric" data-set="${c.key}" data-i="${i}" data-f="r" value="${esc(s.r)}" placeholder="${esc(prev?.sets[i]?.r || '')}" aria-label="${esc(c.label)} set ${i + 1} reps" autocomplete="off"></div>`).join('')}
        </div>
        <div class="btnrow"><button class="btn sm ghost" data-act="add-set" data-cat="${c.key}">+ Add set</button>${sets.length > 1 ? `<button class="btn sm ghost" data-act="rm-set" data-cat="${c.key}">Remove last set</button>` : ''}</div>
        ${prev ? `<p class="hint num">Week ${prev.week}: ${prev.sets.map((s) => `${s.w || '–'} × ${s.r || '–'}`).join(' · ')}${deload ? ` · Deload target about ${prev.sets.map((s) => num(s.w) ? Math.round(num(s.w) * 0.6) : '–').join(' / ')} ${unit}` : ''}</p>` : (deload ? `<p class="hint">Deload: use about 60% of your usual weight.</p>` : '')}
      </section>`;
    }).join('');

    return `${banner}
      <section class="card"><div class="segrow"><h2>Week ${w}${w === now ? '' : ` <small class="muted">(this week is ${now})</small>`}</h2><span class="muted num">${fmtDate(addDays(b.startDate, (w - 1) * 7))}</span></div><div class="weeks">${weekBtns}</div></section>
      <div class="days" role="group" aria-label="Day">${[1, 2, 3].map((n) => `<button data-act="day" data-d="${n}" aria-pressed="${n === d}">Day ${n}${getLog(b.n, w, n)?.done ? ' <span class="ok">✓</span>' : ''}</button>`).join('')}</div>
      <section class="card"><h3>Warm up</h3>
        ${chk('warmup', 'Cardio warm-up', '5–10 minutes, easy pace')}
        ${chk('dynamic', 'Dynamic warm-up', '1–2 light warm-up sets per body part')}
      </section>
      ${exCards}
      <section class="card"><div class="exhead"><span class="cat">Cardio</span>${cardioEx ? exLink(cardioEx.id) : ''}${cardioEx?.detail ? `<span class="detail">${esc(cardioEx.detail)}</span>` : ''}</div>
        <div class="grid2" style="align-items:end">
          ${chk('cardio', 'Done', 'Finish with cardio')}
          ${unitInput('f-cmin', 'data-field="cardioMin"', log?.cardioMin || '', 'min', 'Minutes')}
        </div>
      </section>
      <section class="card"><label class="field" for="f-notes">Notes<small>How did it feel? Anything you noticed?</small><textarea id="f-notes" data-field="notes" placeholder="e.g. Left knee felt better. Go up 5 lb on squats next week.">${esc(log?.notes || '')}</textarea></label></section>
      <button class="btn block ${log?.done ? 'done' : 'primary'}" data-act="toggle-done">${log?.done ? `✓ Day ${d} complete` : `Mark Day ${d} complete`}</button>`;
  }

  function viewPlan() {
    const b = curBlock();
    const endW = addDays(b.startDate, WEEKS * 7);
    return `<section class="card"><h1>Block ${b.n} plan</h1>
        <p class="muted">Three full-body days a week with the same exercises, from ${fmtDate(b.startDate)} to ${fmtDate(addDays(endW, -1))}. Deload weeks are ${DELOAD.join(' and ')}. In week ${WEEKS + 1} you'll update your measurements and pick new exercises.</p>
      </section>
      ${ui.editPlan ? planBuilder(planOf(b), 'block') : planSummary(planOf(b))}
      ${ui.editPlan
        ? `<section class="card"><label class="field" for="f-bstart">Week 1 started<input type="date" id="f-bstart" data-blockdate value="${esc(b.startDate)}"></label>
           <p class="muted" style="font-size:.85rem">Only change exercises to fix a mistake. Workouts you already logged keep the exercise you did.</p>
           <div><button class="btn primary" data-act="plan-done">Done</button></div></section>`
        : '<div><button class="btn ghost sm" data-act="plan-edit">Fix a mistake in this plan</button></div>'}`;
  }

  function viewMe() {
    const p = state.profile;
    const b = curBlock();
    const lu = p.lengthUnit, wu = p.weightUnit;
    const grid = Array.from({ length: WEEKS }, (_, i) => i + 1).map((w) => {
      const n = daysDone(b.n, w);
      return `<div class="wcell${isDeload(w) ? ' deload' : ''}"><span>W${w}${isDeload(w) ? ' D' : ''}</span><span class="dots">${[0, 1, 2].map((i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</span></div>`;
    }).join('');
    const rows = state.blocks.map((bl) => {
      const s = bl.startStats || {};
      return `<tr><td>Block ${bl.n}</td><td>${s.date ? fmtDate(s.date) : '–'}</td><td>${esc(s.weight || '–')} ${esc(s.weightUnit || '')}</td>${MEAS.map(([k]) => `<td>${esc(s.meas?.[k] || '–')}</td>`).join('')}</tr>`;
    }).join('');
    const standalone = window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone;
    return `<section class="card"><h1>Hi, ${esc(p.name)}</h1><p class="muted">Block ${b.n} started ${fmtDate(b.startDate)}.</p></section>
      ${needsCheckin() ? checkinBanner() : ''}
      <section class="card"><h2>Daily targets</h2>${macroHTML(p)}</section>
      <section class="card"><h2>This block</h2><div class="wgrid">${grid}</div><p class="muted" style="font-size:.82rem">Green dots are completed days. D marks a deload week.</p></section>
      <section class="card"><h2>Check-ins</h2>
        <div class="tablewrap"><table><thead><tr><th>Block</th><th>Date</th><th>Weight</th>${MEAS.map(([, l]) => `<th>${l} (${lu})</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>
        <dl class="kv"><dt>Height</dt><dd>${heightText(p)}</dd><dt>Goal weight</dt><dd>${esc(p.goalWeight)} ${wu}</dd></dl>
      </section>
      ${standalone ? '' : `<section class="card flat"><h3>Add to your home screen</h3><p class="muted" style="font-size:.88rem">iPhone (Safari): tap Share, then Add to Home Screen. Android (Chrome): tap the ⋮ menu, then Install app or Add to Home screen.</p></section>`}
      <section class="card"><h2>Settings</h2>
        <div class="btnrow"><button class="btn" data-act="edit-profile">Edit profile &amp; units</button><button class="btn" data-act="checkin-start">${needsCheckin() ? 'Start week 13 check-in' : 'Finish block early'}</button></div>
        <h3>Backup</h3>
        <p class="muted" style="font-size:.88rem">Your data is saved only in this browser on this device. Export a backup file now and then, or to move to a new phone.</p>
        <div class="btnrow"><button class="btn" data-act="export">Export backup</button><label class="btn filebtn">Import backup<input type="file" accept="application/json,.json" data-import></label></div>
        ${ui.msg ? `<p class="hint" role="status">${esc(ui.msg)}</p>` : ''}
        <h3>Start over</h3>
        ${ui.confirmReset
          ? `<p>This deletes your profile, plan and every logged workout on this device.</p><div class="btnrow"><button class="btn danger" data-act="reset-yes">Delete everything</button><button class="btn ghost" data-act="reset-no">Keep my data</button></div>`
          : '<div><button class="btn danger" data-act="reset-ask">Reset app</button></div>'}
      </section>`;
  }

  /* ---------- render ---------- */
  function render() {
    if (!state && ui.flow !== 'onboard') startFlow('onboard');
    else if (state && !ui.flow && needsCheckin() && !ui.checkinLater) startFlow('checkin');
    app.innerHTML = ui.flow ? renderFlow() : renderShell();
  }

  /* ---------- events ---------- */
  function updatePreview() {
    const el = document.getElementById('macro-preview');
    if (el && ui.draft) el.innerHTML = macroHTML(ui.draft);
  }

  app.addEventListener('click', (e) => {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const act = t.dataset.act;
    const top = () => window.scrollTo(0, 0);
    ui.msg = '';
    switch (act) {
      case 'nav': ui.view = t.dataset.view; ui.confirmReset = false; ui.editPlan = false; top(); break;
      case 'week': ui.week = +t.dataset.w; ui.day = null; break;
      case 'day': ui.day = +t.dataset.d; break;
      case 'unit': setUnit(ui.draft, t.dataset.k, t.dataset.v); break;
      case 'next': {
        const err = validate(FLOWS[ui.flow].steps[ui.step], ui.draft);
        if (err) { ui.msg = err; break; }
        ui.step++; top(); break;
      }
      case 'back': ui.step--; top(); break;
      case 'finish': {
        const f = FLOWS[ui.flow];
        for (const s of f.steps) { const err = validate(s, ui.draft); if (err) { ui.msg = err; render(); return; } }
        finishFlow(); break;
      }
      case 'flow-cancel': ui.flow = null; ui.draft = null; top(); break;
      case 'checkin-later': ui.flow = null; ui.draft = null; ui.checkinLater = true; top(); break;
      case 'checkin-start': startFlow('checkin'); break;
      case 'edit-profile': startFlow('edit'); break;
      case 'plan-edit': ui.editPlan = true; break;
      case 'plan-done': ui.editPlan = false; break;
      case 'add-set':
      case 'rm-set': {
        const { n, w, d } = ui.ctx; const c = t.dataset.cat;
        const log = ensureLog(n, w, d);
        if (!log.sets[c]) log.sets[c] = blankSets();
        log.ex[c] = log.ex[c] || planOf(curBlock())[c];
        if (act === 'add-set') log.sets[c].push({ w: '', r: '' }); else if (log.sets[c].length > 1) log.sets[c].pop();
        save(); break;
      }
      case 'toggle-done': {
        const { n, w, d } = ui.ctx; const log = ensureLog(n, w, d);
        log.done = !log.done; ui.day = d;
        snapshotEx(log, d);
        save(); break;
      }
      case 'export': exportData(); break;
      case 'reset-ask': ui.confirmReset = true; break;
      case 'reset-no': ui.confirmReset = false; break;
      case 'reset-yes':
        try { localStorage.removeItem(KEY); } catch (err) { /* ignore */ }
        state = null; ui.confirmReset = false; ui.view = 'today'; ui.week = null; ui.day = null; ui.checkinLater = false; top(); break;
      default: return;
    }
    render();
  });

  function snapshotEx(log, d) {
    const plan = planOf(curBlock());
    for (const c of CATS) if (!log.ex[c.key]) log.ex[c.key] = plan[c.key];
  }

  app.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.draft && ui.draft) { ui.draft[t.dataset.draft] = t.value; updatePreview(); return; }
    if (t.dataset.meas && ui.draft) { ui.draft.meas = ui.draft.meas || {}; ui.draft.meas[t.dataset.meas] = t.value; return; }
    if (!ui.ctx) return;
    const { n, w, d } = ui.ctx;
    if (t.dataset.set) {
      const c = t.dataset.set; const log = ensureLog(n, w, d);
      if (!log.sets[c]) log.sets[c] = blankSets();
      log.ex[c] = log.ex[c] || planOf(curBlock())[c];
      log.sets[c][+t.dataset.i][t.dataset.f] = t.value.trim();
      save(); return;
    }
    if (t.dataset.field) { const log = ensureLog(n, w, d); log[t.dataset.field] = t.value; save(); }
  });

  app.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.draftRadio && ui.draft) { ui.draft[t.dataset.draftRadio] = +t.value; updatePreview(); return; }
    if (t.hasAttribute('data-plan')) {
      if (t.dataset.src === 'draft') ui.draft.plan[t.dataset.cat] = t.value;
      else { const b = curBlock(); b.plan = planOf(b); b.plan[t.dataset.cat] = t.value; }
      if (t.dataset.src === 'block') save();
      render(); return;
    }
    if (t.dataset.check && ui.ctx) {
      const { n, w, d } = ui.ctx; const log = ensureLog(n, w, d);
      log[t.dataset.check] = t.checked;
      if (t.dataset.check === 'cardio') log.ex.cardio = log.ex.cardio || planOf(curBlock()).cardio;
      save(); return;
    }
    if (t.hasAttribute('data-blockdate') && t.value) { curBlock().startDate = t.value; ui.week = null; ui.checkinLater = false; save(); render(); return; }
    if (t.hasAttribute('data-import') && t.files[0]) importData(t.files[0]);
  });

  function exportData() {
    try {
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `liftblock-backup-${todayISO()}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      ui.msg = 'Backup file saved to your downloads.';
    } catch (err) { ui.msg = 'Could not save a file here. Try again from the installed app.'; }
  }
  function importData(file) {
    const r = new FileReader();
    r.onload = () => {
      try {
        const s = JSON.parse(r.result);
        if (!s || !s.profile || !Array.isArray(s.blocks) || !s.blocks.length) throw new Error('bad');
        s.logs = s.logs || {};
        state = s; save(); ui.msg = 'Backup restored.'; ui.week = null; ui.day = null;
      } catch (err) { ui.msg = 'That file is not a Lift Block backup.'; }
      render();
    };
    r.readAsText(file);
  }

  render();
})();
