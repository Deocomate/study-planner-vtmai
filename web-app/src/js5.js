
  /* ---------- hour timeline (tasks + classes, with a red "now" line) ---------- */
  const timeline = (date, list, cls, showWho) => {
    const H = 56; const timed = list.filter((k) => k.start); const mins = [...timed.map((k) => hm(k.start)), ...cls.map((b) => hm(b.s))], maxs = [...timed.map((k) => endMin(k)), ...cls.map((b) => hm(b.e))];
    const from = Math.min(7, Math.floor(Math.min(...(mins.length ? mins : [420])) / 60)), to = Math.max(21, Math.ceil(Math.max(...(maxs.length ? maxs : [1260])) / 60)); const total = (to - from) * H; const y = (m) => ((m - from * 60) * H) / 60;
    const kidCol = { ben: 'var(--c-maths)', shin: 'var(--c-x3)' };
    const box = h('div', { class: 'tl', style: `height:${total}px`, role: 'img', 'aria-label': t('Hour-by-hour view of the day') });
    for (let hr = from; hr < to; hr++) box.append(h('div', { class: 'tl-h', style: `top:${(hr - from) * H}px;height:${H}px` }, h('span', null, `${pad(hr)}:00`)));
    cls.forEach((b) => box.append(h('div', { class: 'tl-ev cls', style: `top:${y(hm(b.s))}px;height:${Math.max(18, y(hm(b.e)) - y(hm(b.s)))}px` }, h('b', null, b.t), showWho ? ` · ${NAME(b.c)}` : null)));
    timed.forEach((k) => box.append(h('button', { type: 'button', class: `tl-ev ${k.status}`, style: `top:${y(hm(k.start))}px;height:${Math.max(22, y(endMin(k)) - y(hm(k.start)))}px;--c:${showWho ? kidCol[k.child] : `var(--c-${skey(k.subject)})`}`, onclick: () => taskForm(k), title: `${k.start} ${k.title}` }, h('b', null, k.title), h('span', null, ` ${k.start}`))));
    if (date === todayStr() && nowMin() >= from * 60 && nowMin() <= to * 60) box.append(h('div', { class: 'tl-now', style: `top:${y(nowMin())}px` }));
    return h('aside', { class: 'card tl-wrap', 'aria-label': t('Timeline') }, h('div', { class: 'row between', style: 'padding:12px 14px;border-bottom:1px solid var(--line)' }, h('b', null, t('Timeline')), h('span', { class: 'small muted' }, t('{0} timed task(s)', timed.length))), box);
  };

  /* ---------- reminders: 10 minutes before a task starts + a morning summary ---------- */
  const SENT_KEY = 'sp-sent';
  const sentSet = () => { try { return new Set(JSON.parse(LS.get(SENT_KEY, '[]'))); } catch (e) { return new Set(); } };
  const notifOK = () => { try { return 'Notification' in window && Notification.permission === 'granted'; } catch (e) { return false; } };
  const notify = (title, body) => { toast(`🔔 ${title}`); try { if (notifOK()) new Notification(title, { body }); } catch (e) { /* not allowed here */ } };
  const checkReminders = () => { const sent = sentSet(), today = todayStr(), now = nowMin(); let changed = false; const mine = D.tasks.filter((k) => who().includes(k.child) && k.date === today && k.status !== 'done');
    for (const k of mine) { if (!k.start) continue; const key = `${k.id}|${today}|s`; const st = hm(k.start); if (now >= st - 10 && now < st + 5 && !sent.has(key)) { sent.add(key); changed = true; notify(t('Starting soon: {0}', k.title), `${k.start}${labelOf(k) ? ` · ${labelOf(k)}` : ''}`); } }
    const mk = `morning|${UI.role}|${today}`; if (now >= 420 && mine.length && !sent.has(mk)) { sent.add(mk); changed = true; notify(t('Good morning!'), t('You have {0} unfinished task(s) today.', mine.length)); }
    if (changed) LS.set(SENT_KEY, JSON.stringify([...sent].slice(-300))); };
  const askNotif = async () => { try { if (!('Notification' in window)) return toast(t('This browser cannot show notifications. Reminders appear inside the page.')); if (Notification.permission === 'denied') return toast(t('Notifications are blocked. Allow them in the site settings of your browser.'));
      const p = await Notification.requestPermission(); if (p === 'granted') { new Notification(t('Reminders are on'), { body: t('You get a reminder 10 minutes before a task starts.') }); } render(); } catch (e) { toast(t('Notifications are not available here. Reminders appear inside the page.')); } };

  VI_FILL();
  /* pickers added later (e.g. a field shown after a choice) get the custom UI too */
  new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1) { if (n.matches('select, input[type=date], input[type=time]')) enhance(n); else enhanceIn(n); } }).observe(document.body, { childList: true, subtree: true });
  SRV_READY.then(() => { render(); migrateFiles(); try { if (!sessionStorage.getItem('sp-splash')) { sessionStorage.setItem('sp-splash', '1'); showSplash(); } } catch (e) { showSplash(); } checkReminders(); setInterval(() => { checkReminders(); if (UI.page === 'today' && UI.date === todayStr()) render(); }, 30000); });
})();
