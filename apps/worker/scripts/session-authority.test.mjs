import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import { importTs } from "../../../tests/support/bundle.mjs";
import { openDatabase } from "../../../tests/support/migrations.mjs";
import { createD1 } from "../../../tests/support/d1.mjs";
import { createKv } from "../../../tests/support/kv.mjs";
const { requireAccessUser, adminUsersRouter, issueSessionToken, createSessionToken, authorizeIdentity } = await importTs([
  new URL("../src/middleware/access.ts", import.meta.url), new URL("../src/routes/adminUsers.ts", import.meta.url),
  new URL("../src/lib/session.ts", import.meta.url), new URL("../src/lib/authorizeIdentity.ts", import.meta.url),
]);
function fixture(t, options) {
  const db = openDatabase(t);
  db.exec(`INSERT INTO users (id,email,role,status,created_at,google_sub) VALUES
   ('alice','alice@example.test','admin','active','2026-01-01','old-sub'),
   ('root','root@example.test','admin','active','2026-01-01','root-sub');`);
  const env = {DB:createD1(db,options), KV:createKv(), AUTH_MODE:'cookie', SESSION_SECRET:'synthetic-session-authority-only'};
  const stale = {id:'alice',email:'alice@example.test',role:'admin',status:'active',display_name:null,avatar_url:null,session_version:0};
  for (const key of ['id:alice','email:alice@example.test']) env.KV.store.set(`user-cache:${key}`,JSON.stringify(stale));
  const app = new Hono();app.use('*', requireAccessUser);app.get('/me', c=>c.json(c.get('user')));app.route('/admin/users',adminUsersRouter);
  const call = (path,token,init={}) => app.request(`https://app.example.test${path}`, {...init,headers:{Cookie:`__Host-pd_session=${token}`,Origin:'https://app.example.test','Content-Type':'application/json',...init.headers}},env);
  return {db,env,call};
}
test('stale KV cannot retain revoked account access',async t=>{
 const {db,env,call}=fixture(t);const token=await issueSessionToken(env,'alice');
 db.exec("UPDATE users SET status='revoked', session_version=session_version+1 WHERE id='alice'");
 assert.equal((await call('/me',token)).status,403);
});
test('stale KV cannot retain administrator role',async t=>{
 const {db,env,call}=fixture(t);const token=await issueSessionToken(env,'alice');
 db.exec("UPDATE users SET role='user' WHERE id='alice'");
 assert.equal((await call('/admin/users',token)).status,403);
 assert.equal((await (await call('/me',token)).json()).role,'user');
});
test('stale KV cannot restore an old session version',async t=>{
 const {db,env,call}=fixture(t);const token=await issueSessionToken(env,'alice');
 db.exec("UPDATE users SET session_version=session_version+1 WHERE id='alice'");
 assert.equal((await call('/me',token)).status,401);
});
test('Access identity also ignores stale email cache',async t=>{
 const {db,env}=fixture(t);db.exec("UPDATE users SET status='revoked' WHERE id='alice'");
 const result=await authorizeIdentity(env,{provider:'cloudflare-access',subject:'access-sub',email:'alice@example.test'},async()=>({name:null,picture:null}));
 assert.equal(result.ok,false);
});
function connections(db) {
 db.exec(`INSERT INTO mcp_credentials(id,user_id,server,name,token_hash,created_at) VALUES ('pat','alice','user','synthetic','${'a'.repeat(64)}',1);
 INSERT INTO mcp_oauth_clients(id,kind,redirect_uris_json,created_at) VALUES ('client','dynamic','["https://client.example.test/cb"]',1);
 INSERT INTO mcp_oauth_grants(id,user_id,client_id,audience,scopes,created_at) VALUES ('grant','alice','client','user','prepdeck:user:read',1);`);
}
test('binding recovery ends sessions, PATs and OAuth grants atomically',async t=>{
 const {db,env,call}=fixture(t);connections(db);
 const old=await issueSessionToken(env,'alice');const admin=await issueSessionToken(env,'root');
 const response=await call('/admin/users/alice',admin,{method:'PATCH',body:JSON.stringify({googleSub:null})});
 assert.equal(response.status,200,await response.text());
 const row=db.prepare("SELECT google_sub,session_version FROM users WHERE id='alice'").get();
 assert.equal(row.google_sub,null);assert.equal(row.session_version,1);
 assert.equal((await call('/me',old)).status,401);
 assert.ok(Math.abs(Date.now()-db.prepare("SELECT revoked_at FROM mcp_credentials WHERE id='pat'").get().revoked_at)<5000);
 assert.ok(Math.abs(Date.now()-db.prepare("SELECT revoked_at FROM mcp_oauth_grants WHERE id='grant'").get().revoked_at)<5000);
});
test('recovery rollback preserves all credentials if a batch write fails',async t=>{
 const {db,env,call}=fixture(t);connections(db);
 db.exec("CREATE TRIGGER fail_recovery BEFORE UPDATE ON mcp_oauth_grants BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
 const admin=await issueSessionToken(env,'root');
 assert.equal((await call('/admin/users/alice',admin,{method:'PATCH',body:JSON.stringify({googleSub:null})})).status,500);
 const row=db.prepare("SELECT google_sub,session_version FROM users WHERE id='alice'").get();
 assert.equal(row.google_sub,'old-sub');assert.equal(row.session_version,0);
 assert.equal(db.prepare("SELECT revoked_at FROM mcp_credentials WHERE id='pat'").get().revoked_at,null);
});

// A successful identity resolution must not borrow the newer session version
// if recovery happens between admission and the callback's cookie issuance.
test('admission snapshot cannot mint a current session after recovery',async t=>{
 const {db,env,call}=fixture(t);
 const admission=await authorizeIdentity(env,{provider:'google',subject:'old-sub',email:'alice@example.test'},async()=>({name:'Alice',picture:null}));
 assert.equal(admission.ok,true);assert.equal(admission.sessionVersion,0);
 db.exec("UPDATE users SET google_sub=NULL,session_version=session_version+1 WHERE id='alice'");
 const token=await createSessionToken(admission.user.id,admission.sessionVersion,env);
 assert.equal((await call('/me',token)).status,401);
});

for (const avatar of [null,'/avatar.png']) test(`recovery between identity read and binding update refuses old subject (${avatar})`,async t=>{
 let didReset=false;
 const {db,env}=fixture(t,{afterQuery:({sql,method})=>{
   if (!didReset && method==='first' && sql.includes('FROM users WHERE google_sub')) {
     didReset=true;db.exec("UPDATE users SET google_sub=NULL,session_version=session_version+1 WHERE id='alice'");
   }
 }});
 db.prepare("UPDATE users SET avatar_url=? WHERE id='alice'").run(avatar);
 const admission=await authorizeIdentity(env,{provider:'google',subject:'old-sub',email:'alice@example.test'},async()=>({name:'Alice',picture:null}));
 assert.equal(didReset,true);assert.equal(admission.ok,false);
 assert.equal(db.prepare("SELECT google_sub FROM users WHERE id='alice'").get().google_sub,null);
});
