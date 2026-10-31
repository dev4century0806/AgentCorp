import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import WebSocket from 'ws';

const base = `http://127.0.0.1:${process.env.AGENT_CORP_PORT || 4317}`;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

test('HTTP serves the English UI and preserves API authentication', async () => {
  assert.equal((await fetch(`${base}/api/state`)).status, 401);
  const page = await fetch(base);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.equal(hash(html), hash(readFileSync(new URL('./ui/dist/index.html', import.meta.url))));
  assert.match(html, /<html lang="en">/);
  const cookie = page.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie);
  const state = await fetch(`${base}/api/state`, { headers: { cookie } });
  assert.equal(state.status, 200);
  assert.ok(Array.isArray((await state.json()).agents));
  const assets = [...html.matchAll(/(?:src|href)="\/?(assets\/[^\"]+\.(?:js|css))"/g)].map(match => match[1]);
  assert.equal(assets.length, 2);
  for (const path of [...assets, 'logo.svg']) {
    const response = await fetch(`${base}/${path}`);
    assert.equal(response.status, 200);
    assert.equal(hash(Buffer.from(await response.arrayBuffer())), hash(readFileSync(new URL(`./ui/dist/${path}`, import.meta.url))));
  }
});

test('WebSocket returns the live snapshot with a valid session', { timeout: 10000 }, async () => {
  const response = await fetch(base);
  const cookie = response.headers.get('set-cookie').split(';')[0];
  const socket = new WebSocket(base.replace('http:', 'ws:') + '/ws', { headers: { cookie } });
  try {
    const [data] = await once(socket, 'message');
    const message = JSON.parse(data.toString());
    assert.equal(message.type, 'snapshot');
    assert.ok(Array.isArray(message.snapshot.agents));
    assert.ok(Number.isInteger(message.seq));
  } finally {
    socket.terminate();
  }
});

test('WebSocket rejects requests without the session', { timeout: 10000 }, async () => {
  const socket = new WebSocket(base.replace('http:', 'ws:') + '/ws');
  socket.on('error', () => {}); // Terminating the rejected handshake emits an error.
  try {
    const [, response] = await once(socket, 'unexpected-response');
    assert.equal(response.statusCode, 401);
  } finally {
    await new Promise(resolve => {
      socket.once('close', resolve);
      socket.terminate();
    });
  }
});

test('HTTP rejects requests with an untrusted Origin header', async () => {
  const page = await fetch(base);
  const cookie = page.headers.get('set-cookie')?.split(';')[0];
  const response = await fetch(`${base}/api/state`, {
    headers: { cookie, origin: 'http://malicious-website.com' }
  });
  assert.equal(response.status, 403);
});

test('WebSocket rejects connections with an untrusted Origin header', { timeout: 10000 }, async () => {
  const page = await fetch(base);
  const cookie = page.headers.get('set-cookie')?.split(';')[0];
  const socket = new WebSocket(base.replace('http:', 'ws:') + '/ws', {
    headers: { cookie, origin: 'http://malicious-website.com' }
  });
  socket.on('error', () => {});
  try {
    const [, response] = await once(socket, 'unexpected-response');
    assert.equal(response.statusCode, 403);
  } finally {
    socket.terminate();
  }
});
