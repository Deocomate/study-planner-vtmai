
  /* ---------- Today ---------- */
  const pageHead = (title, sub, ...acts) => h('div', { class: 'phead' }, h('div', null, h('h1', null, title), sub ? h('p', null, sub) : null), h('div', { class: 'acts' }, acts));
  const kidSelect = () => (UI.role !== 'parent' ? null : h('select', { class: 'input', style: 'width:auto', 'aria-label': t('Choose a student'), onchange: (e) => { UI.who = e.target.value; render(); } }, [['all', t('Everyone')], ...KIDS.map((c) => [c, NAME(c)]), [MOM, `👩 ${NAME(MOM)}`]].map(([v, l]) => h('option', { value: v, selected: UI.who === v }, l))));
  const prePill = (k) => { const l = labelOf(k); return h('span', { class: `pre sub-${skey(k.subject)}` }, `${SEMO[skey(k.subject)]} ${l || t('Study')}`); };
  const dueInfo = (k) => { if (!k.due) return null; const today = todayStr(); const n = daysBetween(today, k.due); const done = k.status === 'done';
    if (!done && k.child !== MOM && k.date > k.due) return { cls: 'b-red', txt: t('⚠ Planned after the deadline ({0})', fmtDay(k.due)) };
    if (done) return { cls: '', txt: t('Due {0}', fmtDay(k.due)) };
    if (n < 0) return { cls: 'b-red', txt: t('Overdue · was due {0}', fmtDay(k.due)) };
    if (n === 0) return { cls: 'b-red', txt: t('Due today') };
    if (n === 1) return { cls: 'b-yellow', txt: t('Due tomorrow ({0})', fmtDay(k.due)) };
    return { cls: '', txt: t('Due {0} · {1} days left', fmtDay(k.due), n) }; };
  const taskItem = (k, o = {}) => {
    const st = k.status; const late = isLate(k), over = isOverdue(k); const par = UI.role === 'parent'; const di = dueInfo(k);
    const btn = (label, cls, fn, extra) => h('button', Object.assign({ type: 'button', class: `btn sm ${cls}`, onclick: fn }, extra || {}), label);
    const acts = [];
    if (par && st === 'done' && k.review === 'awaiting') acts.push(btn(t('✓ Approve'), 'ok', () => reviewTask(k, true)), btn(t('Send back'), 'secondary', () => reviewTask(k, false)));
    if (canEdit(k)) acts.push(btn('📎', 'ghost icon', () => quickAttach(k), { 'aria-label': t('Attach files'), title: t('Attach files') }));
    if (canEdit(k)) acts.push(btn('✎', 'ghost icon', () => taskForm(k), { 'aria-label': t('Edit'), title: t('Edit') }));
    const time = k.start ? `${k.start}${k.end ? `–${k.end}` : ''}` : t('Any time');
    return h('li', { class: `task2 sub-${skey(k.subject)} ${st === 'done' ? 'is-done' : ''} ${isNow(k) ? 'now' : ''} ${late || over ? 'is-late' : ''}` },
      canStatus(k) ? h('button', { type: 'button', class: 'chk', 'aria-pressed': String(st === 'done'), 'aria-label': st === 'done' ? t('Reopen') : t('Mark as done'), title: st === 'done' ? t('Reopen') : t('Mark as done'), onclick: (e) => setStatus(k, st === 'done' ? 'todo' : 'done', e.currentTarget) }, st === 'done' ? '✓' : '') : h('span', { class: 'chk', 'aria-hidden': 'true' }),
      h('div', { class: 'tb' },
        h('div', { class: 'l1' }, h('span', { class: 'pre' }, k.child === MOM && !k.subject ? `📋 ${t('Prepare')}` : k.title === k.subject ? `${k.repeat ? '🔁' : SEMO[skey(k.subject)]} ${t('Practice')}` : `${SEMO[skey(k.subject)]} ${k.subject || t('Study')}`), h('h3', { class: 't-title' }, k.title), k.repeat && k.title !== k.subject ? h('span', { class: 'muted small', title: t('Repeats every week') }, '🔁') : null),
        h('div', { class: 'l2' }, k.teacher ? h('span', null, `👩‍🏫 ${k.teacher}`) : null, o.showDate ? h('span', null, `📅 ${fmtDay(k.date)}`) : null, o.showWho ? h('span', null, `👤 ${NAME(k.child)}`) : null),
        (di || k.optional || k.priority === 'high' || late || isNow(k) || st === 'doing' || (k.review && k.review !== 'none') || st === 'done') ? h('div', { class: 'l3' },
          di ? h('span', { class: `badge ${di.cls}` }, `📌 ${di.txt}`) : null, k.optional ? h('span', { class: 'badge' }, t('Optional')) : null, k.priority === 'high' ? h('span', { class: 'badge b-red' }, t('Important')) : null,
          isNow(k) ? h('span', { class: 'badge b-pink' }, t('Happening now')) : null, late ? h('span', { class: 'badge b-red' }, t('Late')) : null, st === 'doing' ? h('span', { class: 'badge b-yellow' }, t('Doing')) : null,
          k.review === 'awaiting' ? h('span', { class: 'badge b-yellow' }, t('Awaiting review')) : k.review === 'approved' ? h('span', { class: 'badge b-green' }, t('Approved')) : k.review === 'changes' ? h('span', { class: 'badge b-red' }, t('Changes requested')) : null,
          st === 'done' && k.child !== MOM ? h('span', { class: 'badge b-green' }, `⭐ +${taskPts(k)}`) : null) : null,
        k.note ? h('p', { class: 't-note' }, k.note) : null, k.feedback && (k.review === 'changes' || k.review === 'approved') ? h('p', { class: 't-note' }, `💬 ${t('Parent')}: ${k.feedback}`) : null,
        k.files && k.files.length ? fileChips(k.files) : null,
        k.links && k.links.length ? h('ul', { class: 'links', 'aria-label': t('Work links') }, k.links.map((u) => h('li', { style: 'min-width:0;max-width:100%' }, h('a', { href: u, target: '_blank', rel: 'noopener noreferrer', title: u }, `🔗 ${host(u)} ↗`)))) : null),
      acts.length ? h('div', { class: 'ta' }, acts) : null);
  };
  const weekStrip = () => { const ws = weekStart(UI.date); const today = todayStr();
    return h('div', { class: 'card strip mb' }, [0, 1, 2, 3, 4, 5, 6].map((i) => { const d = addDays(ws, i), list = tasksOn(d); const un = list.filter((k) => k.status !== 'done').length; const mins = list.reduce((a, k) => a + minutesOf(k), 0); const dues = D.tasks.filter((k) => who().includes(k.child) && k.due === d).length;
      const subs = [...new Set(list.map((k) => skey(k.subject)))];
      return h('button', { type: 'button', class: `sday ${d === today ? 'today' : ''} ${d < today ? 'past' : ''}`, 'aria-current': d === UI.date ? 'date' : null, 'aria-label': `${fmtLong(d)}: ${t('{0} task(s)', list.length)}`, onclick: () => { UI.date = d; render(); } },
        h('div', { class: 'sd-top' }, h('span', { class: 'sd-w' }, dowS(i + 1)), h('span', { class: 'sd-n tab' }, parse(d).getDate())),
        list.length ? h('span', { class: `sd-c ${d < today && un ? 't-bad' : un ? 't-mid' : 't-ok'}` }, un ? t('{0} to do', un) : t('All done ✓')) : h('span', { class: 'sd-c muted' }, '–'),
        
        subs.length ? h('span', { class: 'sd-dots', 'aria-hidden': 'true' }, subs.slice(0, 6).map((s) => h('i', { class: `sub-${s}` }))) : null,
        dues ? h('span', { class: 'sd-due', title: t('{0} due', dues) }, `📌 ${dues}`, h('span', { class: 'sdl' }, ` ${t('due')}`)) : null); })); };
  const deadlinePanel = (date) => { const end = addDays(date, 6); const ks = D.tasks.filter((k) => who().includes(k.child) && k.due && ((k.due >= date && k.due <= end) || (k.due < date && k.status !== 'done' && date === todayStr()))).sort((a, b) => a.due.localeCompare(b.due) || a.date.localeCompare(b.date));
    if (!ks.length) return null; const groups = new Map(); ks.forEach((k) => { if (!groups.has(k.due)) groups.set(k.due, []); groups.get(k.due).push(k); }); const showWho = who().length > 1;
    return h('section', { class: 'card dlp' }, h('div', { class: 'dlh' }, h('b', null, `📌 ${t('Deadlines this week')}`), h('span', { class: 'muted small' }, t('{0} task(s)', ks.length))),
      [...groups].map(([due, arr]) => h('div', { class: 'dlg' }, h('div', { class: `dld ${due < todayStr() ? 't-bad' : due === todayStr() ? 't-bad' : ''}` }, `${fmtDay(due)}${due === todayStr() ? ` · ${t('today')}` : ''}`),
        arr.map((k) => h('button', { type: 'button', class: `dlr sub-${skey(k.subject)} ${k.status === 'done' ? 'is-done' : ''}`, onclick: () => { UI.date = k.date; render(); } }, h('i'), h('span', { class: 'dlt' }, k.title, showWho ? h('small', null, ` · ${NAME(k.child)}`) : null),
          h('span', { class: `dls ${k.status === 'done' ? 't-ok' : (k.date > k.due && k.child !== MOM) || k.due < todayStr() ? 't-bad' : 'muted'}` }, k.status === 'done' ? '✓' : t('do {0}', fmtDay(k.date))))))));
  };
  const pages = {};
  pages.today = () => {
    const date = UI.date, today = todayStr(), list = tasksOn(date), isToday = date === today; const showWho = who().length > 1; const P = UI.role !== 'parent' ? pointsOf(UI.role) : null;
    
    const over = isToday ? D.tasks.filter((k) => who().includes(k.child) && isOverdue(k) && !k.repeat).sort((a, b) => (a.due || '9').localeCompare(b.due || '9') || a.date.localeCompare(b.date) || byTime(a, b)) : [];
    const cls = who().flatMap((c) => blocksOn(c, date).map((b) => ({ ...b, c })));
    const momIn = UI.role === 'parent' && who().includes(MOM); const momOnly = momIn && who().length === 1;
    const ws2 = who().filter((c) => c !== MOM); const mine = (k) => ws2.includes(k.child);
    const secMom = momIn ? D.tasks.filter((k) => k.child === MOM && (k.status !== 'done' ? (k.due || k.date) <= addDays(date, 14) : (k.doneAt || '').slice(0, 10) === todayStr() || k.date === date)).sort((a, b) => (a.status === 'done' ? 1 : 0) - (b.status === 'done' ? 1 : 0) || (a.due || a.date).localeCompare(b.due || b.date) || byTime(a, b)) : [];
    const isOver = (k) => k.status !== 'done' && !k.repeat && (k.due ? k.due < today : k.date < today);
    const secOver = isToday ? D.tasks.filter((k) => mine(k) && isOver(k)).sort((a, b) => byTeacher(a, b) || (a.due || a.date).localeCompare(b.due || b.date) || byTime(a, b)) : [];
    const secDue = (isToday ? D.tasks.filter((k) => mine(k) && !k.repeat && !isOver(k) && (k.date === date || (k.date < date && k.status !== 'done'))) : list.filter((k) => !k.repeat && mine(k))).sort((a, b) => (a.status === 'done' ? 1 : 0) - (b.status === 'done' ? 1 : 0) || byTeacher(a, b) || byTime(a, b) || (a.due || '9').localeCompare(b.due || '9'));
    const secDaily = list.filter((k) => k.repeat && mine(k)).sort((a, b) => (a.status === 'done' ? 1 : 0) - (b.status === 'done' ? 1 : 0) || byTime(a, b));
    const allT = [...secOver, ...secDue, ...secDaily]; const done = allT.filter((k) => k.status === 'done').length, doing = allT.filter((k) => k.status === 'doing').length, late = secOver.length;
    const out = [pageHead(isToday ? t('Today') : fmtDay(date), fmtLong(date), h('button', { class: 'btn secondary', onclick: () => { UI.sheet = date; UI.page = 'sheet'; render(); }, title: t('Printable page for this day') }, `🖨 ${t('Print sheet')}`), h('button', { class: 'btn primary', onclick: () => taskForm(null, { date }) }, `+ ${t('Add task')}`)),
      h('div', { class: 'toolbar' }, h('button', { class: 'btn secondary icon', 'aria-label': t('Previous week'), onclick: () => { UI.date = addDays(date, -7); render(); } }, '‹'), inp({ type: 'date', value: date, required: true, style: 'width:auto', 'aria-label': t('Choose a day'), onchange: (e) => { if (e.target.value) { UI.date = e.target.value; render(); } } }),
        h('button', { class: 'btn secondary icon', 'aria-label': t('Next week'), onclick: () => { UI.date = addDays(date, 7); render(); } }, '›'), !isToday ? h('button', { class: 'btn ghost sm', onclick: () => { UI.date = today; render(); } }, t('Back to today')) : null, kidSelect()),
      weekStrip()];
    if (allT.length) out.push(h('div', { class: 'card pad mb' }, h('div', { class: 'row between' }, h('p', { class: 'soft' }, t('Done'), ' ', h('b', { style: 'font-size:1.5rem;color:var(--ink)' }, done), `/${allT.length}`), h('div', { class: 'row small' }, doing ? h('span', { class: 'badge b-yellow' }, t('{0} doing', doing)) : null, late ? h('span', { class: 'badge b-red' }, t('{0} late', late)) : null, P ? h('button', { class: 'badge b-yellow', style: 'border:0', onclick: () => { UI.page = 'rewards'; render(); } }, `⭐ ${P.balance}`) : null)),
      h('div', { class: 'prog', style: 'margin-top:12px', role: 'progressbar', 'aria-valuenow': pct(done, allT.length), 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': t('Progress today') }, h('i', { style: `width:${pct(done, allT.length)}%` }))));
    const sec = (cls, icon, title, hint, arr, emptyTxt) => h('section', { class: `tsec ${cls}` }, h('div', { class: 'tsec-h' }, h('span', { class: 'tsec-i', 'aria-hidden': 'true' }, icon), h('h2', null, title), h('span', { class: 'tsec-n' }, `${arr.filter((k) => k.status === 'done').length}/${arr.length}`), hint ? h('span', { class: 'muted small tsec-hint' }, hint) : null),
      arr.length ? h('ol', { class: 'items' }, teacherRuns(arr).map((k) => k.head ? h('li', { class: 'trun', 'aria-hidden': 'true' }, `👩‍🏫 ${k.head}`) : taskItem(k, { showWho, showDate: k.date !== date }))) : h('p', { class: 'muted small tsec-empty' }, emptyTxt));
    const emptyEl = h('div', { class: 'empty' }, svg(ART.empty), h('h3', null, t('No tasks on this day')), h('p', null, t('Add a task so everyone knows what to study.')), h('button', { class: 'btn primary', onclick: () => taskForm(null, { date }) }, `+ ${t('Add task')}`));
    const momSec = momIn ? sec('s-mom', '👩', t("Mom's tasks"), t('Preparing materials for the kids – with deadlines'), secMom, t('Nothing to prepare right now.')) : null;
    const listEl = momOnly ? momSec : !secOver.length && !secDue.length && !secDaily.length && !secMom.length ? emptyEl : h('div', { class: 'stackc', style: 'gap:18px' }, momSec,
      isToday ? sec('s-over', '⏰', t('Overdue'), t('Deadline has passed – do these first'), secOver, t('Nothing overdue. Well done!')) : null,
      sec('s-due', '📌', isToday ? t('Due today') : t('Homework'), isToday ? t('Homework planned for today or due today') : null, secDue, t('No homework for this day.')),
      sec('s-daily', '🔁', t('Daily tasks'), t('Practice that repeats every week'), secDaily, t('No daily practice on this day.')));
    const extra = cls.filter((b) => !/vinschool/i.test(b.t)).sort((a, b) => a.s.localeCompare(b.s));
    const clsIcon = (n) => (/piano|music|nhạc|đàn/i.test(n) ? '🎹' : /bóng|basket|cầu lông|badminton|bơi|swim|football|sport|võ/i.test(n) ? '🏀' : /debate/i.test(n) ? '🎤' : /writing|viết/i.test(n) ? '✍️' : /science|khoa/i.test(n) ? '🔬' : /math|toán/i.test(n) ? '📐' : /english|cindy|anh|esl|efl/i.test(n) ? '📖' : '🎒');
    const clsBox = extra.length ? h('section', { class: 'xcls' }, h('div', { class: 'xcls-h' }, h('b', null, `🎒 ${t('Extra classes')}`), h('span', { class: 'muted small' }, fmtDay(date))),
      extra.map((b, i) => h('div', { class: `xc xc${i % 5}` }, h('span', { class: 'xc-i', 'aria-hidden': 'true' }, clsIcon(b.t)), h('div', { class: 'xc-b' }, h('div', { class: 'xc-n' }, b.t), h('div', { class: 'xc-t tab' }, `${b.s} – ${b.e}`)), showWho ? h('span', { class: 'xc-w' }, NAME(b.c)) : null))) : null;
    const side = [clsBox, deadlinePanel(date)].filter(Boolean);
    out.push(h('div', { class: 'daygrid' }, h('div', { style: 'min-width:0' }, listEl), side.length ? h('div', { class: 'side' }, side) : null));
    if (D.links.length) out.push(resourcesBox());
    return out;
  };
  const resourcesBox = () => h('section', { class: 'card pad', style: 'margin-top:24px' }, h('h2', { style: 'font-size:1rem;margin-bottom:10px' }, t('Useful links')), h('ul', { class: 'links' }, D.links.map((l) => h('li', { style: 'max-width:100%;min-width:0' }, h('a', { href: l.url, target: '_blank', rel: 'noopener noreferrer', title: l.note || l.url }, `🔗 ${l.name} ↗`)))));

  /* ---------- Month ---------- */
  pages.month = () => {
    const ym = UI.month, today = todayStr(); const first = `${ym}-01`; const dim = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5)), 0).getDate(); const last = `${ym}-${pad(dim)}`;
    const shift = (n) => { const d = parse(first); d.setMonth(d.getMonth() + n); UI.month = ymd(d).slice(0, 7); render(); };
    const weeks = []; for (let d = weekStart(first); d <= last; d = addDays(d, 7)) weeks.push([0, 1, 2, 3, 4, 5, 6].map((i) => addDays(d, i)));
    return [pageHead(monthLabel(ym), t('Tap a day to see its tasks'), h('button', { class: 'btn primary', onclick: () => taskForm(null, { date: today.slice(0, 7) === ym ? today : first }) }, `+ ${t('Add task')}`)),
      h('div', { class: 'toolbar' }, h('button', { class: 'btn secondary sm', onclick: () => shift(-1) }, `‹ ${t('Previous month')}`), ym !== today.slice(0, 7) ? h('button', { class: 'btn ghost sm', onclick: () => { UI.month = today.slice(0, 7); render(); } }, t('This month')) : null, h('button', { class: 'btn secondary sm', onclick: () => shift(1) }, `${t('Next month')} ›`), kidSelect()),
      h('div', { class: 'card', style: 'overflow:hidden' }, h('div', { class: 'mhead' }, [1, 2, 3, 4, 5, 6, 7].map((i) => h('div', null, dowS(i)))), weeks.map((w) => h('div', { class: 'mrow' }, w.map((d) => { const list = tasksOn(d); const un = list.filter((k) => k.status !== 'done').length; const inM = d.startsWith(ym);
        return h('button', { type: 'button', class: `mcell ${inM ? '' : 'out'} ${d === today ? 'today' : ''}`, 'aria-label': `${fmtLong(d)}: ${t('{0} task(s)', list.length)}`, onclick: () => { UI.date = d; UI.page = 'today'; render(); window.scrollTo(0, 0); } },
          h('div', { class: 'mtop' }, h('span', { class: 'mnum' }, parse(d).getDate()), d < today && un ? h('span', { class: 'mdot', title: t('{0} not finished', un) }) : null),
          list.length ? h('div', { class: `mcnt ${un ? 't-mid' : 't-ok'}` }, t('{0} task(s)', list.length)) : null,
          h('ul', { class: 'mchips' }, list.slice(0, 3).map((k) => h('li', { class: k.status }, `${k.start ? `${k.start} ` : ''}${k.title}`)), list.length > 3 ? h('li', { style: 'background:transparent;color:var(--faint)' }, t('+{0} more', list.length - 3)) : null)); })))),
      h('p', { class: 'small muted row', style: 'margin-top:12px;gap:16px' }, h('span', null, '● ', t('Past day with unfinished tasks')), h('span', null, t('Yellow = doing · Green = done')))];
  };

  /* ---------- Performance (parent) ---------- */
  pages.perf = () => {
    const ws = weekStart(UI.perf), we = addDays(ws, 6), today = todayStr(); const inW = (k, a) => k.date >= a && k.date <= addDays(a, 6); const shift = (n) => { UI.perf = addDays(ws, n); render(); };
    const all = D.tasks.filter((k) => inW(k, ws)); const team = stats(all); const lv = (p) => (p === null ? '' : p >= 80 ? 't-ok' : p >= 50 ? 't-mid' : 't-bad'); const lvb = (p) => (p >= 80 ? 'l1' : p >= 50 ? 'l2' : 'l3');
    const rows = KIDS.map((c) => { const cur = stats(all.filter((k) => k.child === c)), prev = stats(D.tasks.filter((k) => k.child === c && inW(k, addDays(ws, -7)))); return { c, ...cur, change: cur.completion !== null && prev.completion !== null ? cur.completion - prev.completion : null }; }).sort((a, b) => (b.completion ?? -1) - (a.completion ?? -1));
    const subj = {}; all.forEach((k) => { const x = (subj[k.subject || t('Other')] ||= { n: 0, d: 0, m: 0 }); x.n++; if (k.status === 'done') { x.d++; x.m += minutesOf(k); } });
    return [pageHead(t('Weekly performance'), `${fmtDay(ws)} – ${fmtDay(we)} · ${t('Only parents can see this')}`),
      h('div', { class: 'toolbar' }, h('button', { class: 'btn secondary sm', onclick: () => shift(-7) }, `‹ ${t('Previous week')}`), !(today >= ws && today <= we) ? h('button', { class: 'btn ghost sm', onclick: () => { UI.perf = today; render(); } }, t('This week')) : null, h('button', { class: 'btn secondary sm', onclick: () => shift(7) }, `${t('Next week')} ›`)),
      h('div', { class: 'tiles' }, h('div', { class: 'card tile' }, h('p', { class: 'k' }, t('Tasks this week')), h('p', { class: 'v tab' }, team.total)), h('div', { class: 'card tile' }, h('p', { class: 'k' }, t('Completed')), h('p', { class: `v tab ${lv(team.completion)}` }, team.total ? `${team.completion}%` : '—'), h('p', { class: 's' }, `${team.done}/${team.total}`)),
        h('div', { class: 'card tile' }, h('p', { class: 'k' }, t('Finished on time')), h('p', { class: 'v tab' }, team.done ? `${team.onTimeRate}%` : '—'), h('p', { class: 's' }, t('{0} on time · {1} late', team.onTime, team.doneLate))), h('div', { class: 'card tile' }, h('p', { class: 'k' }, t('Overdue, not finished')), h('p', { class: `v tab ${team.overdue ? 't-bad' : 't-ok'}` }, team.overdue)), h('div', { class: 'card tile' }, h('p', { class: 'k' }, t('Study time done')), h('p', { class: 'v tab' }, dur(team.mins)))),
      h('div', { class: 'tw' }, h('table', null, h('thead', null, h('tr', null, [t('Student'), t('Completed'), t('Total'), t('Done'), t('On time'), t('Late'), t('Doing'), t('Overdue'), t('vs last week')].map((x, i) => h('th', { class: i > 1 ? 'r' : '' }, x)))),
        h('tbody', null, rows.map((r) => h('tr', null, h('td', null, h('button', { class: 'btn ghost sm', style: 'font-weight:600', onclick: () => { UI.who = r.c; UI.date = ws > today || today > we ? ws : today; UI.page = 'today'; render(); } }, NAME(r.c))),
          h('td', { style: 'min-width:190px' }, r.total ? h('div', { class: 'row', style: 'flex-wrap:nowrap' }, h('div', { class: `prog ${lvb(r.completion)}`, style: 'flex:1', role: 'progressbar', 'aria-valuenow': r.completion, 'aria-valuemin': 0, 'aria-valuemax': 100 }, h('i', { style: `width:${r.completion}%` })), h('b', { class: `tab ${lv(r.completion)}`, style: 'width:42px;text-align:right' }, `${r.completion}%`)) : h('span', { class: 'muted small' }, t('No tasks this week'))),
          [r.total, r.done, r.onTime, r.doneLate, r.doing, r.overdue].map((n, i) => h('td', { class: `r tab ${i === 5 && n ? 't-bad' : ''}` }, n)), h('td', { class: 'r tab' }, r.change === null ? '—' : r.change > 0 ? h('span', { class: 't-ok' }, `▲ ${r.change}%`) : r.change < 0 ? h('span', { class: 't-bad' }, `▼ ${Math.abs(r.change)}%`) : '= 0%')))))),
      Object.keys(subj).length ? h('div', { class: 'tw', style: 'margin-top:20px' }, h('table', null, h('thead', null, h('tr', null, [t('Subject'), t('Tasks done'), t('Study time done')].map((x) => h('th', null, x)))), h('tbody', null, Object.entries(subj).map(([s, v]) => h('tr', null, h('td', null, s), h('td', null, `${v.d} / ${v.n}`), h('td', null, dur(v.m))))))) : null,
      h('p', { class: 'small muted', style: 'margin-top:12px' }, t('"On time" = marked Done on or before the task day. "Overdue" = the day has passed and it is not done. Colours: green ≥ 80%, yellow 50–79%, orange < 50%.'))];
  };

  /* ---------- Resources ---------- */
  pages.resources = () => { const par = UI.role === 'parent';
    const edit = (l) => { const n = inp({ value: l ? l.name : '', placeholder: t('e.g. Vinschool portal') }), u = inp({ type: 'url', value: l ? l.url : '', placeholder: 'https://…' }), no = inp({ value: l ? l.note || '' : '' }); const er = h('div', { class: 'err' });
      modal(l ? t('Edit link') : t('Add link'), h('div', { class: 'stackc' }, er, field(t('Name'), n), field(t('Web address'), u), field(t('Note (optional)'), no)), [{ label: t('Cancel') }, { label: t('Save'), primary: true, fn: () => { const url = safeUrl(u.value); if (!n.value.trim() || !url) { er.textContent = t('Enter a name and a web address starting with http or https.'); return false; } if (l) Object.assign(l, { name: n.value.trim(), url, note: no.value.trim() }); else D.links.push({ id: uid(), name: n.value.trim(), url, note: no.value.trim() }); rerender(); } }]); };
    return [pageHead(t('Useful links'), t('Study websites and documents everyone may need'), par ? h('button', { class: 'btn primary', onclick: () => edit(null) }, `+ ${t('Add link')}`) : null),
      D.links.length ? h('div', { class: 'tw' }, h('table', null, h('thead', null, h('tr', null, [t('Name'), t('Web address'), t('Note'), ''].map((x) => h('th', null, x)))), h('tbody', null, D.links.map((l) => h('tr', null, h('td', null, h('b', { style: 'color:var(--ink)' }, l.name)), h('td', null, h('a', { href: l.url, target: '_blank', rel: 'noopener noreferrer', style: 'color:var(--bloom-t)' }, `${host(l.url)} ↗`)), h('td', null, l.note || ''), h('td', { class: 'r' }, par ? h('div', { class: 'row', style: 'justify-content:flex-end;flex-wrap:nowrap' }, h('button', { class: 'btn ghost sm', onclick: () => edit(l) }, t('Edit')), h('button', { class: 'btn ghost sm', onclick: () => confirmBox(t('Delete this link?'), l.name, 'Delete', () => { D.links = D.links.filter((x) => x.id !== l.id); rerender(); }, true) }, t('Delete'))) : null))))))
        : h('div', { class: 'empty' }, svg(ART.empty), h('h3', null, t('No links yet')), h('p', null, par ? t('Add the websites your children use for study.') : t('Your parent can add useful links here.')), par ? h('button', { class: 'btn primary', onclick: () => edit(null) }, `+ ${t('Add link')}`) : null)];
  };

  /* ---------- Students & timetable (parent) ---------- */
  pages.students = () => {
    const addBlock = () => { const c = h('select', { class: 'input' }, KIDS.map((x) => h('option', { value: x }, NAME(x)))), d = h('select', { class: 'input' }, [1, 2, 3, 4, 5, 6, 7].map((i) => h('option', { value: i }, dowL(i)))), s = inp({ type: 'time', value: '17:00', required: true }), e = inp({ type: 'time', value: '18:00', required: true }), n = inp({ placeholder: t('e.g. Piano') }); const er = h('div', { class: 'err' });
      modal(t('Add class or activity'), h('div', { class: 'stackc' }, er, h('div', { class: 'fgrid' }, field(t('Student'), c), field(t('Weekday'), d)), h('div', { class: 'fgrid' }, field(t('Start'), s), field(t('End'), e)), field(t('Name'), n)), [{ label: t('Cancel') }, { label: t('Add'), primary: true, fn: () => { if (!n.value.trim() || !s.value || !e.value || hm(e.value) <= hm(s.value)) { er.textContent = t('Enter a name and a start time before the end time.'); return false; } D.blocks.push({ id: uid(), c: c.value, day: Number(d.value), s: s.value, e: e.value, t: n.value.trim() }); rerender(); } }]); };
    return [pageHead(t('Students'), t('Names, points and the weekly timetable of classes'), h('button', { class: 'btn secondary', onclick: addBlock }, `+ ${t('Add class or activity')}`)),
      h('div', { class: 'tiles', style: 'grid-template-columns:repeat(auto-fit,minmax(260px,1fr))' }, KIDS.map((c) => { const P = pointsOf(c); const nm = inp({ value: D.names[c], 'aria-label': t('Name'), onchange: (e) => { D.names[c] = e.target.value.trim() || c; rerender(); } });
        return h('div', { class: 'card tile' }, h('div', { class: 'row' }, h('span', { class: `avatar av-${c}` }, (D.names[c] || c)[0].toUpperCase()), h('div', { style: 'flex:1' }, nm)), h('p', { class: 's', style: 'margin-top:8px' }, t('{0} tasks · {1} finished', D.tasks.filter((k) => k.child === c).length, D.tasks.filter((k) => k.child === c && k.status === 'done').length)), h('p', { class: 'v tab' }, `⭐ ${P.balance}`)); })),
      h('h2', { style: 'font-size:1.1rem;margin:8px 0 12px' }, t('Weekly timetable')),
      h('div', { class: 'tw' }, h('table', null, h('thead', null, h('tr', null, [t('Student'), t('Day'), t('Time'), t('Class or activity'), ''].map((x) => h('th', null, x)))), h('tbody', null, D.blocks.slice().sort((a, b) => a.c.localeCompare(b.c) || a.day - b.day || a.s.localeCompare(b.s)).map((b) => h('tr', null, h('td', null, NAME(b.c)), h('td', null, dowL(b.day)), h('td', { class: 'tab' }, `${b.s}–${b.e}`), h('td', null, b.t), h('td', { class: 'r' }, h('button', { class: 'btn ghost sm', onclick: () => { D.blocks = D.blocks.filter((x) => x.id !== b.id); rerender(); } }, t('Delete')))))))),
      h('p', { class: 'small muted', style: 'margin-top:10px' }, t('Classes show on the Today page and are checked for overlaps when you add a task.')),
      h('div', { class: 'card pad', style: 'margin-top:24px' }, h('h3', { style: 'font-size:1rem' }, t('Start over')), h('p', { class: 'small soft', style: 'margin:4px 0 12px' }, t('Delete every task, point and request stored in this browser. The timetable and rewards go back to the defaults.')), h('button', { class: 'btn danger', onclick: () => confirmBox(t('Clear all data?'), t('This deletes every task, point and request in this browser.'), 'Delete everything', () => { D = fresh(); ensure(); rerender(); toast(t('All data cleared.')); }, true) }, t('Clear all data')))];
  };
