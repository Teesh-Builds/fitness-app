/* Lift Block: all data lives in this browser's localStorage. No server. */
(() => {
  'use strict';

  const KEY = 'liftblock.v1';
  const DATA_VERSION = 2;
  const LIB = window.EXERCISE_LIBRARY;
  const CATS = LIB.categories;
  const WEEKS = LIB.blockWeeks || 12;
  const DELOAD = LIB.deloadWeeks || [6, 12];
  const DEFAULT_SETS = LIB.defaultSets || 3;
  const STRETCHES = LIB.dynamicStretches || [];
  const LB_PER_KG = 2.20462;
  const MEAS = [['waist', 'Waist'], ['hips', 'Hips'], ['chest', 'Chest'], ['arm', 'Upper arm'], ['thigh', 'Thigh']];
  const FLOWS = {
    onboard: { title: 'Set up', steps: ['units', 'body', 'targets', 'plan'], finish: 'Start my plan' },
    edit: { title: 'Edit profile', steps: ['units', 'body', 'targets'], finish: 'Save' },
    checkin: { title: 'Finish block & check in', steps: ['body', 'targets', 'plan'], finish: 'Start next 12 weeks' },
  };

  const app = document.getElementById('app');
  let state = load();
  const ui = { editPlan: false, view: 'today', week: null, day: null, flow: null, step: 0, draft: null, checkinLater: false, confirmReset: false, ctx: null, msg: '' };

  /* ---------- storage ---------- */
  function load() {
    try { const s = JSON.parse(localStorage.getItem(KEY)); return s && s.blocks && s.blocks.length ? migrate(s) : null; }
    catch (e) { return null; }
  }
  // Upgrade saved data from older app versions in place, so nobody has to reset.
  function migrate(s) {
    const from = s.version || 1;
    s.logs = s.logs || {};
    s.blocks.forEach((b) => { if (Array.isArray(b.plan)) b.plan = b.plan[0]; });
    if (from < 2) {
      // Single Leg sets gained separate left/right reps.
      for (const l of Object.values(s.logs)) {
        const arr = l.sets && l.sets.single;
        if (arr) arr.forEach((x) => { if (x.r && !x.rl && !x.rr) { x.rl = x.r; x.rr = x.r; } });
      }
    }
    s.version = DATA_VERSION;
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* ignore */ }
    return s;
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
  // Daily activity levels. Calories = Mifflin-St Jeor BMR × activity multiplier, then adjusted for the goal.
  const ACTIVITY = {
    light: { label: 'Lightly Active', mult: 1.25, desc: 'Mostly sitting, little exercise.', ex: 'Desk job, limited walking.', steps: 'Under 5,000 steps' },
    moderate: { label: 'Moderately Active', mult: 1.5, desc: 'Regular movement with some workouts.', ex: 'Frequent walking, 3–4 workouts a week.', steps: '5,000–10,000 steps' },
    very: { label: 'Very Active', mult: 1.75, desc: 'Lots of movement or intense training.', ex: 'Intense workouts, physical job, lots of walking.', steps: '10,000+ steps' },
  };
  const GOALS = {
    lose: { label: 'Lose fat', sub: 'About 20% under maintenance (max 500 a day)' },
    maintain: { label: 'Maintain', sub: 'Eat at maintenance' },
    gain: { label: 'Build muscle', sub: '250 over maintenance' },
  };
  function heightCmOf(p) {
    if (p.heightUnit === 'cm') return num(p.heightCm);
    const ft = num(p.heightFt); if (!ft) return null;
    return (ft * 12 + (num(p.heightIn) || 0)) * 2.54;
  }
  const activityFor = (iso) => (state && state.daily && state.daily[iso] && state.daily[iso].activity) || (state && state.profile.activity) || 'moderate';
  function macros(p, actKey) {
    const cur = num(p.weight), goal = num(p.goalWeight), age = num(p.age), cm = heightCmOf(p);
    const g = goal ? Math.round(toLb(goal, p.weightUnit)) : null;
    const protein = { protein: g, mealLow: g ? Math.round(g / 5) : null, mealHigh: g ? Math.round(g / 3) : null };
    if (!cur || !age || !cm || !p.sex) return { missing: true, ...protein };
    const kg = p.weightUnit === 'kg' ? cur : cur / LB_PER_KG;
    const bmr = 10 * kg + 6.25 * cm - 5 * age + (p.sex === 'male' ? 5 : -161);
    const a = ACTIVITY[actKey || p.activity || 'moderate'];
    const tdee = bmr * a.mult;
    const goalKey = p.goal || 'lose';
    const floor = p.sex === 'male' ? 1500 : 1200;
    let target = tdee;
    if (goalKey === 'lose') target = Math.max(floor, tdee - Math.min(500, tdee * 0.2));
    if (goalKey === 'gain') target = tdee + 250;
    const r10 = (n) => Math.round(n / 10) * 10;
    return { target: r10(target), tdee: r10(tdee), bmr: Math.round(bmr), act: a, goalKey, ...protein };
  }
  function macroHTML(p, actKey, label = 'Calories / day') {
    const m = macros(p, actKey);
    const cal = m.missing
      ? `<div class="stat"><span class="eyebrow">${label}</span><span class="sub">Add your age, sex, height and weight to see calories.</span></div>`
      : `<div class="stat"><span class="eyebrow">${label}</span><span class="big">${m.target.toLocaleString()}</span><span class="sub">${m.act.label} · ${GOALS[m.goalKey].label}<br>Maintenance ${m.tdee.toLocaleString()}</span></div>`;
    return `<div class="targets">${cal}
      <div class="stat"><span class="eyebrow">Protein / day</span><span class="big">${m.protein ?? '–'}<small> g</small></span><span class="sub">${m.protein ? `${m.mealLow}–${m.mealHigh} g per meal over 3–5 meals` : 'Add a goal weight'}</span></div>
    </div>
    ${(p.goal || 'lose') === 'lose' ? '<p class="tip">If fat loss stalls for 2+ weeks, eat about 100–150 fewer calories a day and/or add daily steps, then reassess.</p>' : ''}`;
  }
  function activityPicker(iso, compact) {
    const cur = activityFor(iso);
    return `<div class="actpick" role="group" aria-label="Activity level">${Object.entries(ACTIVITY).map(([k, a]) => `<button data-act="day-activity" data-date="${iso}" data-v="${k}" aria-pressed="${k === cur}"><b>${a.label.replace(' Active', '')}</b><small>${a.steps}</small></button>`).join('')}</div>`;
  }
  function dayTargets(iso, title) {
    const m = macros(state.profile, activityFor(iso));
    return `<section class="card"><div class="segrow"><h3>${title}</h3>${m.missing ? '' : `<span class="dcal num"><b>${m.target.toLocaleString()}</b> cal · <b>${m.protein ?? '–'}</b> g protein</span>`}</div>
      ${activityPicker(iso)}
      ${m.missing ? `<p class="hint">Add your age and sex to see your calorie target. <button class="btn sm ghost" data-act="edit-profile">Add now</button></p>` : `<p class="hint">Pick how active you are today. Calories update automatically.</p>`}</section>`;
  }

  /* ---------- drafts & units ---------- */
  // One exercise per movement, used on all 3 days for the whole 12-week block.
  const planOf = (b) => (Array.isArray(b.plan) ? b.plan[0] : b.plan);
  function defaultPlan(prev) {
    if (prev) return clone(Array.isArray(prev) ? prev[0] : prev);
    return Object.fromEntries(CATS.map((c) => [c.key, c.options[0].id]));
  }
  function newDraft() {
    return { name: '', weightUnit: 'lb', heightUnit: 'ftin', lengthUnit: 'in', weight: '', goalWeight: '', heightFt: '', heightIn: '', heightCm: '', meas: {}, age: '', sex: '', activity: 'moderate', goal: 'lose', startDate: todayISO(), plan: defaultPlan() };
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
  // Best set from the most recent earlier week (skipping deload weeks) for this exercise, across all 3 days:
  // highest weight, then highest reps at that weight.
  const LR = (cat) => cat === 'single';
  function lastBest(n, w, cat, exId) {
    for (let ww = w - 1; ww >= 1; ww--) {
      if (isDeload(ww)) continue;
      let best = null;
      for (let d = 1; d <= 3; d++) {
        const l = getLog(n, ww, d);
        if (!l || !l.sets || !l.sets[cat] || (l.ex[cat] || planOf(curBlock())[cat]) !== exId) continue;
        for (const x of l.sets[cat]) {
          const wt = num(x.w) ?? 0;
          const reps = LR(cat) ? Math.max(num(x.rl) ?? 0, num(x.rr) ?? 0) : (num(x.r) ?? 0);
          if (!wt && !reps) continue;
          const cand = { week: ww, w: wt, r: reps, rl: num(x.rl) ?? 0, rr: num(x.rr) ?? 0 };
          if (!best || cand.w > best.w || (cand.w === best.w && cand.r > best.r)) best = cand;
          else if (LR(cat) && cand.w === best.w) { best.rl = Math.max(best.rl, cand.rl); best.rr = Math.max(best.rr, cand.rr); }
        }
      }
      if (best) return best;
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
      if (!(num(d.age) > 0)) return 'Enter your age.';
      if (!d.sex) return 'Choose female or male for the calorie formula.';
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
      state = { version: DATA_VERSION, created: todayISO(), profile: profileFrom(d), blocks: [{ n: 1, startDate: d.startDate, plan: clone(d.plan), startStats: statsFrom(d) }], logs: {} };
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
      return `${ci ? `<h1>You finished ${WEEKS} weeks</h1><p class="lede">Update your weight and measurements. Your targets will be recalculated, then you'll pick exercises for the next 12 weeks.</p>` : '<h1>Your body today</h1><p class="lede">These set your calorie and protein targets.</p>'}
        <div class="grid2">
          ${unitInput('f-weight', 'data-draft="weight"', d.weight, wu, 'Current weight', ci && prev.weight ? `Last: ${prev.weight}` : '')}
          ${unitInput('f-goal', 'data-draft="goalWeight"', d.goalWeight, wu, 'Goal weight')}
        </div>
        <div class="grid2">${unitInput('f-age', 'data-draft="age"', d.age || '', 'yrs', 'Age')}<div class="field">Sex<small>Used in the calorie formula</small>${seg('sex', d.sex, [['female', 'Female'], ['male', 'Male']])}</div></div>
        ${ci ? '' : `<div>${d.heightUnit === 'cm'
          ? unitInput('f-hcm', 'data-draft="heightCm"', d.heightCm, 'cm', 'Height')
          : `<div class="grid2">${unitInput('f-hft', 'data-draft="heightFt"', d.heightFt, 'ft', 'Height')}${unitInput('f-hin', 'data-draft="heightIn"', d.heightIn, 'in', '&nbsp;')}</div>`}</div>`}
        <div class="card">
          <h3>Measurements <small class="muted">(optional)</small></h3>
          <p class="muted" style="font-size:.88rem">Not a good week to measure? Skip these. You can add them any time from Progress.</p>
          <div class="grid2">${MEAS.map(([k, l]) => unitInput('f-m-' + k, `data-meas="${k}"`, (d.meas || {})[k] || '', lu, l, ci && prev.meas?.[k] ? `Last: ${prev.meas[k]}` : '')).join('')}</div>
        </div>`;
    },
    targets(d) {
      const radio = (name, k, t, sub) => `<label class="radio"><input type="radio" name="${name}" value="${k}" data-draft-radio="${name}"${(d[name] || '') === k ? ' checked' : ''}><span><b>${t}</b><small>${sub}</small></span></label>`;
      return `<h1>Your daily targets</h1>
        <p class="lede">Pick your goal and your usual activity level. You can change the activity level any day in the app.</p>
        <h3>Goal</h3>
        <div style="display:grid;gap:8px">${Object.entries(GOALS).map(([k, g]) => radio('goal', k, g.label, g.sub)).join('')}</div>
        <h3>Usual activity level</h3>
        <div style="display:grid;gap:8px">${Object.entries(ACTIVITY).map(([k, a]) => radio('activity', k, a.label, `${a.desc} ${a.ex} ${a.steps}.`)).join('')}</div>
        <div class="card" id="macro-preview">${macroHTML(d, d.activity)}</div>`;
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
      <div class="prow"><span class="cat">Warm up</span><span class="warmline">Cardio 5–10 min, 5 dynamic stretches, then 1–2 light warm-up sets per body part</span></div>
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
      <div class="prow"><span class="cat">Warm up</span><span class="warmline">Cardio 5–10 min, 5 dynamic stretches, then 1–2 light warm-up sets per body part</span></div>
      ${CATS.map((c) => { const e = findEx(plan[c.key]); return `<div class="prow"><span class="cat">${esc(c.label)}</span><div class="pick">${exLink(plan[c.key])}${e?.detail ? `<span class="detail">${esc(e.detail)}</span>` : ''}</div></div>`; }).join('')}
    </section>`;
  }

  /* ---------- shell views ---------- */
  const BONUS_TYPES = ['Cardio', 'Hot Yoga', 'Pilates', 'Walk', 'Other'];
  const pad2 = (n) => String(n).padStart(2, '0');
  const isoOf = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  function liftDays() {
    const map = {};
    for (const [k, l] of Object.entries(state.logs)) {
      if (!l.done || !l.doneDate) continue;
      const [n, w, d] = k.split('-');
      (map[l.doneDate] = map[l.doneDate] || []).push(`Block ${n} · Week ${w} · Day ${d}`);
    }
    return map;
  }
  const dayData = (iso) => (state.daily && state.daily[iso]) || null;
  function ensureDay(iso) {
    state.daily = state.daily || {};
    if (!state.daily[iso]) state.daily[iso] = { steps: '', bonus: [] };
    return state.daily[iso];
  }

  function viewCal() {
    const today = todayISO();
    const sel = ui.calDate || today;
    const [y, m] = (ui.calMonth || today.slice(0, 7)).split('-').map(Number);
    const first = new Date(y, m - 1, 1);
    const lifts = liftDays();
    const cells = [];
    for (let i = 0; i < first.getDay(); i++) cells.push('<span class="cday empty"></span>');
    const daysIn = new Date(y, m, 0).getDate();
    let nLift = 0, nBonus = 0, stepSum = 0, stepDays = 0;
    for (let d = 1; d <= daysIn; d++) {
      const iso = `${y}-${pad2(m)}-${pad2(d)}`;
      const dd = dayData(iso);
      const lift = !!lifts[iso], bonus = dd && dd.bonus.length > 0;
      if (lift) nLift++;
      if (bonus) nBonus += dd.bonus.length;
      if (dd && num(dd.steps)) { stepSum += num(dd.steps); stepDays++; }
      const label = `${parseISO(iso).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}${lift ? ', lift day done' : ''}${bonus ? ', bonus workout' : ''}`;
      cells.push(`<button class="cday${lift ? ' lift' : ''}${iso === today ? ' today' : ''}" data-act="cal-day" data-date="${iso}" aria-pressed="${iso === sel}" aria-label="${esc(label)}">${d}${bonus ? '<i class="bdot" aria-hidden="true"></i>' : ''}</button>`);
    }
    const monthName = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const dd = dayData(sel);
    const selLifts = lifts[sel] || [];
    const future = sel > today;
    return `<section class="card">
        <div class="calhead"><button class="btn ghost sm" data-act="cal-month" data-delta="-1" aria-label="Previous month">‹</button><h2>${monthName}</h2><button class="btn ghost sm" data-act="cal-month" data-delta="1" aria-label="Next month">›</button></div>
        <div class="cal">${['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((x) => `<span class="cdow">${x}</span>`).join('')}${cells.join('')}</div>
        <div class="legend"><span><i class="lg lift"></i>Lift day done</span><span><i class="lg bonus"></i>Bonus workout</span></div>
        <p class="muted num" style="font-size:.85rem">This month: ${nLift} lift day${nLift === 1 ? '' : 's'} · ${nBonus} bonus workout${nBonus === 1 ? '' : 's'}${stepDays ? ` · ${Math.round(stepSum / stepDays).toLocaleString()} avg steps` : ''}</p>
      </section>
      ${future ? '' : dayTargets(sel, 'Activity that day')}
      <section class="card">
        <h2>${parseISO(sel).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</h2>
        ${selLifts.length ? selLifts.map((t) => `<p class="liftdone">✓ ${esc(t)}</p>`).join('') : `<p class="muted" style="font-size:.88rem">${future ? 'Coming up.' : 'No lift day logged. Rest days are a great time for a bonus workout.'}</p>`}
        ${future ? '' : `
        <label class="field" for="f-steps">Daily steps<span class="unitin"><input type="text" inputmode="numeric" id="f-steps" data-dayfield="steps" value="${esc(dd?.steps || '')}" placeholder="e.g. 8000" autocomplete="off"><span>steps</span></span></label>
        <h3>Bonus workouts</h3>
        ${dd && dd.bonus.length ? `<ul class="blist">${dd.bonus.map((x, i) => `<li><span><b>${esc(x.type)}</b>${x.min ? ` · ${esc(x.min)} min` : ''}${x.note ? `<small>${esc(x.note)}</small>` : ''}</span><button class="btn ghost sm" data-act="bonus-rm" data-i="${i}" aria-label="Remove ${esc(x.type)}">Remove</button></li>`).join('')}</ul>` : ''}
        <div class="bform">
          <label class="field" for="f-btype">Workout<select id="f-btype">${BONUS_TYPES.map((t) => `<option>${t}</option>`).join('')}</select></label>
          ${unitInput('f-bmin', '', '', 'min', 'Minutes')}
          <label class="field bnote" for="f-bnote">Note <small>(optional)</small><input type="text" id="f-bnote" placeholder="e.g. 45 min hot yoga flow" autocomplete="off"></label>
        </div>
        <div><button class="btn primary" data-act="bonus-add">+ Add bonus workout</button></div>
        <p class="hint">Bonus workouts are extra. They don't count toward your 3 lift days.</p>`}
      </section>`;
  }

  const ICONS = {
    cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
    today: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6.5 6.5v11M17.5 6.5v11M3 9v6M21 9v6M6.5 12h11"/></svg>',
    plan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 9h8M8 13h8M8 17h5"/></svg>',
    me: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 19V5M4 19h16M8 15l3-4 3 2 5-6"/></svg>',
  };
  function renderShell() {
    const b = curBlock();
    const w = Math.min(weekNow(b), WEEKS);
    const views = { today: viewToday, plan: viewPlan, me: viewMe, cal: viewCal };
    return `<header class="topbar"><span class="brand">Lift<b>Block</b></span><span class="topright"><span class="where num">Block ${b.n} · Week ${needsCheckin() ? WEEKS + 1 : w}${isDeload(w) && !needsCheckin() ? ' · Deload' : ''}</span><button class="calbtn" data-act="nav" data-view="cal" aria-label="Calendar"${ui.view === 'cal' ? ' aria-current="page"' : ''}>${ICONS.cal}</button></span></header>
      <main class="page">${views[ui.view]()}</main>
      <nav class="tabs" aria-label="Main"><div class="tabs-in">
        ${[['today', 'Workout'], ['plan', 'Plan'], ['me', 'Progress']].map(([v, l]) => `<button data-act="nav" data-view="${v}"${ui.view === v ? ' aria-current="page"' : ''}>${ICONS[v]}${l}</button>`).join('')}
      </div></nav>`;
  }

  function checkinBanner() {
    return `<div class="banner info"><strong>Week ${WEEKS + 1}: time for your check-in</strong><p>You've finished 12 weeks. Update your weight and measurements, then pick your exercises for the next block.</p><div><button class="btn primary sm" data-act="checkin-start">Start check-in</button></div></div>`;
  }

  function finishBanner(b) {
    return `<div class="banner info"><strong>🎉 Week ${WEEKS} done. Time to finish Block ${b.n}</strong><p>You completed all 3 workouts this week. Finish Block ${b.n} to update your weight and measurements and pick new exercises for Block ${b.n + 1}.</p><div><button class="btn primary sm" data-act="checkin-start">Finish Block ${b.n}</button></div></div>`;
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

    let banner = measNudge(b);
    if (needsCheckin()) banner += checkinBanner();
    else if (w === WEEKS && daysDone(b.n, WEEKS) === 3) banner += finishBanner(b);
    if (deload) banner += `<div class="banner deload"><strong>Deload week: lower your weights</strong><p>Use about 60% of the weight you lifted last week on every exercise. The grey numbers in each set are a suggested deload weight. Same exercises, same reps, clean form. This lets your body recover so you come back stronger next week.</p></div>`;
    else if (isDeload(w + 1)) banner += `<div class="banner deload"><strong>Heads up: week ${w + 1} is a deload week</strong><p>Push this week. Next week you'll lower your weights to recover.</p></div>`;

    const chk = (k, t, s) => `<label class="check"><input type="checkbox" data-check="${k}"${log?.[k] ? ' checked' : ''}><span>${t}<small>${s}</small></span></label>`;

    const exCards = CATS.filter((c) => c.type !== 'cardio').map((c) => {
      const planId = plan[c.key];
      const exId = log?.ex?.[c.key] || planId;
      const swapped = exId !== planId;
      const lr = LR(c.key);
      const sets = log?.sets?.[c.key] || blankSets();
      const best = lastBest(b.n, w, c.key, exId);
      const e = findEx(exId);
      const dl = (x) => (deload && x ? String(Math.round(x * 0.6)) : x ? String(x) : '');
      const phW = best ? dl(best.w) : '';
      const ph = (x) => (best && x ? String(x) : '');
      const inp = (i, f, val, mode, label, placeholder) => `<input type="text" inputmode="${mode}" data-set="${c.key}" data-i="${i}" data-f="${f}" value="${esc(val || '')}" placeholder="${esc(placeholder)}" aria-label="${esc(c.label)} set ${i + 1} ${label}" autocomplete="off">`;
      const swapUI = ui.swapOpen === c.key
        ? `<div class="swapbox"><p><strong>We recommend keeping the same exercise.</strong> Sticking with it for all 12 weeks is how you see your progress. Only swap for an injury or if the equipment isn't free.</p>
            <label class="field" for="sw-${c.key}">Swap to<select id="sw-${c.key}" data-swap="${c.key}">${c.options.map((o) => `<option value="${esc(o.id)}"${o.id === exId ? ' selected' : ''}>${esc(o.name)}${o.id === planId ? ' (your plan)' : ''}</option>`).join('')}</select></label>
            ${swapped
              ? `<p class="hint">Now swapped for today only. Want ${esc(findEx(exId)?.name || '')} for every remaining ${esc(c.label)} workout in Block ${b.n}?</p>
                 <div class="btnrow"><button class="btn sm" data-act="swap-close">Just today</button><button class="btn sm primary" data-act="swap-block" data-cat="${c.key}">Rest of Block ${b.n}</button></div>`
              : '<div><button class="btn sm ghost" data-act="swap-close">Cancel</button></div>'}</div>`
        : '';
      return `<section class="card${deload ? ' deloadcard' : ''}">
        <div class="exhead"><span class="cat">${esc(c.label)}${swapped ? ' <span class="swaptag">Swapped today</span>' : ''}</span>${exLink(exId)}${e?.detail ? `<span class="detail">${esc(e.detail)}</span>` : ''}
          ${swapped ? `<span class="detail">Your plan: ${esc(findEx(planId)?.name || '')} · <button class="linkbtn" data-act="swap-reset" data-cat="${c.key}">Switch back</button></span>` : ''}</div>
        ${swapUI}
        <div class="sets${lr ? ' lr' : ''}">
          <div class="sethead"><span>Set</span><span>Weight (${unit})</span>${lr ? '<span>Left reps</span><span>Right reps</span>' : '<span>Reps</span>'}</div>
          ${sets.map((x, i) => `<div class="set"><span class="setn">${i + 1}</span>
            ${inp(i, 'w', x.w, 'decimal', 'weight', phW)}
            ${lr ? inp(i, 'rl', x.rl, 'numeric', 'left reps', ph(best?.rl)) + inp(i, 'rr', x.rr, 'numeric', 'right reps', ph(best?.rr)) : inp(i, 'r', x.r, 'numeric', 'reps', ph(best?.r))}</div>`).join('')}
        </div>
        <div class="btnrow"><button class="btn sm ghost" data-act="add-set" data-cat="${c.key}">+ Add set</button>${sets.length > 1 ? `<button class="btn sm ghost" data-act="rm-set" data-cat="${c.key}">Remove last set</button>` : ''}${ui.swapOpen === c.key ? '' : `<button class="btn sm ghost" data-act="swap-open" data-cat="${c.key}">Swap for today</button>`}</div>
        ${best ? `<p class="hint num">Last time (week ${best.week}) best: <em>${best.w || '–'} ${unit} × ${lr ? `L ${best.rl || '–'} / R ${best.rr || '–'}` : best.r || '–'}</em>${deload ? ` · Deload: about <em>${Math.round(best.w * 0.6)} ${unit}</em>` : ''}</p>` : (deload ? `<p class="hint">Deload: use about 60% of your usual weight.</p>` : (w === 1 ? '<p class="hint">Week 1: log your starting weight and reps. Next week they show here as a guide.</p>' : ''))}
      </section>`;
    }).join('');

    return `${banner}
      ${dayTargets(todayISO(), "Today's activity")}
      <section class="card"><div class="segrow"><h2>Week ${w}${w === now ? '' : ` <small class="muted">(this week is ${now})</small>`}</h2><span class="muted num">${fmtDate(addDays(b.startDate, (w - 1) * 7))}</span></div><div class="weeks">${weekBtns}</div></section>
      <div class="days" role="group" aria-label="Day">${[1, 2, 3].map((n) => `<button data-act="day" data-d="${n}" aria-pressed="${n === d}">Day ${n}${getLog(b.n, w, n)?.done ? ' <span class="ok">✓</span>' : ''}</button>`).join('')}</div>
      <section class="card"><h3>Warm up</h3>
        ${chk('warmup', '1. Cardio warm-up', '5–10 minutes, easy pace')}
        <div class="stretches"><p class="stitle">2. Dynamic stretches <small>Keep moving, don't hold. Do them in this order.</small></p>
          ${STRETCHES.map((x, i) => `<label class="check sub"><input type="checkbox" data-stretch="${esc(x.id)}"${log?.stretch?.[x.id] ? ' checked' : ''}><span><a href="${esc(videoUrl(x))}" target="_blank" rel="noopener">${esc(x.name)}</a><b>${esc(x.dose)}</b><small>${esc(x.why)}</small></span></label>${x.img ? `<details class="seehow"><summary>See how: ${esc(x.name)}</summary><img src="${esc(x.img)}" alt="${esc(x.name)}: ${esc(x.why)}" loading="lazy" width="540" height="959"></details>` : ''}`).join('')}
        </div>
        ${chk('dynamic', '3. Warm-up sets', '1–2 light sets per body part before your working sets')}
      </section>
      ${exCards}
      <section class="card"><div class="exhead"><span class="cat">Cardio</span>${cardioEx ? exLink(cardioEx.id) : ''}${cardioEx?.detail ? `<span class="detail">${esc(cardioEx.detail)}</span>` : ''}</div>
        <div class="grid2" style="align-items:end">
          ${chk('cardio', 'Done', 'Finish with cardio')}
          ${unitInput('f-cmin', 'data-field="cardioMin"', log?.cardioMin || '', 'min', 'Minutes')}
        </div>
      </section>
      <section class="card"><label class="field" for="f-notes">Notes<small>How did it feel? Anything you noticed?</small><textarea id="f-notes" data-field="notes" placeholder="e.g. Left knee felt better. Go up 5 lb on squats next week.">${esc(log?.notes || '')}</textarea></label></section>
      <button class="btn block ${log?.done ? 'done' : 'primary'}" data-act="toggle-done">${log?.done ? `✓ Day ${d} complete` : `Mark Day ${d} complete`}</button>
      ${w === WEEKS && !needsCheckin() ? `<section class="card flat"><h3>Last week of Block ${b.n}</h3><p class="muted" style="font-size:.88rem">When you've finished this week's workouts, finish the block to check in and pick your next exercises.</p><div><button class="btn" data-act="checkin-start">Finish Block ${b.n}</button></div></section>` : ''}`;
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

  const hasMeas = (m) => !!m && MEAS.some(([k]) => num(m[k]));
  function measCard(b) {
    const lu = state.profile.lengthUnit;
    const m = (b.startStats && b.startStats.meas) || {};
    const has = hasMeas(m);
    return `<section class="card" id="meas-card"><h2>Starting measurements</h2>
      <p class="muted" style="font-size:.88rem">${has ? `Block ${b.n} starting point. You can update these if you measured a little late.` : `Add these whenever it suits you, like a week when you feel your usual self. They become your Block ${b.n} starting point.`}</p>
      <div class="grid2">${MEAS.map(([k, l]) => unitInput('f-bm-' + k, `data-bmeas="${k}"`, m[k] || '', lu, l)).join('')}</div>
      ${b.startStats && b.startStats.measDate ? `<p class="hint">Measured ${fmtDate(b.startStats.measDate)}</p>` : ''}
    </section>`;
  }
  function measNudge(b) {
    if (hasMeas(b.startStats && b.startStats.meas)) return '';
    if (state.measNudgeUntil && todayISO() < state.measNudgeUntil) return '';
    return `<section class="card flat"><h3>Starting measurements</h3><p class="muted" style="font-size:.88rem">Add them when you're ready. No rush.</p><div class="btnrow"><button class="btn sm primary" data-act="meas-go">Add now</button><button class="btn sm ghost" data-act="meas-later">Remind me next week</button></div></section>`;
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
      <section class="card"><h2>Today's targets</h2>${macroHTML(p, activityFor(todayISO()), 'Calories today')}<p class="hint">Goal: ${GOALS[p.goal || 'lose'].label}. Usual activity: ${ACTIVITY[p.activity || 'moderate'].label}. Change these in Edit profile.</p></section>
      ${measCard(b)}
      <section class="card"><h2>This block</h2><div class="wgrid">${grid}</div><p class="muted" style="font-size:.82rem">Green dots are completed days. D marks a deload week.</p></section>
      <section class="card"><h2>Check-ins</h2>
        <div class="tablewrap"><table><thead><tr><th>Block</th><th>Date</th><th>Weight</th>${MEAS.map(([, l]) => `<th>${l} (${lu})</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>
        <dl class="kv"><dt>Height</dt><dd>${heightText(p)}</dd><dt>Goal weight</dt><dd>${esc(p.goalWeight)} ${wu}</dd></dl>
      </section>
      ${standalone ? '' : `<section class="card flat"><h3>Add to your home screen</h3><p class="muted" style="font-size:.88rem">iPhone (Safari): tap Share, then Add to Home Screen. Android (Chrome): tap the ⋮ menu, then Install app or Add to Home screen.</p></section>`}
      <section class="card"><h2>Settings</h2>
        <div class="btnrow"><button class="btn" data-act="edit-profile">Edit profile &amp; units</button><button class="btn" data-act="show-welcome">How Lift Block works</button><button class="btn" data-act="checkin-start">Finish Block ${b.n}</button></div>
        <h3>Download your data</h3>
        <p class="muted" style="font-size:.88rem">Every workout, set, bonus workout, steps, activity level and measurement in one Excel file.</p>
        <div><button class="btn primary" data-act="excel">Download Excel file</button></div>
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
  function renderWelcome() {
    const steps = [
      ['Pick your 6 moves', 'One each: Squat, Bend, Push, Pull, Single Leg, Core.'],
      ['Lock in for 12 weeks', '3 full-body days a week. Same moves. Get stronger.'],
      ['Deload in weeks 6 and 12', 'Drop to about 60% of last week\'s weight and recover.'],
      ['Level up', 'After 12 weeks, check in, pick new moves, go again.'],
    ];
    return `<div class="welcome"><div class="welcome-in">
      <p class="eyebrow">For the busy body</p>
      <h1>Life's busy.<br>Your gym plan <span class="hl">shouldn't be.</span></h1>
      <p class="welcome-lede">3 days a week. Full body. Zero guesswork.</p>
      <ol class="wsteps">${steps.map(([t, s], i) => `<li><span class="wn">${i + 1}</span><span><b>${t}</b><small>${s}</small></span></li>`).join('')}</ol>
      <p class="welcome-tag">Simple plan. Consistent action. Real results.</p>
      <button class="btn primary block big" data-act="welcome-go">${state ? 'Back to my plan' : "LET'S GOOOO 💪🏽😠"}</button>
      <p class="welcome-note">Your data stays on your phone.</p>
    </div></div>`;
  }

  function render() {
    if (ui.showWelcome) { app.innerHTML = renderWelcome(); return; }
    if (!state && !ui.welcomed) { app.innerHTML = renderWelcome(); return; }
    if (!state && ui.flow !== 'onboard') startFlow('onboard');
    else if (state && !ui.flow && needsCheckin() && !ui.checkinLater) startFlow('checkin');
    app.innerHTML = ui.flow ? renderFlow() : renderShell();
  }

  /* ---------- events ---------- */
  function updatePreview() {
    const el = document.getElementById('macro-preview');
    if (el && ui.draft) el.innerHTML = macroHTML(ui.draft, ui.draft.activity);
  }

  app.addEventListener('click', (e) => {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const act = t.dataset.act;
    const top = () => window.scrollTo(0, 0);
    ui.msg = '';
    switch (act) {
      case 'nav': ui.view = t.dataset.view; ui.confirmReset = false; ui.editPlan = false; top(); break;
      case 'week': ui.week = +t.dataset.w; ui.day = null; ui.swapOpen = null; break;
      case 'day': ui.day = +t.dataset.d; ui.swapOpen = null; break;
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
      case 'swap-open': ui.swapOpen = t.dataset.cat; break;
      case 'swap-close': ui.swapOpen = null; break;
      case 'swap-block': {
        const { n, w, d } = ui.ctx; const c = t.dataset.cat; const blk = curBlock(); const plan = planOf(blk);
        const to = ensureLog(n, w, d).ex[c]; const from = plan[c];
        // Keep past workouts tied to what was actually done, then change the plan from here on.
        for (const [k, l] of Object.entries(state.logs)) if (k.startsWith(blk.n + '-') && l.ex && !l.ex[c]) l.ex[c] = from;
        blk.plan = plan; plan[c] = to;
        (blk.planChanges = blk.planChanges || []).push({ date: todayISO(), week: w, day: d, movement: c, from, to });
        ui.swapOpen = null; save(); break;
      }
      case 'swap-reset': { const { n, w, d } = ui.ctx; const log = ensureLog(n, w, d); log.ex[t.dataset.cat] = planOf(curBlock())[t.dataset.cat]; ui.swapOpen = null; save(); break; }
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
        if (log.done) log.doneDate = todayISO(); else delete log.doneDate;
        if (log.done && w === WEEKS && daysDone(n, WEEKS) === 3) window.scrollTo(0, 0);
        snapshotEx(log, d);
        save(); break;
      }
      case 'cal-month': {
        const [y, m] = (ui.calMonth || todayISO().slice(0, 7)).split('-').map(Number);
        ui.calMonth = isoOf(new Date(y, m - 1 + +t.dataset.delta, 1)).slice(0, 7); break;
      }
      case 'cal-day': ui.calDate = t.dataset.date; break;
      case 'bonus-add': {
        const iso = ui.calDate || todayISO();
        const type = document.getElementById('f-btype').value;
        const min = document.getElementById('f-bmin').value.trim();
        const note = document.getElementById('f-bnote').value.trim();
        ensureDay(iso).bonus.push({ type, min, note });
        save(); break;
      }
      case 'meas-go': ui.view = 'me'; render(); document.getElementById('meas-card')?.scrollIntoView(); return;
      case 'meas-later': state.measNudgeUntil = addDays(todayISO(), 7); save(); break;
      case 'day-activity': ensureDay(t.dataset.date).activity = t.dataset.v; save(); break;
      case 'bonus-rm': {
        const dd = dayData(ui.calDate || todayISO());
        if (dd) { dd.bonus.splice(+t.dataset.i, 1); save(); }
        break;
      }
      case 'welcome-go': ui.welcomed = true; ui.showWelcome = false; top(); break;
      case 'show-welcome': ui.showWelcome = true; top(); break;
      case 'export': exportData(); return;
      case 'excel': exportExcel(); return;
      case 'reset-ask': ui.confirmReset = true; break;
      case 'reset-no': ui.confirmReset = false; break;
      case 'reset-yes':
        try { localStorage.removeItem(KEY); } catch (err) { /* ignore */ }
        state = null; ui.welcomed = false; ui.flow = null; ui.confirmReset = false; ui.view = 'today'; ui.week = null; ui.day = null; ui.checkinLater = false; top(); break;
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
    if (t.dataset.bmeas) {
      const b = curBlock(); b.startStats = b.startStats || {};
      b.startStats.meas = b.startStats.meas || {};
      b.startStats.meas[t.dataset.bmeas] = t.value.trim();
      b.startStats.lengthUnit = state.profile.lengthUnit;
      b.startStats.measDate = todayISO();
      state.profile.meas = { ...(state.profile.meas || {}), [t.dataset.bmeas]: t.value.trim() };
      save(); return;
    }
    if (t.dataset.dayfield) { ensureDay(ui.calDate || todayISO())[t.dataset.dayfield] = t.value.trim(); save(); return; }
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
    if (t.dataset.draftRadio && ui.draft) { ui.draft[t.dataset.draftRadio] = t.value; updatePreview(); return; }
    if (t.dataset.swap && ui.ctx) {
      const { n, w, d } = ui.ctx; const log = ensureLog(n, w, d);
      log.ex[t.dataset.swap] = t.value; save(); render(); return;
    }
    if (t.hasAttribute('data-plan')) {
      if (t.dataset.src === 'draft') ui.draft.plan[t.dataset.cat] = t.value;
      else { const b = curBlock(); b.plan = planOf(b); b.plan[t.dataset.cat] = t.value; }
      if (t.dataset.src === 'block') save();
      render(); return;
    }
    if (t.dataset.stretch && ui.ctx) {
      const { n, w, d } = ui.ctx; const log = ensureLog(n, w, d);
      log.stretch = log.stretch || {}; log.stretch[t.dataset.stretch] = t.checked; save(); return;
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

  // Save a file. On an iPhone home-screen app, open the share sheet (Save to Files, AirDrop, Mail...).
  async function saveFile(blob, filename, okMsg) {
    try {
      const file = typeof File === 'function' ? new File([blob], filename, { type: blob.type }) : null;
      const iosApp = window.navigator.standalone === true;
      if (iosApp && file && navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: filename }); ui.msg = okMsg; }
        catch (e) { ui.msg = e && e.name === 'AbortError' ? '' : 'Could not share the file.'; }
        render(); return;
      }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      ui.msg = okMsg;
    } catch (err) { ui.msg = 'Could not save a file here. Try again from the installed app.'; }
    render();
  }
  function exportData() {
    saveFile(new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }), `liftblock-backup-${todayISO()}.json`, 'Backup file saved.');
  }

  function workbook() {
    const p = state.profile, wu = p.weightUnit, lu = p.lengthUnit;
    const v = (x) => { const n = num(x); return n !== null && String(n) === String(x).trim() ? n : (x ?? ''); };
    const yn = (b) => (b ? 'Yes' : 'No');
    const keys = Object.keys(state.logs).map((k) => k.split('-').map(Number)).sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
    const blockOf = (n) => state.blocks.find((b) => b.n === n);
    const weekStart = (n, w) => { const b = blockOf(n); return b ? addDays(b.startDate, (w - 1) * 7) : ''; };

    const sets = [['Block', 'Week', 'Day', 'Deload week', 'Week starting', 'Completed on', 'Movement', 'Exercise', 'Set', `Weight (${wu})`, 'Reps', 'Left reps', 'Right reps', 'Swapped (plan exercise)']];
    const days = [['Block', 'Week', 'Day', 'Deload week', 'Week starting', 'Day complete', 'Completed on', 'Cardio warm-up', 'Dynamic stretches done', 'Warm-up sets', 'Cardio', 'Cardio exercise', 'Cardio minutes', 'Notes']];
    for (const [n, w, d] of keys) {
      const l = state.logs[logKey(n, w, d)], b = blockOf(n);
      const plan = b ? planOf(b) : {};
      for (const c of CATS) {
        if (c.type === 'cardio') continue;
        const arr = l.sets && l.sets[c.key];
        if (!arr) continue;
        const exId = (l.ex && l.ex[c.key]) || plan[c.key];
        const swappedFrom = exId !== plan[c.key] ? (findEx(plan[c.key])?.name || '') : '';
        arr.forEach((st, i) => { if (st.w || st.r || st.rl || st.rr) sets.push([n, w, d, yn(isDeload(w)), weekStart(n, w), l.doneDate || '', c.label, findEx(exId)?.name || exId || '', i + 1, v(st.w), c.key === 'single' ? '' : v(st.r), v(st.rl || ''), v(st.rr || ''), swappedFrom]); });
      }
      const cardioId = (l.ex && l.ex.cardio) || plan.cardio;
      days.push([n, w, d, yn(isDeload(w)), weekStart(n, w), yn(l.done), l.doneDate || '', yn(l.warmup), `${STRETCHES.filter((x) => l.stretch && l.stretch[x.id]).length} of ${STRETCHES.length}`, yn(l.dynamic), yn(l.cardio), findEx(cardioId)?.name || '', v(l.cardioMin), l.notes || '']);
    }

    const daily = [['Date', 'Activity level', 'Calorie target', 'Steps', 'Bonus workout', 'Minutes', 'Note']];
    for (const iso of Object.keys(state.daily || {}).sort()) {
      const dd = state.daily[iso];
      const m = macros(p, activityFor(iso));
      const base = [iso, ACTIVITY[activityFor(iso)].label, m.missing ? '' : m.target, v(dd.steps)];
      if (dd.bonus && dd.bonus.length) dd.bonus.forEach((x) => daily.push([...base, x.type, v(x.min), x.note || '']));
      else daily.push([...base, '', '', '']);
    }

    const meas = [['Block', 'Check-in date', 'Weight', 'Weight unit', 'Goal weight', ...MEAS.map(([, l]) => l), 'Measurement unit', 'Measured on']];
    for (const b of state.blocks) {
      const s = b.startStats || {};
      meas.push([b.n, s.date || b.startDate, v(s.weight), s.weightUnit || wu, v(s.goalWeight), ...MEAS.map(([k]) => v(s.meas?.[k] || '')), s.lengthUnit || lu, s.measDate || (hasMeas(s.meas) ? s.date : '') || '']);
    }

    const m = macros(p, p.activity);
    const prof = [['Item', 'Value'], ['Name', p.name], ['Age', v(p.age)], ['Sex', p.sex || ''], ['Height', heightText(p)], [`Current weight (${wu})`, v(p.weight)], [`Goal weight (${wu})`, v(p.goalWeight)],
      ['Goal', GOALS[p.goal || 'lose'].label], ['Usual activity level', ACTIVITY[p.activity || 'moderate'].label], ['Calories (usual activity)', m.missing ? '' : m.target], ['Protein (g / day)', m.protein ?? ''],
      ['Current block', curBlock().n], ['Block started', curBlock().startDate], ['Exported', todayISO()]];
    const plans = [['Block', 'Started', ...CATS.map((c) => c.label)], ...state.blocks.map((b) => [b.n, b.startDate, ...CATS.map((c) => findEx(planOf(b)[c.key])?.name || '')])];

    return window.makeXlsx([
      { name: 'Workout Sets', rows: sets, widths: [7, 6, 5, 11, 13, 13, 11, 26, 5, 12, 6, 10, 11, 22] },
      { name: 'Lift Days', rows: days, widths: [7, 6, 5, 11, 13, 12, 13, 14, 18, 13, 7, 22, 14, 40] },
      { name: 'Bonus & Steps', rows: daily, widths: [12, 18, 13, 9, 15, 9, 30] },
      { name: 'Measurements', rows: meas, widths: [7, 13, 9, 11, 12, 9, 9, 9, 10, 9, 16, 13] },
      { name: 'Plans', rows: plans, widths: [7, 12, 20, 24, 18, 20, 16, 18, 22] },
      { name: 'Profile', rows: prof, widths: [24, 22] },
    ]);
  }
  function exportExcel() {
    try { saveFile(workbook(), `LiftBlock-${todayISO()}.xlsx`, 'Excel file saved.'); }
    catch (err) { ui.msg = 'Could not build the Excel file.'; render(); }
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
