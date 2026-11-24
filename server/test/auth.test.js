import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../store.js';

test('auth initializes with defaults and verifies password', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sp-auth-'));
  const store = openStore(dir, 'testadmin', 'pass123');
  try {
    assert.equal(store.getAdminUser().username, 'testadmin');
    assert.equal(store.verifyAdminPassword('pass123', 'testadmin'), true);
    assert.equal(store.verifyAdminPassword('pass123'), true); // without user
    assert.equal(store.verifyAdminPassword('wrongpass', 'testadmin'), false);
    assert.equal(store.verifyAdminPassword('pass123', 'wronguser'), false);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('admin can update password and username', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sp-auth-'));
  const store = openStore(dir, 'initialUser', 'initialPass');
  try {
    store.updateAdminCredentials('newUser', 'newSecretPassword');
    assert.equal(store.getAdminUser().username, 'newUser');
    assert.equal(store.verifyAdminPassword('initialPass', 'initialUser'), false);
    assert.equal(store.verifyAdminPassword('newSecretPassword', 'newUser'), true);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('session creation, verification, and deletion', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sp-auth-'));
  const store = openStore(dir);
  try {
    const token = store.createSession();
    assert.ok(token && token.length >= 32);
    assert.equal(store.verifySession(token), true);
    assert.equal(store.verifySession('invalid-token'), false);
    store.deleteSession(token);
    assert.equal(store.verifySession(token), false);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});


test('child PINs start at the defaults, can be changed and survive a restart', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sp-auth-'));
  let store = openStore(dir, 'a', 'b');
  try {
    assert.equal(store.verifyKidPin('ben', '5555'), true);
    assert.equal(store.verifyKidPin('shin', '8888'), true);
    assert.equal(store.verifyKidPin('ben', '8888'), false);
    assert.equal(store.verifyKidPin('mom', '5555'), false);
    assert.equal(store.verifyKidPin('ben', ''), false);
    assert.equal(store.setKidPin('ben', '1234'), true);
    assert.equal(store.setKidPin('nobody', '1234'), false);
    store.close();
    store = openStore(dir, 'a', 'b');
    assert.equal(store.verifyKidPin('ben', '1234'), true);
    assert.equal(store.verifyKidPin('ben', '5555'), false);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
