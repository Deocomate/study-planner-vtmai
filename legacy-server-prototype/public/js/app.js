import { h, mount, state, get, post, api, modal, toast, fail, action, field, fmtDT } from './ui.js';
import { renderChildBoard } from './child.js';
import { renderParent } from './parent.js';

const app = document.getElementById('app');
let unreadTimer = null, lastRender = Date.now();

// ---------- routing ----------
const parseHash = () => {
  const [path, qs] = (location.hash.replace(/^#/, '') || '/').split('?');
  return { parts: path.split('/').filter(Boolean), query: Object.fromEntries(new URLSearchParams(qs || '')) };
};
export const go = (path) => { if (location.hash === `#${path}`) route(); else location.hash = `#${path}`; };

async function boot() {
  const me = await api('GET', '/api/me', undefined, { quiet401: true }).catch(() => ({ user: null }));
  if (me.user) Object.assign(state, { user: me.user, csrf: me.csrf, children: me.children, config: me.config, today: me.today });
  else { state.user = null; state.needsSetup = !!me.needs_setup; }
  route();
}
async function route() {
  lastRender = Date.now();
  const { parts, query } = parseHash();
  if (!state.user) return state.needsSetup ? renderSetup() : renderLogin();
  if (parts[0] === 'login' || parts[0] === 'setup' || !parts.length) return go(defaultPath());
  const isParent = state.user.role === 'parent';
  const shell = buildShell(parts);
  const main = shell.main;
  mount(app, shell.root);
  main.append(h('div', { class: 'spinner' }, 'Loading…'));
  try {
    if (parts[0] === 'parent') {
      if (!isParent) return go(defaultPath());
      await renderParent(main, parts[1] || 'overview', query);
    } else if (['ben', 'shin'].includes(parts[0])) {
      if (!isParent && state.user.child_id !== parts[0]) return go(defaultPath());
      await renderChildBoard(main, parts[0], parts[1] || 'today', query);
    } else go(defaultPath());
  } catch (e) { if (e.status !== 401) { mount(main, h('div', { class: 'card alert' }, h('h2', null, 'This page could not be loaded'), h('p', null, e.message), h('button', { class: 'btn', onclick: () => route() }, 'Try again'))); } }
  refreshBell();
}
const defaultPath = () => (state.user.role === 'parent' ? '/parent/overview' : `/${state.user.child_id}/today`);
window.addEventListener('hashchange', route);
document.addEventListener('visibilitychange', () => { if (!document.hidden && state.user && Date.now() - lastRender > 5 * 60000) route(); });

// ---------- shell ----------
function buildShell(parts) {
  const isParent = state.user.role === 'parent';
  const accent = parts[0] === 'ben' ? 'var(--ben)' : parts[0] === 'shin' ? 'var(--shin)' : 'var(--parent)';
  document.documentElement.style.setProperty('--accent', accent);
  const areas = [];
  const link = (href, text, cls, current) => h('a', { class: `area ${cls}`, href: `#${href}`, 'aria-current': current ? 'page' : null }, text);
  if (isParent) {
    areas.push(link('/ben/today', "Ben's Board", 'a-ben', parts[0] === 'ben'), link('/shin/today', "Shin's Board", 'a-shin', parts[0] === 'shin'), link('/parent/overview', 'Parent Dashboard', 'a-parent', parts[0] === 'parent'));
  } else {
    areas.push(link(`/${state.user.child_id}/today`, `${state.user.display_name}'s Board`, `a-${state.user.child_id}`, true));
  }
  const bell = h('button', { class: 'icon-btn bell', id: 'bell', type: 'button', 'aria-label': 'Notifications', onclick: showNotifications }, '🔔');
  const root = h('div', null,
    h('header', { class: 'topbar' }, h('div', { class: 'topbar-in' },
      h('span', { class: 'brand' }, '📚 Study Planner'), h('nav', { class: 'areas', 'aria-label': 'Main areas' }, areas), h('span', { class: 'spacer' }),
      h('span', { id: 'save-indicator', 'aria-live': 'polite', 'data-kind': 'idle' }), bell,
      h('button', { class: 'btn small', type: 'button', onclick: accountMenu }, `${state.user.display_name} ▾`))),
    h('main', { id: 'main', tabindex: '-1' }));
  return { root, main: root.querySelector('main') };
}
async function refreshBell() {
  clearTimeout(unreadTimer);
  try {
    const r = await get('/api/notifications');
    const bell = document.getElementById('bell'); if (!bell) return;
    bell.querySelector('.count')?.remove();
    if (r.unread) bell.append(h('span', { class: 'count', 'aria-label': `${r.unread} unread` }, r.unread > 9 ? '9+' : r.unread));
  } catch {}
  unreadTimer = setTimeout(refreshBell, 60000);
}
async function showNotifications() {
  const r = await get('/api/notifications');
  const body = h('div', null, r.items.length ? r.items.map((n) => h('div', { class: `notif ${n.read_at ? '' : 'unread'}` },
    h('strong', null, n.title), n.body ? h('div', { class: 'small' }, n.body) : null, h('div', { class: 'small muted' }, fmtDT(n.created_at.slice(0, 16)) ? new Date(n.created_at).toLocaleString('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'medium', timeStyle: 'short' }) : ''))) : h('p', { class: 'muted' }, 'No notifications yet.'));
  modal({ title: 'Notifications', body, actions: [{ label: 'Mark all as read', onclick: async () => { await post('/api/notifications/read'); refreshBell(); } }, { label: 'Close', primary: true, onclick: () => {} }] });
}
function accountMenu() {
  const cur = h('input', { type: 'password', autocomplete: 'current-password' }), neu = h('input', { type: 'password', autocomplete: 'new-password' });
  modal({ title: 'My account', body: h('div', null,
    h('p', null, `Signed in as ${state.user.display_name}.`),
    h('h3', null, 'Change my password'), field('Current password', cur), field(state.user.role === 'parent' ? 'New password (at least 8 characters)' : 'New PIN or password (at least 6 characters)', neu)),
    actions: [
      { label: 'Sign out', onclick: async () => { await post('/api/logout'); state.user = null; state.csrf = null; location.hash = '#/login'; route(); } },
      { label: 'Change password', primary: true, onclick: async () => { const r = await post('/api/me/password', { current: cur.value, new: neu.value }); state.csrf = r.csrf; toast('Password changed.'); } }] });
}

// ---------- login ----------
function renderLogin() {
  document.documentElement.style.setProperty('--accent', 'var(--parent)');
  let who = null;
  const pw = h('input', { type: 'password', autocomplete: 'current-password', id: 'pw', required: true });
  const err = h('p', { class: 'warn-line', role: 'alert' });
  const form = h('form', { class: 'stack hidden' }, field('Password or PIN', pw), err, h('button', { class: 'btn primary big', type: 'submit' }, 'Sign in'));
  const choices = [['ben', 'Ben', 'var(--ben)'], ['shin', 'Shin', 'var(--shin)'], ['parent', 'Parent', 'var(--parent)']];
  const row = h('div', { class: 'who', role: 'group', 'aria-label': 'Who is signing in?' });
  const draw = () => mount(row, choices.map(([id, name, color]) => h('button', { type: 'button', style: { '--accent': color }, 'aria-pressed': who === id ? 'true' : 'false', onclick: () => {
    who = id; draw(); document.documentElement.style.setProperty('--accent', color); form.classList.remove('hidden'); pw.focus(); } },
    h('span', { class: 'avatar', style: { background: color } }, name[0]), name)));
  draw();
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); err.textContent = '';
    if (!who) { err.textContent = 'Choose who you are first.'; return; }
    try {
      const r = await api('POST', '/api/login', { username: who, password: pw.value }, { quiet401: true });
      state.csrf = r.csrf;
      const me = await get('/api/me'); Object.assign(state, { user: me.user, csrf: me.csrf, children: me.children, config: me.config, today: me.today });
      go(defaultPath()); route();
    } catch (ex) { err.textContent = ex.message; pw.select(); }
  });
  mount(app, h('main', { id: 'main', class: 'login-wrap' }, h('div', { class: 'card stack' }, h('h1', null, '📚 Family Study Planner'), h('p', { class: 'muted' }, 'Who is studying today?'), row, form)));
}

// ---------- first-time setup ----------
async function renderSetup() {
  const st = await get('/api/setup/status');
  const f = { pp: h('input', { type: 'password', autocomplete: 'new-password' }), em: h('input', { type: 'email', placeholder: 'you@example.com' }), bp: h('input', { type: 'password', autocomplete: 'off' }), sp: h('input', { type: 'password', autocomplete: 'off' }), code: h('input', { type: 'password' }), demo: h('input', { type: 'checkbox', checked: true }) };
  const err = h('p', { class: 'warn-line', role: 'alert' });
  const form = h('form', { class: 'stack' },
    h('p', null, 'Welcome! This one-time step creates the three sign-ins for your family. Nothing is shared with anyone.'),
    field('Your password (at least 8 characters)', f.pp), field('Your email address (for reminders and summaries)', f.em, 'Optional now, you can add it later in Settings.'),
    field("Ben's PIN or password (at least 6 characters)", f.bp), field("Shin's PIN or password (at least 6 characters)", f.sp),
    st.needs_code ? field('Setup code', f.code, 'The SETUP_CODE you set on the server.') : null,
    st.production_without_code ? h('p', { class: 'warn-line' }, 'This server is public but has no SETUP_CODE. Set one in the server settings first (see the setup guide).') : null,
    h('label', { class: 'check' }, f.demo, 'Add demo tasks for this week so I can try everything (you can remove them in one click)'), err,
    h('button', { class: 'btn primary big', type: 'submit' }, 'Create my family'));
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); err.textContent = '';
    try {
      const r = await api('POST', '/api/setup', { parent_password: f.pp.value, parent_email: f.em.value, ben_password: f.bp.value, shin_password: f.sp.value, setup_code: f.code.value, load_demo: f.demo.checked }, { quiet401: true });
      state.csrf = r.csrf; const me = await get('/api/me'); Object.assign(state, { user: me.user, csrf: me.csrf, children: me.children, config: me.config, today: me.today, needsSetup: false });
      go('/parent/overview'); route();
    } catch (ex) { err.textContent = ex.message; }
  });
  mount(app, h('main', { id: 'main', class: 'login-wrap' }, h('div', { class: 'card' }, h('h1', null, '📚 Set up your Study Planner'), form)));
}

boot();
