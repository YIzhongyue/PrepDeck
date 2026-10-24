import assert from "node:assert/strict";
import test from "node:test";
import { importTs } from "../../../tests/support/bundle.mjs";
import { createKv } from "../../../tests/support/kv.mjs";

const { verifyRs256Jwt } = await importTs(new URL("../src/lib/jwt-verify.ts", import.meta.url));
const { verifyAccessJwt } = await importTs(new URL("../src/lib/access-jwt.ts", import.meta.url));
const google = await importTs(new URL("../src/lib/google-oauth.ts", import.meta.url));
const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const jwk = { ...await crypto.subtle.exportKey("jwk", pair.publicKey), kid: "synthetic", alg: "RS256" };
const opts = { jwksUrl: "https://no-network.invalid/jwks", jwksCacheKey: "keys", issuer: "https://accounts.google.com", audience: "client", validateAuthorizedParty: true };
const claims = () => ({ iss: opts.issuer, aud: "client", sub: "subject", email: "invited@example.test", email_verified: true, exp: Math.floor(Date.now() / 1000) + 600, nonce: "expected-nonce" });
async function sign(payload, alg = "RS256") {
  // JSON permits exponent notation that overflows a JavaScript number. Keep
  // that distinct from null when testing nonfinite NumericDate rejection.
  const part = value => Buffer.from(JSON.stringify(value, (_key, item) => item === Infinity ? "__overflow__" : item).replaceAll('"__overflow__"', "1e400")).toString("base64url");
  const body = `${part({ kid: "synthetic", alg })}.${part(payload)}`;
  return `${body}.${Buffer.from(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode(body))).toString("base64url")}`;
}
function env() {
  const KV = createKv();
  KV.store.set("keys", JSON.stringify({ keys: [jwk] }));
  KV.store.set("google_oauth_jwks", JSON.stringify({ keys: [jwk] }));
  return { KV, GOOGLE_CLIENT_ID: "client", GOOGLE_CLIENT_SECRET: "synthetic", SESSION_SECRET: "synthetic-session-secret" };
}

test("OIDC verifier accepts correct RSA token and authorized multiple audiences", async () => {
  for (const payload of [claims(), { ...claims(), aud: ["client", "other"], azp: "client" }]) {
    assert.equal((await verifyRs256Jwt(await sign(payload), opts, env())).sub, "subject");
  }
});

for (const [label, payload, alg] of [
  ["non-RS256 header even with a valid RSA signature", {}, "HS256"],
  ["multiple audiences without azp", { aud: ["client", "other"] }],
  ["wrong authorized party", { azp: "other" }],
  ["nonstring audience member", { aud: ["client", 7], azp: "client" }],
  ["empty audience member", { aud: ["client", ""], azp: "client" }],
  ["wrong issuer", { iss: "https://attacker.invalid" }],
  ["wrong audience", { aud: "other" }],
  ["expired token", { exp: 1 }],
]) test(`OIDC verifier rejects ${label}`, async () => {
  await assert.rejects(verifyRs256Jwt(await sign({ ...claims(), ...payload }, alg), opts, env()));
});

for (const [label, nonce] of [["missing", undefined], ["mismatched", "other"], ["nonstring", 7], ["matching", "expected-nonce"]]) {
  test(`Google exchange ${label} nonce`, async t => {
    const token = await sign({ ...claims(), nonce });
    t.mock.method(globalThis, "fetch", async (url, init) => {
      assert.equal(url, "https://oauth2.googleapis.com/token");
      assert.equal(new URLSearchParams(init.body).get("code_verifier"), "verifier");
      return Response.json({ id_token: token });
    });
    const result = google.exchangeCodeForIdentity(env(), "code", "https://app.example.test/api/auth/google/callback", "verifier", "expected-nonce");
    if (label === "matching") assert.equal((await result).sub, "subject");
    else await assert.rejects(result, /nonce/i);
  });
}

test("Google nonce is sent in authorization request and retained in signed state", async () => {
  const bindings = env();
  const url = new URL(google.buildGoogleAuthUrl(bindings, "https://app.example.test/callback", "state", "challenge", "expected-nonce"));
  assert.equal(url.searchParams.get("nonce"), "expected-nonce");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  const cookie = await google.buildOAuthStateCookie(bindings, "state", "verifier", true, null, "expected-nonce");
  assert.equal((await google.readOAuthStateCookie(bindings, cookie)).nonce, "expected-nonce");
});

test("state cookies from before nonce binding cannot resume sign-in", async () => {
  const bindings = env();
  const payload = Buffer.from(JSON.stringify({ state: "state", codeVerifier: "verifier", exp: Date.now() + 60_000 })).toString("base64url");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(bindings.SESSION_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = Buffer.from(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`oauth-state.v1.${payload}`))).toString("base64url");
  assert.equal(await google.readOAuthStateCookie(bindings, `__Host-pd_oauth=${payload}.${signature}`), null);
});

test("Access multi-audience JWT needs matching audience and signature but not OIDC azp", async () => {
  const bindings = { ...env(), CF_ACCESS_TEAM_DOMAIN: "access.example.test", CF_ACCESS_AUD: "access-app" };
  bindings.KV.store.set("cf_access_jwks", JSON.stringify({ keys: [jwk] }));
  const payload = { ...claims(), iss: "https://access.example.test", aud: ["access-app", "another-app"] };
  const token = await sign(payload);
  assert.equal((await verifyAccessJwt(token, bindings)).sub, "subject");
  await assert.rejects(verifyAccessJwt(await sign({ ...payload, aud: ["other-app"] }), bindings), /audience/i);
  const altered = token.split(".");
  altered[1] = Buffer.from(JSON.stringify({ ...payload, sub: "attacker" })).toString("base64url");
  await assert.rejects(verifyAccessJwt(altered.join("."), bindings), /signature/i);
});

for (const [label, azp] of [["missing", undefined], ["mismatching", "another-client"]]) {
  test(`Google exchange rejects ${label} azp with multiple audiences`, async t => {
    const token = await sign({ ...claims(), aud: ["client", "another-client"], azp });
    t.mock.method(globalThis, "fetch", async () => Response.json({ id_token: token }));
    await assert.rejects(google.exchangeCodeForIdentity(env(), "code", "https://app.example.test/callback", "verifier", "expected-nonce"), /authorized party/i);
  });
}

for (const claim of ["nbf", "iat"]) {
  for (const [label, value] of [["future", () => Math.floor(Date.now() / 1000) + 120], ["string", () => "123"], ["null", () => null], ["nonfinite", () => Infinity], ["negative", () => -1]]) {
    test(`both provider policies reject ${label} ${claim}`, async () => {
      const token = await sign({ ...claims(), [claim]: value() });
      for (const validateAuthorizedParty of [true, false]) {
        await assert.rejects(verifyRs256Jwt(token, { ...opts, validateAuthorizedParty }, env()), new RegExp(claim));
      }
    });
  }
  test(`both provider policies accept ${claim} within documented 60 second clock skew`, async () => {
    const token = await sign({ ...claims(), [claim]: Math.floor(Date.now() / 1000) + 30 });
    for (const validateAuthorizedParty of [true, false]) {
      assert.equal((await verifyRs256Jwt(token, { ...opts, validateAuthorizedParty }, env())).sub, "subject");
    }
  });
}
