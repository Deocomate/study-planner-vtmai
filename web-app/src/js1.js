(function () {
  'use strict';
  /* ---------- helpers ---------- */
  const h = (tag, props, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = v;
      else if (k === 'style') el.style.cssText = v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
    for (const kid of kids.flat(Infinity)) { if (kid === null || kid === undefined || kid === false) continue; el.append(kid.nodeType ? kid : document.createTextNode(String(kid))); }
    return el;
  };
  const svg = (s) => document.importNode(new DOMParser().parseFromString(s.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" '), 'image/svg+xml').documentElement, true);
  const LS = { get: (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* storage blocked */ } } };
  const uid = () => Math.random().toString(36).slice(2, 9);
  let LANG = LS.get('sp-lang', 'en') === 'vi' ? 'vi' : 'en';
  let ACCENT = (() => { const a = LS.get('sp-accent', 'lavender'); return ['lavender', 'blue', 'green', 'teal', 'gray'].includes(a) ? a : 'lavender'; })();
  let THEME = LS.get('sp-theme', 'light') === 'dark' ? 'dark' : 'light';
  const VI = {};   // filled at the bottom of the file
  const t = (s, ...a) => { let r = (LANG === 'vi' && VI[s]) || s; a.forEach((x, i) => { r = r.split(`{${i}}`).join(x); }); return r; };

  /* ---------- dates ---------- */
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return ymd(d); };
  const wd = (s) => { const g = parse(s).getDay(); return g === 0 ? 7 : g; };
  const weekStart = (s) => addDays(s, 1 - wd(s));
  const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 864e5);
  const EN_D = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], VI_D = ['', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
  const EN_DL = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'], VI_DL = ['', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy', 'Chủ nhật'];
  const EN_M = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const dowS = (i) => (LANG === 'vi' ? VI_D : EN_D)[i]; const dowL = (i) => (LANG === 'vi' ? VI_DL : EN_DL)[i];
  const fmtDay = (s) => { const d = parse(s); return LANG === 'vi' ? `${dowS(wd(s))}, ${d.getDate()}/${d.getMonth() + 1}` : `${dowS(wd(s))} ${d.getDate()} ${EN_M[d.getMonth()].slice(0, 3)}`; };
  const fmtLong = (s) => { const d = parse(s); return LANG === 'vi' ? `${dowL(wd(s))}, ${d.getDate()} tháng ${d.getMonth() + 1}, ${d.getFullYear()}` : `${dowL(wd(s))} ${d.getDate()} ${EN_M[d.getMonth()]} ${d.getFullYear()}`; };
  const monthLabel = (ym) => { const [y, m] = ym.split('-').map(Number); return LANG === 'vi' ? `Tháng ${m}, ${y}` : `${EN_M[m - 1]} ${y}`; };
  const hm = (x) => { const [a, b] = x.split(':').map(Number); return a * 60 + b; };
  const tm = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
  const dur = (m) => (m < 60 ? t('{0} min', m) : m % 60 ? t('{0} h {1} min', Math.floor(m / 60), m % 60) : t('{0} h', Math.floor(m / 60)));
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : null);
  const todayStr = () => ymd(new Date());
  const nowMin = () => { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); };
  const NAMEKEY = 'names';

  /* ---------- state (kept only in this browser) ---------- */
  const KEY = 'study-planner-wc-v3'; try { localStorage.removeItem('study-planner-wc-v1'); localStorage.removeItem('study-planner-wc-v2'); } catch (e) {}
  const school = (c) => [1, 2, 3, 4, 5].map((d) => ({ c, day: d, s: '07:00', e: '16:30', t: 'Vinschool' }));
  const DEFAULT_BLOCKS = () => [...school('ben'), ...school('shin'),
    { c: 'ben', day: 4, s: '20:00', e: '21:30', t: 'Writing cô Ngô Bla' }, { c: 'ben', day: 5, s: '19:30', e: '21:30', t: 'Debate EC' },
    { c: 'ben', day: 6, s: '08:00', e: '10:00', t: 'Cô Linh Cindy' }, { c: 'ben', day: 6, s: '14:00', e: '15:00', t: 'Piano' },
    { c: 'ben', day: 7, s: '10:30', e: '12:00', t: 'Science / Math' }, { c: 'ben', day: 7, s: '16:00', e: '18:00', t: 'Bóng rổ / Cầu lông' },
    { c: 'shin', day: 3, s: '19:40', e: '21:40', t: 'Cô Linh Cindy' }, { c: 'shin', day: 4, s: '18:00', e: '19:00', t: 'Science cô Giang' },
    { c: 'shin', day: 7, s: '16:30', e: '18:00', t: 'Bóng rổ' }, { c: 'shin', day: 7, s: '19:30', e: '20:30', t: 'Maths cô Mẫn' }].map((b) => ({ id: uid(), ...b }));
  const DEFAULT_REWARDS = () => [
    { id: uid(), emoji: '📱', name: 'iPad 15 minutes', cost: 20, ipadMin: 15 }, { id: uid(), emoji: '📱', name: 'iPad 30 minutes', cost: 40, ipadMin: 30 },
    { id: uid(), emoji: '🍦', name: 'Ice cream treat', cost: 50, ipadMin: 0 }, { id: uid(), emoji: '🎁', name: 'Gift worth 50,000 VND', cost: 150, ipadMin: 0 },
    { id: uid(), emoji: '🎬', name: 'Choose the family movie', cost: 80, ipadMin: 0 }, { id: uid(), emoji: '🎁', name: 'Gift worth 100,000 VND', cost: 300, ipadMin: 0 }];
  const fresh = () => ({ tasks: [], blocks: DEFAULT_BLOCKS(), links: [], rewards: DEFAULT_REWARDS(), redeems: [], adj: [], rules: { per5: 1, ontime: 5, approved: 10, daily: 5, ipadCap: 60 }, names: { ben: 'Ben', shin: 'Shin' } });
  let D;
  let FIRST_RUN = LS.get(KEY, null) === null;
  try { D = JSON.parse(LS.get(KEY, 'null')) || fresh(); } catch (e) { D = fresh(); }
  const ensure = () => { const f = fresh(); for (const k of Object.keys(f)) if (D[k] === undefined) D[k] = f[k]; D.rules = Object.assign(f.rules, D.rules); D.names = Object.assign(f.names, D.names); };
  ensure();
  /* ---------- server sync: when the page is served by the Node backend (server/), the state lives in its database.
     Without a backend (/api/state missing) everything stays in this browser as before. ---------- */
  const SRV = { on: false, rev: 0, epoch: '', timer: null, busy: false, dirty: false };
  const api = (path, opt = {}) => fetch(path, { credentials: 'same-origin', cache: 'no-store', ...opt });
  const adopt = (j) => { SRV.rev = j.rev; SRV.epoch = j.epoch; if (j.state) { D = j.state; ensure(); LS.set(KEY, JSON.stringify(D)); FIRST_RUN = false; } };
  const pushState = async () => { clearTimeout(SRV.timer); if (!SRV.on) return; if (SRV.busy) { SRV.timer = setTimeout(pushState, 300); return; }
    SRV.busy = true; SRV.dirty = false;
    try { const r = await api('/api/state', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: D, epoch: SRV.epoch }) });
      const j = await r.json();
      if (r.status === 409) { adopt(j); render(); }   // data was replaced by an import: show the new data
      else if (r.ok) { SRV.rev = j.rev; SRV.epoch = j.epoch; } else throw new Error(r.status);
    } catch (e) { SRV.dirty = true; SRV.timer = setTimeout(pushState, 5000); }
    SRV.busy = false; };
  const save = () => { LS.set(KEY, JSON.stringify(D)); if (SRV.on) { SRV.dirty = true; clearTimeout(SRV.timer); SRV.timer = setTimeout(pushState, 400); } };
  const pull = async () => { if (!SRV.on || SRV.dirty || SRV.busy || document.querySelector('.modal')) return;
    try { const m = await (await api('/api/state/rev')).json(); if (m.rev === SRV.rev && m.epoch === SRV.epoch) return;
      const j = await (await api('/api/state')).json(); if (SRV.dirty || SRV.busy || document.querySelector('.modal') || !j.state) return; adopt(j); render(); } catch (e) { /* offline: try again later */ } };
  const SRV_READY = (async () => { try { const ac = new AbortController(); const to = setTimeout(() => ac.abort(), 5000);
      const r = await api('/api/state', { signal: ac.signal }); clearTimeout(to); if (!r.ok) return; const j = await r.json(); if (!j || j.app !== 'study-planner') return;
      SRV.on = true; const local = D, fresh1 = !LS.get('sp-synced', '') && !FIRST_RUN; if (fresh1) LS.set(`${KEY}-before-sync`, JSON.stringify(local));
      adopt(j); LS.set('sp-synced', '1');
      if (!j.state || (fresh1 && local.tasks.length && !D.tasks.length)) { D = local; LS.set(KEY, JSON.stringify(D)); await pushState(); }   // empty server: upload what this browser has
      else if (fresh1) {   // first time this browser meets the server: keep its own tasks etc. instead of losing them
        let n = 0; for (const k of ['tasks', 'links', 'redeems', 'adj']) { const ids = new Set((D[k] || []).map((x) => x.id)); (local[k] || []).forEach((x) => { if (!ids.has(x.id)) { (D[k] = D[k] || []).push(x); n++; } }); }
        for (const k of ['customSubjects', 'customTeachers']) (local[k] || []).forEach((x) => { D[k] = D[k] || []; if (!D[k].includes(x)) { D[k].push(x); n++; } });
        if (n) { LS.set(KEY, JSON.stringify(D)); await pushState(); } }
      setInterval(pull, 15000); document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pull(); });
      addEventListener('pagehide', () => { if (SRV.dirty) try { navigator.sendBeacon('/api/state', new Blob([JSON.stringify({ state: D, epoch: SRV.epoch })], { type: 'application/json' })); } catch (e) { /* best effort */ } });
    } catch (e) { /* no backend: keep data in this browser */ } })();
  const NAME = (c) => (c === 'parent' ? t('Parent') : c === MOM ? (D.names.mom || t('Mom')) : D.names[c] || c);
  const KIDS = ['ben', 'shin']; const MOM = 'mom'; const PEOPLE = [...KIDS, MOM];
  const UI = { role: ['ben', 'shin', 'parent'].includes(LS.get('sp-role', 'parent')) ? LS.get('sp-role', 'parent') : 'parent', page: 'today', date: todayStr(), month: todayStr().slice(0, 7), who: 'all', perf: todayStr(), sheet: todayStr() };

  /* ---------- tasks ---------- */
  const safeUrl = (v) => { v = String(v || '').trim(); if (!v) return ''; if (!/^https?:\/\//i.test(v)) { if (/^[\w-]+(\.[\w-]+)+(\/|$)/.test(v)) v = `https://${v}`; else return ''; } try { return new URL(v).href; } catch (e) { return ''; } };
  const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return u; } };
  const minutesOf = (k) => (k.start && k.end && hm(k.end) > hm(k.start) ? hm(k.end) - hm(k.start) : k.minutes || 30);
  const endMin = (k) => (k.start ? hm(k.start) + minutesOf(k) : null);
  const isOverdue = (k) => k.status !== 'done' && k.date < todayStr();
  const isLate = (k) => k.status !== 'done' && k.date === todayStr() && !!k.start && endMin(k) < nowMin();
  const isNow = (k) => k.status !== 'done' && k.date === todayStr() && !!k.start && hm(k.start) <= nowMin() && nowMin() < endMin(k);
  const skey = (x) => { const v = String(x || '').toLowerCase().trim(); if (/math|toán|toan/.test(v)) return 'maths'; if (/esl|efl/.test(v)) return 'esl'; if (/sci|khoa học/.test(v)) return 'science'; if (/tiếng việt|tieng viet|^tv$/.test(v)) return 'viet'; if (/vnh|việt nam học|ls\s*&|lịch sử|địa lý|đl\b/.test(v)) return 'social'; if (/đọc sách|reading passport|library/.test(v)) return 'read'; if (/debate/.test(v)) return 'debate'; if (/eng|anh|writing|reading|shadow|vocab|grammar|mock|test/.test(v)) return 'english'; if (!v || v === 'other') return 'other'; let n = 0; for (const ch of v) n = (n * 31 + ch.charCodeAt(0)) % 3; return ['x1', 'x2', 'x3'][n]; };
  const SEMO = { maths: '📐', esl: '🗣️', science: '🔬', english: '📖', viet: '✍️', social: '🌏', read: '📚', debate: '🎤', other: '⭐', x1: '🎨', x2: '🌍', x3: '🎵' };
  const labelOf = (k) => [k.subject && k.subject !== 'Other' ? k.subject : '', k.teacher].filter(Boolean).join(' · ');
  const who = () => (UI.role === 'parent' ? (UI.who === 'all' ? PEOPLE : [UI.who]) : [UI.role]);
  const byTime = (a, b) => (a.start ? 0 : 1) - (b.start ? 0 : 1) || (a.start || '').localeCompare(b.start || '') || (a.order ?? 9999) - (b.order ?? 9999) || a.title.localeCompare(b.title);
  const tasksOn = (date, kids) => D.tasks.filter((k) => (kids || who()).includes(k.child) && k.date === date).sort(byTime);
  const blocksOn = (c, date) => D.blocks.filter((b) => b.c === c && b.day === wd(date)).sort((a, b) => a.s.localeCompare(b.s));
  const conflicts = (k) => { const out = []; if (!k.start) return out; const a = hm(k.start), b = a + minutesOf(k);
    for (const f of blocksOn(k.child, k.date)) if (a < hm(f.e) && hm(f.s) < b) out.push(t('It overlaps "{0}" ({1}-{2}).', f.t, f.s, f.e));
    for (const o of D.tasks) if (o.id !== k.id && o.child === k.child && o.date === k.date && o.start && a < endMin(o) && hm(o.start) < b) out.push(t('It overlaps "{0}" ({1}).', o.title, o.start));
    return out; };
  /* points are always computed from the tasks, never stored */
  const taskPts = (k) => Math.round((minutesOf(k) / 5) * D.rules.per5);
  const pointsOf = (c) => {
    const items = [];
    for (const k of D.tasks.filter((x) => x.child === c && x.status === 'done')) {
      items.push({ why: k.title, pts: taskPts(k), kind: t('Work done') });
      if (D.rules.ontime && (!k.doneAt || k.doneAt.slice(0, 10) <= k.date)) items.push({ why: t('{0} on time', k.title), pts: D.rules.ontime, kind: t('On-time bonus') });
      if (k.review === 'approved' && D.rules.approved) items.push({ why: t('{0} approved', k.title), pts: D.rules.approved, kind: t('Approved by parent') });
    }
    const byDay = {}; D.tasks.filter((x) => x.child === c).forEach((x) => (byDay[x.date] ||= []).push(x));
    for (const [d, list] of Object.entries(byDay)) if (d <= todayStr() && list.every((x) => x.status === 'done') && D.rules.daily) items.push({ why: t('Everything on {0} done', fmtDay(d)), pts: D.rules.daily, kind: t('Day bonus') });
    const earned = items.reduce((a, x) => a + x.pts, 0), adj = D.adj.filter((x) => x.child === c).reduce((a, x) => a + x.pts, 0);
    const used = D.redeems.filter((x) => x.child === c && x.status === 'approved').reduce((a, x) => a + x.cost, 0), held = D.redeems.filter((x) => x.child === c && x.status === 'pending').reduce((a, x) => a + x.cost, 0);
    return { items, earned, adj, used, held, balance: earned + adj - used - held };
  };
  const ipadToday = (c) => D.redeems.filter((x) => x.child === c && x.day === todayStr() && x.status !== 'denied').reduce((a, x) => a + (x.ipadMin || 0), 0);
  const stats = (list) => { const done = list.filter((k) => k.status === 'done'); const onTime = done.filter((k) => !k.doneAt || k.doneAt.slice(0, 10) <= k.date).length;
    return { total: list.length, done: done.length, onTime, doneLate: done.length - onTime, doing: list.filter((k) => k.status === 'doing').length, overdue: list.filter(isOverdue).length, mins: done.reduce((a, k) => a + minutesOf(k), 0), completion: pct(done.length, list.length), onTimeRate: pct(onTime, done.length) }; };

  /* ---------- holidays (a week before: countdown tag, hanging icon, falling emoji) ---------- */
  const TET = { 2026: '02-17', 2027: '02-06', 2028: '01-26', 2029: '02-13', 2030: '02-03', 2031: '01-23', 2032: '02-11', 2033: '01-31', 2034: '02-19', 2035: '02-08' };
  const MID = { 2026: '09-25', 2027: '09-15', 2028: '10-03', 2029: '09-22', 2030: '09-12', 2031: '10-01', 2032: '09-19', 2033: '09-08', 2034: '09-27', 2035: '09-16' };
  const HOL = [
    { key: 'new-year', en: 'New Year', vi: 'Năm mới', date: '01-01', icons: ['🎉', '✨', '🎆'] }, { key: 'tet', en: 'Tet', vi: 'Tết Nguyên Đán', date: TET, after: 3, icons: ['🧧', '🌼', '🏮'] },
    { key: 'valentine', en: 'Valentine', vi: 'Valentine', date: '02-14', icons: ['💖', '🌹', '💌'] }, { key: 'womens-day', en: "Women's Day", vi: 'Quốc tế Phụ nữ 8/3', date: '03-08', icons: ['💐', '🌷', '🌸'] },
    { key: 'childrens-day', en: "Children's Day", vi: 'Quốc tế Thiếu nhi 1/6', date: '06-01', icons: ['🎈', '🧸', '🍭'] }, { key: 'national-day', en: 'National Day', vi: 'Quốc khánh 2/9', date: '09-02', icons: ['⭐', '🎈', '🎊'] },
    { key: 'back-to-school', en: 'Back to school', vi: 'Khai giảng', date: '09-05', icons: ['🎒', '📚', '✏️'] }, { key: 'mid-autumn', en: 'Mid-Autumn', vi: 'Trung thu', date: MID, icons: ['🏮', '🥮', '🌕'] },
    { key: 'halloween', en: 'Halloween', vi: 'Halloween', date: '10-31', icons: ['🎃', '🦇', '👻'] }, { key: 'teachers-day', en: "Teachers' Day", vi: 'Nhà giáo Việt Nam 20/11', date: '11-20', icons: ['📚', '🌻', '💐'] },
    { key: 'christmas', en: 'Christmas', vi: 'Giáng sinh', date: '12-25', icons: ['🎄', '❄️', '⛄'] }];
  const holidayOn = (today) => { const year = Number(today.slice(0, 4)); const act = [];
    for (const x of HOL) for (const y of [year - 1, year, year + 1]) { const md = typeof x.date === 'string' ? x.date : x.date[y]; if (!md) continue; const d = `${y}-${md}`; if (today >= addDays(d, -7) && today <= addDays(d, x.after || 0)) act.push({ x, d }); }
    act.sort((a, b) => a.d.localeCompare(b.d)); if (!act[0]) return null; const left = daysBetween(today, act[0].d); return { key: act[0].x.key, name: act[0].x[LANG], icons: act[0].x.icons, left }; };
