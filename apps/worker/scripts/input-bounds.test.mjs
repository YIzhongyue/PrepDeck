import assert from "node:assert/strict";
import test from "node:test";
import { importTs } from "../../../tests/support/bundle.mjs";

const { app } = await importTs({
  resolveDir: new URL("../src/", import.meta.url),
  contents: `import { createRouter } from './context';
    import { questionAiExplanationsRouter, aiGenerateRouter } from './routes/ai';
    import { profileRouter } from './routes/profile';
    import { knowledgePointsRouter } from './routes/knowledgePoints';
    export const app = createRouter();
    app.use('*', async (c,next) => { c.set('user', {id:'synthetic',email:'test@example.invalid',role:c.req.header('x-role') || 'user'}); await next(); });
    app.route('/explanations',questionAiExplanationsRouter);
    app.route('/generate',aiGenerateRouter);
    app.route('/knowledge-points',knowledgePointsRouter);
    app.route('/profile',profileRouter);`,
}, { platform: "node" });

function bindings(owner = "synthetic") {
  const effects = { writes: 0, puts: 0, cache: 0 };
  const row = { created_by: owner, question_id: "synthetic-question", provider: "openai", model: "test", content: "text", display_name: "Same" };
  const env = {
    DB: { prepare: () => ({ bind() { return this; }, first: async () => row, run: async () => { effects.writes++; return {}; } }) },
    BUCKET: { put: async () => { effects.puts++; } },
    KV: { delete: async () => { effects.cache++; } },
  };
  return { env, effects };
}
const send = (url, body, env, headers = {}, method = "PATCH") => app.request(url, { method, headers: { "content-type": "application/json", ...headers }, body }, env);

test("AI edit accepts boundary Unicode, rejects excess and preserves ownership", async () => {
  const { env, effects } = bindings();
  assert.equal((await send('/explanations/openai/test', JSON.stringify({content:'界'.repeat(32768)}),env)).status,200);
  assert.equal(effects.writes,1);
  assert.equal((await send('/explanations/openai/test', '{"content":"' + '\\u0061'.repeat(32768) + '"}',env)).status,200);
  assert.equal((await send('/explanations/openai/test', JSON.stringify({content:'a'.repeat(32769)}),env)).status,400);
  assert.equal(effects.writes,2);
  const other = bindings('another-owner');
  assert.equal((await send('/explanations/openai/test','{"content":"edit"}',other.env)).status,403);
  assert.equal(other.effects.writes,0);
});

test("AI edit counts streamed bytes despite absent or understated Content-Length", async () => {
  for (const headers of [{}, { 'content-length': '1' }]) {
    const {env,effects}=bindings();
    let cancelled=false;
    const stream=new ReadableStream({pull(c){c.enqueue(new Uint8Array(16384));},cancel(){cancelled=true;}});
    const response=await app.request('/explanations/openai/test',{method:'PATCH',headers,body:stream,duplex:'half'},env);
    assert.equal(response.status,413);
    assert.equal(cancelled,true);
    assert.equal(effects.writes,0);
  }
});

test("key-owner mismatch stops generation before parsing or provider access", async () => {
  assert.equal((await send('/generate','invalid',{}, {'X-PrepDeck-Key-Owner':'other'},'POST')).status,409);
  for (const headers of [{},{'X-PrepDeck-Key-Owner':'synthetic'}]) {
    assert.equal((await send('/generate','invalid',{},headers,'POST')).status,400);
  }
});

test("avatar validates actual format and dimensions before any mutation", async () => {
  const valid = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC9sAAAAASUVORK5CYII=','base64'));
  const huge=valid.slice(); new DataView(huge.buffer).setUint32(16,100000); new DataView(huge.buffer).setUint32(20,100000);
  for (const [body,type] of [[new Uint8Array([1,2,3]),'image/png'],[valid,'image/jpeg'],[huge,'image/png'],[valid.slice(0,20),'image/png']]) {
    const {env,effects}=bindings();
    assert.equal((await send('/profile/avatar',body,env,{'content-type':type},'POST')).status,400);
    assert.equal(effects.puts+effects.writes,0);
  }
  const {env,effects}=bindings();
  assert.equal((await send('/profile/avatar',valid,env,{'content-type':'image/png'},'POST')).status,200);
  assert.equal(effects.puts,1);
});

test("invalid REST search filters fail before either page/count query", async () => {
  const env = { DB: { prepare() { assert.fail('must not query DB'); } } };
  for (const query of ['q='+'x'.repeat(201), 'tagIds='+Array(21).fill('tag').join(','), 'tagIds='+'x'.repeat(201)]) {
    assert.equal((await app.request('/knowledge-points?'+query,{},env)).status,400);
  }
});

test("oversized avatar body is refused before storage", async () => {
  const {env,effects}=bindings();
  const response=await send('/profile/avatar',new Uint8Array([1]),env,{'content-type':'image/png','content-length':String(2*1024*1024+1)},'POST');
  assert.equal(response.status,413);
  assert.equal(effects.puts+effects.writes,0);
});

test("unchanged display name avoids database writes and cache invalidation", async () => {
  const {env,effects}=bindings();
  assert.equal((await send('/profile','{"displayName":"Same"}',env)).status,200);
  assert.deepEqual(effects,{writes:0,puts:0,cache:0});
});
