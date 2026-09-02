import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest, validRunId } from '../supabase/functions/trigger-loto-sync/handler.mjs';

const run = { id: 12345, path: '.github/workflows/loto-sync.yml', head_branch: 'main', status: 'in_progress', conclusion: null };
function fixture({ replies = [], admin = true, user = true, conflicts = 0 } = {}) {
  const calls = [];
  const deps = {
    getEnv: name => ({ SUPABASE_URL: 'https://example.test', SUPABASE_ANON_KEY: 'public-test', GITHUB_ACTIONS_TOKEN: 'private-test' })[name],
    createClient: () => ({
      auth: { getUser: async () => ({ data: { user: user ? { id: 'admin' } : null }, error: null }) },
      rpc: async name => { assert.equal(name, 'is_loto_admin'); return { data: admin, error: null }; },
      from: name => {
        assert.equal(name, 'loto_sync_conflicts');
        return { select() { return this; }, is: async () => ({ count: conflicts, error: null }) };
      }
    }),
    fetchImpl: async (url, options) => {
      calls.push({ url, ...options });
      const reply = replies.shift();
      assert.ok(reply, 'Unexpected GitHub request');
      return reply instanceof Response ? reply : Response.json(reply);
    }
  };
  return { calls, deps };
}
function request(body = {}, headers = { Authorization: 'Bearer user-test' }) {
  return new Request('https://example.test/functions/v1/trigger-loto-sync', { method: 'POST', headers, body: JSON.stringify(body) });
}

test('start returns the exact dispatched run ID without exposing the token', async () => {
  const f = fixture({ replies: [{ workflow_runs: [] }, { workflow_run_id: run.id }] });
  const response = await handleRequest(request(), f.deps);
  const data = await response.json();
  assert.equal(response.status, 202);
  assert.equal(data.run.id, run.id);
  assert.equal(data.run.status, 'queued');
  assert.equal(f.calls[1].method, 'POST');
  assert.deepEqual(JSON.parse(f.calls[1].body), { ref: 'main', inputs: { months_back: '1' } });
  assert.doesNotMatch(JSON.stringify(data), /private-test|user-test/);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});

for (const status of ['queued', 'in_progress', 'waiting', 'pending', 'requested']) {
  test(`${status} run is reused, not dispatched again`, async () => {
    const f = fixture({ replies: [{ workflow_runs: [{ ...run, status }] }] });
    const data = await (await handleRequest(request({ action: 'start' }), f.deps)).json();
    assert.equal(data.reused, true);
    assert.equal(data.run.id, run.id);
    assert.equal(f.calls.length, 1);
  });
}

test('status reports the active step and never dispatches', async () => {
  const f = fixture({ replies: [run, { jobs: [{ steps: [{ name: 'Resmî sonuçları doğrula', status: 'in_progress' }] }] }] });
  const data = await (await handleRequest(request({ action: 'status', run_id: run.id }), f.deps)).json();
  assert.equal(data.run.step, 'Resmî sonuçları doğrula');
  assert.ok(f.calls.every(call => !call.method));
});

for (const conclusion of ['failure', 'cancelled', 'timed_out']) {
  test(`${conclusion} is returned as a terminal result, not a running job`, async () => {
    const f = fixture({ replies: [{ ...run, status: 'completed', conclusion }, { jobs: [{ steps: [{ name: 'Hazırlık', conclusion, status: 'completed' }] }] }] });
    const data = await (await handleRequest(request({ action: 'status', run_id: run.id }), f.deps)).json();
    assert.equal(data.run.conclusion, conclusion);
    assert.equal(data.run.step, 'Hazırlık');
  });
}

test('success includes unresolved conflict count and needs no SQL migration', async () => {
  const f = fixture({ replies: [{ ...run, status: 'completed', conclusion: 'success' }], conflicts: 2 });
  const data = await (await handleRequest(request({ action: 'status', run_id: run.id }), f.deps)).json();
  assert.equal(data.run.unresolved_conflicts, 2);
});

test('invalid IDs and unrelated workflows cannot reach arbitrary URLs', async () => {
  for (const id of [null, 0, -1, 1.2, '../secrets', '123?x=1', Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(validRunId(id), false);
    const f = fixture();
    assert.equal((await handleRequest(request({ action: 'status', run_id: id }), f.deps)).status, 400);
    assert.equal(f.calls.length, 0);
  }
  const f = fixture({ replies: [{ ...run, path: '.github/workflows/other.yml' }] });
  assert.equal((await handleRequest(request({ action: 'status', run_id: run.id }), f.deps)).status, 404);
});

test('both start and status require authenticated admin access', async () => {
  for (const body of [{}, { action: 'status', run_id: run.id }]) {
    for (const [config, status] of [[{ user: false }, 401], [{ admin: false }, 403]]) {
      const f = fixture(config);
      assert.equal((await handleRequest(request(body), f.deps)).status, status);
      assert.equal(f.calls.length, 0);
    }
    const f = fixture();
    assert.equal((await handleRequest(request(body, {}), f.deps)).status, 401);
  }
});

test('GitHub failure is not success and its raw response is never exposed', async () => {
  const f = fixture({ replies: [new Response('secret error body', { status: 403 })] });
  const response = await handleRequest(request(), f.deps);
  assert.equal(response.status, 502);
  const text = await response.text();
  assert.match(text, /403/);
  assert.doesNotMatch(text, /secret error body|private-test/);
});
