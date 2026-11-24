// Download a planner sheet from a Google Drive / Google Sheets link (shared "Anyone with the link").
// Only Google download addresses built from the file id are fetched, never the pasted URL itself.

const ID = '[A-Za-z0-9_-]{10,}';

// → { type: 'sheet', id, gid } | { type: 'file', id } | null
export const parseDriveUrl = (raw) => {
  let u; try { u = new URL(String(raw || '').trim()); } catch (e) { return null; }
  if (!/(^|\.)google\.com$/i.test(u.hostname)) return null;
  const gidOf = () => { const m = /(?:^|[#&?])gid=(\d+)/.exec(`${u.search}${u.hash}`); return m ? m[1] : null; };
  let m;
  if ((m = new RegExp(`/spreadsheets/(?:u/[0-9]+/)?d/(${ID})`).exec(u.pathname))) return { type: 'sheet', id: m[1], gid: gidOf() };
  if ((m = new RegExp(`/file/(?:u/[0-9]+/)?d/(${ID})`).exec(u.pathname))) return { type: 'file', id: m[1] };
  const qid = u.searchParams.get('id');
  if (qid && new RegExp(`^${ID}$`).test(qid)) return { type: 'file', id: qid };
  return null;
};

const sheetXlsxUrl = (id) => `https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`;   // every tab, so each child's tab can be read
const fileUrl = (id) => `https://drive.google.com/uc?export=download&id=${id}`;

const grab = async (url, limit) => {
  const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(30000) });
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > limit) throw Object.assign(new Error('too_large'), { code: 413 });
  return { ok: r.ok, status: r.status, type: (r.headers.get('content-type') || '').toLowerCase(), buf };
};
const isHtml = (g) => g.type.includes('text/html') || /^\s*<(!doctype|html)/i.test(g.buf.subarray(0, 200).toString('utf8'));
const kindOf = (g) => (g.buf[0] === 0x50 && g.buf[1] === 0x4b ? 'xlsx' : 'csv');   // xlsx files are zip archives ("PK")

// → { kind: 'csv' | 'xlsx', data: Buffer }; throws Error with .code (400 bad link, 403 not shared, 413 too big)
export const fetchDrive = async (raw, limit = 20 * 1048576) => {
  const p = parseDriveUrl(raw);
  if (!p) throw Object.assign(new Error('bad_link'), { code: 400 });
  const tries = p.type === 'sheet' ? [sheetXlsxUrl(p.id)] : [fileUrl(p.id), sheetXlsxUrl(p.id)];   // a Drive link may point to a Google Sheet
  for (const url of tries) {
    const g = await grab(url, limit);
    if (g.ok && g.buf.length && !isHtml(g)) return { kind: kindOf(g), data: g.buf };
  }
  throw Object.assign(new Error('not_shared'), { code: 403 });
};
