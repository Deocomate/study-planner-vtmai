// Export / import of the whole database as one .zip file.
//   manifest.json  – app name, format version, export time, counts
//   data.json      – the planner state (tasks, blocks, rewards, names, …)
//   files.json     – list of attached files (id, name, type, size, path in the zip)
//   files/<id>/<name> – the attached files themselves
import { createZip, readZip } from './zip.js';
import { mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const FORMAT = 1;
const pad = (n) => String(n).padStart(2, '0');
const stamp = (d) => `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
const safeName = (s) => String(s || 'file').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 120) || 'file';
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export const backupFileName = (d = new Date(), prefix = 'study-planner-backup') => `${prefix}_${stamp(d)}.zip`;

export function exportZip(store, d = new Date()) {
  const { state, rev, updatedAt } = store.getState();
  const files = store.listFiles().map((f) => ({ ...f, path: `files/${f.id}/${safeName(f.name)}` }));
  const manifest = {
    app: 'study-planner', format: FORMAT, exportedAt: d.toISOString(),
    exportedAtLocal: d.toLocaleString('vi-VN'), rev, updatedAt,
    counts: { tasks: state && Array.isArray(state.tasks) ? state.tasks.length : 0, files: files.length },
  };
  const entries = [
    { name: 'manifest.json', data: JSON.stringify(manifest, null, 2), date: d },
    { name: 'data.json', data: JSON.stringify(state || {}, null, 2), date: d },
    { name: 'files.json', data: JSON.stringify(files, null, 2), date: d },
    ...files.map((f) => ({ name: f.path, data: Buffer.from(store.getFile(f.id).data), date: d })),
  ];
  return { buffer: createZip(entries), name: backupFileName(d), manifest };
}

// Parses and checks a backup zip. Throws Error with a Vietnamese message for the backup page.
export function parseBackup(buf) {
  let z;
  try { z = readZip(buf); } catch (e) { throw new Error('File không phải là file .zip hợp lệ.'); }
  const json = (name) => { const b = z.get(name); if (!b) return undefined; try { return JSON.parse(b.toString('utf8')); } catch (e) { throw new Error(`File ${name} trong bản sao lưu bị hỏng.`); } };
  const manifest = json('manifest.json');
  if (manifest && manifest.app && manifest.app !== 'study-planner') throw new Error('Đây không phải bản sao lưu của Study Planner.');
  if (manifest && manifest.format > FORMAT) throw new Error('Bản sao lưu này được tạo bởi phiên bản mới hơn. Hãy cập nhật ứng dụng trước.');
  const state = json('data.json');
  if (!state || typeof state !== 'object' || Array.isArray(state) || !Array.isArray(state.tasks)) throw new Error('Bản sao lưu không có dữ liệu (data.json).');
  const list = json('files.json') || [];
  if (!Array.isArray(list)) throw new Error('File files.json trong bản sao lưu bị hỏng.');
  const files = [];
  for (const f of list) {
    if (!f || !ID_RE.test(String(f.id))) continue;
    const data = z.get(f.path) || [...z.entries()].find(([n]) => n.startsWith(`files/${f.id}/`))?.[1];
    if (!data) continue;
    files.push({ id: String(f.id), name: String(f.name || 'file'), type: String(f.type || 'application/octet-stream'), created_at: f.created_at, data });
  }
  return { manifest: manifest || null, state, files };
}

export function importZip(store, buf) {
  const { state, files, manifest } = parseBackup(buf);
  const r = store.replaceAll(state, files);
  return { ...r, tasks: state.tasks.length, files: files.length, exportedAt: manifest && manifest.exportedAt };
}

// Automatic copies kept on the server in DATA_DIR/backups.
export function makeBackupDir(dataDir) {
  const dir = join(dataDir, 'backups');
  mkdirSync(dir, { recursive: true });
  const list = () => readdirSync(dir).filter((n) => n.endsWith('.zip'))
    .map((n) => { const s = statSync(join(dir, n)); return { name: n, size: s.size, at: s.mtime.toISOString() }; })
    .sort((a, b) => b.at.localeCompare(a.at));
  const prune = (keep) => list().slice(keep).forEach((f) => { try { unlinkSync(join(dir, f.name)); } catch (e) { /* ignore */ } });
  return {
    dir, list, prune,
    path: (name) => (/^[\w.-]+\.zip$/.test(name) && existsSync(join(dir, name)) ? join(dir, name) : null),
    save(store, prefix, keep) {
      if (!store.meta().rev) return null; // nothing saved yet
      const d = new Date();
      const { buffer } = exportZip(store, d);
      const name = backupFileName(d, prefix);
      writeFileSync(join(dir, name), buffer);
      prune(keep);
      return name;
    },
  };
}
