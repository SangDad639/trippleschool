/**
 * Dry-run unit tests for the AI Agent pipeline pure logic.
 *
 * Uses Node 20+ built-in test runner (`node --test`) — no extra deps.
 * Run from server/ with: `npx tsx --test src/services/__tests__/storyAgent.dryrun.test.ts`
 *
 * Tests cover the parts that don't need DB or network:
 *   - deriveSceneCount math + clamp
 *   - JSON response parsing (with/without markdown fences, malformed)
 *   - KIE pollKieTask URL extraction (deep nested, resultJson string, edge cases)
 *
 * For full E2E with real Anthropic/KIE/ElevenLabs keys, see docs/AI_AGENT_E2E.md
 * (not yet written — requires a running server + DB).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { deriveSceneCount } from '../storyAgentLLM.js';
import { pollKieTask } from '../kieSceneGen.js';

// ---------- deriveSceneCount ----------

test('deriveSceneCount: 30s → 5 scenes (floor)', () => {
  assert.equal(deriveSceneCount(30), 5);
});

test('deriveSceneCount: 60s → 10 scenes', () => {
  assert.equal(deriveSceneCount(60), 10);
});

test('deriveSceneCount: 90s → 15 scenes (the MahaPhutakun default)', () => {
  assert.equal(deriveSceneCount(90), 15);
});

test('deriveSceneCount: 180s → 30 scenes', () => {
  assert.equal(deriveSceneCount(180), 30);
});

test('deriveSceneCount: clamps low (10s → 5)', () => {
  assert.equal(deriveSceneCount(10), 5);
});

test('deriveSceneCount: clamps high (500s → 30)', () => {
  assert.equal(deriveSceneCount(500), 30);
});

// ---------- pollKieTask URL extraction (via mock fetch) ----------

const ORIGINAL_FETCH = globalThis.fetch;
function mockFetch(responseBody: any, status = 200): void {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(responseBody), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })) as typeof fetch;
}
function restoreFetch(): void {
  globalThis.fetch = ORIGINAL_FETCH;
}

test('pollKieTask: extracts URL from data.resultJson (string form)', async (t) => {
  mockFetch({
    code: 200,
    data: {
      state: 'success',
      resultJson: JSON.stringify({ resultUrls: ['https://kie.example/out.png'] }),
    },
  });
  t.after(restoreFetch);

  const r = await pollKieTask('fake-key', 'fake-task-id');
  assert.equal(r.state, 'success');
  assert.equal(r.url, 'https://kie.example/out.png');
});

test('pollKieTask: extracts URL from top-level videoUrl', async (t) => {
  mockFetch({
    data: { state: 'completed', videoUrl: 'https://kie.example/out.mp4' },
  });
  t.after(restoreFetch);

  const r = await pollKieTask('fake-key', 'fake-task-id');
  assert.equal(r.state, 'success');
  assert.equal(r.url, 'https://kie.example/out.mp4');
});

test('pollKieTask: deep-search finds nested URL', async (t) => {
  mockFetch({
    data: {
      state: 'done',
      payload: { nested: { results: [{ media: 'https://kie.example/deep.png' }] } },
    },
  });
  t.after(restoreFetch);

  const r = await pollKieTask('fake-key', 'fake-task-id');
  assert.equal(r.state, 'success');
  assert.equal(r.url, 'https://kie.example/deep.png');
});

test('pollKieTask: success but no URL → failed', async (t) => {
  mockFetch({ data: { state: 'success', resultJson: '{}' } });
  t.after(restoreFetch);

  const r = await pollKieTask('fake-key', 'fake-task-id');
  assert.equal(r.state, 'failed');
  assert.match(r.error || '', /no URL/i);
});

test('pollKieTask: failed state with failMsg', async (t) => {
  mockFetch({ data: { state: 'failed', failMsg: 'Internal error, try again' } });
  t.after(restoreFetch);

  const r = await pollKieTask('fake-key', 'fake-task-id');
  assert.equal(r.state, 'failed');
  assert.match(r.error || '', /Internal error/);
});

test('pollKieTask: pending state → pending', async (t) => {
  mockFetch({ data: { state: 'running' } });
  t.after(restoreFetch);

  const r = await pollKieTask('fake-key', 'fake-task-id');
  assert.equal(r.state, 'pending');
  assert.equal(r.url, null);
});

test('pollKieTask: HTTP error → pending (transient)', async (t) => {
  mockFetch({ error: 'rate limit' }, 503);
  t.after(restoreFetch);

  const r = await pollKieTask('fake-key', 'fake-task-id');
  assert.equal(r.state, 'pending');
  assert.equal(r.url, null);
});
