import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDriveUrl } from '../drive.js';

test('Google Sheets and Drive links are recognised, other links are not', () => {
  const id = '1AbCdEfGhIjKlMnOpQrStUvWxYz_0123456789';
  assert.deepEqual(parseDriveUrl(`https://docs.google.com/spreadsheets/d/${id}/edit?usp=sharing`), { type: 'sheet', id, gid: null });
  assert.deepEqual(parseDriveUrl(`https://docs.google.com/spreadsheets/d/${id}/edit#gid=12345`), { type: 'sheet', id, gid: '12345' });
  assert.deepEqual(parseDriveUrl(`https://docs.google.com/spreadsheets/u/1/d/${id}/edit?gid=7#gid=7`), { type: 'sheet', id, gid: '7' });
  assert.deepEqual(parseDriveUrl(`https://drive.google.com/file/d/${id}/view?usp=drive_link`), { type: 'file', id });
  assert.deepEqual(parseDriveUrl(`https://drive.google.com/open?id=${id}`), { type: 'file', id });
  assert.deepEqual(parseDriveUrl(`  https://drive.google.com/uc?export=download&id=${id}  `), { type: 'file', id });
  assert.equal(parseDriveUrl(`https://evil.example.com/spreadsheets/d/${id}`), null);
  assert.equal(parseDriveUrl(`https://google.com.evil.io/file/d/${id}`), null);
  assert.equal(parseDriveUrl('not a link'), null);
  assert.equal(parseDriveUrl('https://drive.google.com/drive/folders/'), null);
});
