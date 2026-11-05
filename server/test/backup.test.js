import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createZip, readZip } from '../zip.js';
import { openStore } from '../store.js';
import { exportZip, importZip, backupFileName } from '../backup.js';

test('zip round trip keeps names and bytes', () => {
  const big = Buffer.alloc(100000, 7);
  const z = readZip(createZip([{ name: 'a.json', data: '{"x":1}' }, { name: 'files/1/phiếu.pdf', data: big }]));
  assert.equal(z.get('a.json').toString(), '{"x":1}');
  assert.deepEqual(z.get('files/1/phiếu.pdf'), big);
});

test('backup file name shows the export date', () => {
  assert.equal(backupFileName(new Date(2026, 10, 5, 14, 30, 9)), 'study-planner-backup_05-11-2026_14-30-09.zip');
});

test('export then import restores state and files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sp-'));
  const a = openStore(join(dir, 'a')), b = openStore(join(dir, 'b'));
  try {
    a.putState({ tasks: [{ id: 't1', title: 'Bài 1' }], names: { ben: 'Ben' } });
    const f = a.addFile({ name: 'ws.pdf', type: 'application/pdf', data: Buffer.from('%PDF-1.4') });
    const { buffer } = exportZip(a);
    b.putState({ tasks: [] });
    const epochBefore = b.meta().epoch;
    const r = importZip(b, buffer);
    assert.equal(r.tasks, 1); assert.equal(r.files, 1);
    assert.equal(b.getState().state.tasks[0].title, 'Bài 1');
    assert.equal(Buffer.from(b.getFile(f.id).data).toString(), '%PDF-1.4');
    // a tab that loaded the data before the import cannot overwrite it
    assert.ok(b.putState({ tasks: [] }, epochBefore).conflict);
    assert.throws(() => importZip(b, Buffer.from('not a zip')), /zip/);
  } finally { a.close(); b.close(); rmSync(dir, { recursive: true, force: true }); }
});
