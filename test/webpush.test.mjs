// Web Push checks: the RFC 8291 Appendix A test vector byte-for-byte, a
// round trip decrypted the way a phone would, and a verifiable VAPID token.
import assert from "node:assert";
import { encryptPayload, vapidAuth, b64u } from "../src/webpush.js";

const enc = new TextEncoder();

// --- RFC 8291 Appendix A ---
const asPublic = b64u.decode("BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8");
const asPrivateJwk = {
  kty: "EC", crv: "P-256", d: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  x: b64u.encode(asPublic.slice(1, 33)), y: b64u.encode(asPublic.slice(33)),
};
const vector = await encryptPayload("When I grow up, I want to be a watermelon", {
  p256dh: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
}, { asPrivateJwk, salt: b64u.decode("DGv6ra1nlYgDCS1FRnbzlw") });
assert.strictEqual(
  b64u.encode(vector),
  "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
);

// --- Round trip: decrypt as the receiving phone would ---
const ua = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
const uaPublic = new Uint8Array(await crypto.subtle.exportKey("raw", ua.publicKey));
const auth = crypto.getRandomValues(new Uint8Array(16));
const msg = JSON.stringify({ title: "Habits", body: "Still open: Family 2/5." });
const blob = await encryptPayload(msg, { p256dh: b64u.encode(uaPublic), auth: b64u.encode(auth) });

const salt = blob.slice(0, 16);
const idlen = blob[20];
const senderPub = blob.slice(21, 21 + idlen);
const cipher = blob.slice(21 + idlen);
const hk = async (s, ikm, info, n) => new Uint8Array(await crypto.subtle.deriveBits(
  { name: "HKDF", hash: "SHA-256", salt: s, info },
  await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]), n * 8));
const shared = new Uint8Array(await crypto.subtle.deriveBits({
  name: "ECDH", public: await crypto.subtle.importKey("raw", senderPub, { name: "ECDH", namedCurve: "P-256" }, false, []),
}, ua.privateKey, 256));
const info = new Uint8Array([...enc.encode("WebPush: info\0"), ...uaPublic, ...senderPub]);
const ikm = await hk(auth, shared, info, 32);
const cek = await hk(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
const nonce = await hk(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce },
  await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]), cipher));
assert.strictEqual(plain[plain.length - 1], 2); // last-record delimiter
assert.strictEqual(new TextDecoder().decode(plain.slice(0, -1)), msg);

// --- VAPID token verifies with the public key ---
const vk = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const pub = b64u.encode(await crypto.subtle.exportKey("raw", vk.publicKey));
const jwk = await crypto.subtle.exportKey("jwk", vk.privateKey);
const header = await vapidAuth("https://web.push.apple.com/abc/def", pub, jwk, "https://habits.test");
const m = header.match(/^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/);
assert.ok(m);
assert.strictEqual(m[4], pub);
const claims = JSON.parse(new TextDecoder().decode(b64u.decode(m[2])));
assert.strictEqual(claims.aud, "https://web.push.apple.com");
assert.strictEqual(claims.sub, "https://habits.test");
assert.ok(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, vk.publicKey, b64u.decode(m[3]), enc.encode(m[1] + "." + m[2])));

console.log("webpush ok");
