// Web Push with WebCrypto only (no packages): RFC 8291 message encryption
// (aes128gcm) and RFC 8292 VAPID sign-in. iPhone push works for home-screen
// web apps on iOS 16.4+, through Apple's push service, which follows these RFCs.

const enc = new TextEncoder();

export const b64u = {
  encode(bytes) {
    let s = "";
    for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  },
  decode(str) {
    const s = atob(String(str).replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4));
    return Uint8Array.from(s, (c) => c.charCodeAt(0));
  },
};

function concat(...arrays) {
  const out = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0));
  let i = 0;
  for (const a of arrays) { out.set(a, i); i += a.length; }
  return out;
}

async function hkdf(salt, ikm, info, bytes) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bytes * 8));
}

// Encrypts `payload` for one subscription. `fixed` ({ asPrivateJwk, salt })
// is only for the RFC test vector; real sends use fresh random values.
export async function encryptPayload(payload, sub, fixed = {}) {
  const uaPublic = b64u.decode(sub.p256dh);
  const authSecret = b64u.decode(sub.auth);
  const salt = fixed.salt || crypto.getRandomValues(new Uint8Array(16));

  let asKeys;
  if (fixed.asPrivateJwk) {
    const j = fixed.asPrivateJwk;
    asKeys = {
      privateKey: await crypto.subtle.importKey("jwk", j, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]),
      publicKey: await crypto.subtle.importKey("jwk", { kty: "EC", crv: "P-256", x: j.x, y: j.y }, { name: "ECDH", namedCurve: "P-256" }, true, []),
    };
  } else {
    asKeys = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  }
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", asKeys.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, asKeys.privateKey, 256));

  const ikm = await hkdf(authSecret, shared, concat(enc.encode("WebPush: info\0"), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);

  const plain = concat(typeof payload === "string" ? enc.encode(payload) : payload, new Uint8Array([2]));
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, plain));

  const rs = new Uint8Array([0, 0, 16, 0]); // record size 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

// VAPID: a short-lived ES256 token proving the push came from this server.
export async function vapidAuth(endpoint, publicKey, privateJwk, subject, now = Date.now()) {
  const header = b64u.encode(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64u.encode(enc.encode(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(now / 1000) + 12 * 3600,
    sub: subject,
  })));
  const key = await crypto.subtle.importKey("jwk", privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(header + "." + claims));
  return `vapid t=${header}.${claims}.${b64u.encode(sig)}, k=${publicKey}`;
}

// Sends one push. Returns the HTTP status; 404/410 mean the subscription is dead.
export async function sendPush(sub, message, env, fetchFn = fetch) {
  const body = await encryptPayload(JSON.stringify(message), sub);
  const res = await fetchFn(sub.endpoint, {
    method: "POST",
    headers: {
      Authorization: await vapidAuth(sub.endpoint, env.VAPID_PUBLIC_KEY, JSON.parse(env.VAPID_PRIVATE_JWK), env.VAPID_SUBJECT),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: "14400",
      Urgency: "high",
    },
    body,
  });
  return res.status;
}
