'use strict';
// Private file storage. Files live in data/uploads under random names and are only served through an authorised route.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { get, all, run, uid, UPLOAD_DIR } = require('./db');
const T = require('./time');
const { bad } = require('./util');

const MAX_BYTES = Number(process.env.MAX_UPLOAD_MB || 10) * 1024 * 1024;

// Identify the real file type from its first bytes (never trust the file name or the browser's claim).
function sniff(buf, name) {
  const ext = path.extname(name || '').toLowerCase();
  if (buf.length >= 5 && buf.slice(0, 5).toString() === '%PDF-') return { mime: 'application/pdf', ext: '.pdf' };
  if (buf.length >= 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: '.png' };
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: '.jpg' };
  if (buf.length >= 12 && buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return { mime: 'image/webp', ext: '.webp' };
  if (buf.length >= 4 && buf.slice(0, 4).toString() === 'GIF8') return { mime: 'image/gif', ext: '.gif' };
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) {
    const office = { '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation' };
    if (office[ext]) return { mime: office[ext], ext };
  }
  if (ext === '.txt' && !buf.includes(0)) return { mime: 'text/plain', ext: '.txt' };
  return null;
}
const IMPORT_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp']);

function saveUpload({ buf, name, kind, ownerChildId, userId }) {
  if (!buf || !buf.length) throw bad('The file is empty.');
  if (buf.length > MAX_BYTES) throw bad(`The file is too large (limit ${MAX_BYTES / 1048576} MB).`);
  const cleanName = path.basename(String(name || 'file')).replace(/[^\w.\- ()]/g, '_').slice(0, 120) || 'file';
  const type = sniff(buf, cleanName);
  if (!type) throw bad('This file type is not allowed. Use PDF, PNG, JPG, WEBP, GIF, DOCX, XLSX, PPTX or TXT.');
  if (kind === 'import' && !IMPORT_TYPES.has(type.mime)) throw bad('For importing assignments please upload a PDF, PNG, JPG or WEBP file.');
  const id = uid(), stored = crypto.randomBytes(16).toString('hex') + type.ext;
  fs.writeFileSync(path.join(UPLOAD_DIR, stored), buf, { mode: 0o600 });
  run('INSERT INTO files (id, kind, owner_child_id, original_name, stored_name, mime, size, uploaded_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    id, kind, ownerChildId || null, cleanName, stored, type.mime, buf.length, userId || null, T.nowISO());
  return get('SELECT id, kind, original_name, mime, size, created_at FROM files WHERE id = ?', id);
}
const readFile = (f) => fs.readFileSync(path.join(UPLOAD_DIR, f.stored_name));
function deleteFileRows(ids) {
  let bytes = 0, n = 0;
  for (const id of ids) {
    const f = get('SELECT * FROM files WHERE id = ?', id);
    if (!f) continue;
    try { fs.unlinkSync(path.join(UPLOAD_DIR, f.stored_name)); } catch {}
    run('DELETE FROM files WHERE id = ?', id); bytes += f.size; n++;
  }
  return { files: n, bytes };
}
// Can this user open this file? Parents: all. Children: their own submissions and import files attached to their own tasks.
function canRead(user, f) {
  if (user.role === 'parent') return true;
  if (f.kind === 'submission') return f.owner_child_id === user.child_id;
  return !!get('SELECT 1 AS x FROM tasks WHERE source_file_id = ? AND child_id = ? AND cancelled_at IS NULL', f.id, user.child_id);
}
// Delete import files that no task refers to any more and that are older than `days`.
function cleanOrphanImports(days = 7) {
  const cutoff = new Date(T.nowMs() - days * 86400000).toISOString();
  const ids = all("SELECT id FROM files WHERE kind = 'import' AND created_at < ? AND id NOT IN (SELECT source_file_id FROM tasks WHERE source_file_id IS NOT NULL)", cutoff).map((r) => r.id);
  return deleteFileRows(ids);
}
module.exports = { saveUpload, readFile, deleteFileRows, canRead, cleanOrphanImports, sniff, MAX_BYTES };
