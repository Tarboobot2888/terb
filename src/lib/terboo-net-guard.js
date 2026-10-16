// ═══════════════════════════════════════════════
// 🛡️ Terboo Net Guard — حماية SSRF لأي رابط يقدّمه مستخدم
// ───────────────────────────────────────────────
// قبل أي طلب لرابط من مستخدم (لوحة Pterodactyl مثلاً):
//   1. HTTP/HTTPS فقط · بلا بيانات دخول داخل الرابط · منفذ صالح
//   2. أسماء مضيف داخلية مرفوضة (localhost · metadata · *.internal · *.local · اسم بلا نطاق)
//   3. حلّ DNS لكل العناوين، ورفض أي عنوان خاص/محلي/رابط-محلي/ميتاداتا/متعدد البث/محجوز
//   4. الاتصال نفسه يستخدم العنوان الذي تم فحصه (lookup مخصّص) ⇒ لا DNS rebinding
//   5. كل إعادة توجيه يُعاد فحصها؛ ولا تُرسل بيانات الاعتماد لمضيف آخر أبداً
// المالك وحده يستطيع السماح بمضيفات خاصة محددة عبر خيارات الاستدعاء (allowPrivateHosts).
// ═══════════════════════════════════════════════

import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";

const BLOCKED_HOSTNAMES = new Set([
  "localhost", "localhost.localdomain", "ip6-localhost", "ip6-loopback",
  "metadata", "metadata.google.internal", "metadata.goog", "instance-data", "instance-data.ec2.internal",
  "metadata.azure.internal", "kubernetes", "kubernetes.default", "kubernetes.default.svc",
]);
const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".intranet", ".lan", ".home", ".home.arpa", ".corp", ".svc", ".cluster.local", ".localdomain"];

class NetGuardError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = "NetGuardError";
    this.code = code;
  }
}

// ── العناوين ─────────────────────────────────────

/** IPv4 محجوز/خاص؟ ⇒ سبب أو null */
function ipv4Blocked(address) {
  const parts = String(address).split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return "invalid";
  const [a, b, c] = parts;
  if (a === 0) return "this-network";
  if (a === 10) return "private";
  if (a === 100 && b >= 64 && b <= 127) return "carrier-nat";
  if (a === 127) return "loopback";
  if (a === 169 && b === 254) return "link-local";
  if (a === 172 && b >= 16 && b <= 31) return "private";
  if (a === 192 && b === 0 && c === 0) return "protocol-assignments";
  if (a === 192 && b === 0 && c === 2) return "documentation";
  if (a === 192 && b === 88 && c === 99) return "relay";
  if (a === 192 && b === 168) return "private";
  if (a === 198 && (b === 18 || b === 19)) return "benchmark";
  if (a === 198 && b === 51 && c === 100) return "documentation";
  if (a === 203 && b === 0 && c === 113) return "documentation";
  if (a >= 224) return a < 240 ? "multicast" : "reserved";
  return null;
}

/** يفك IPv6 إلى 8 مقاطع رقمية (يدعم :: وعنوان IPv4 مضمّن) */
function ipv6Words(address) {
  let value = String(address).toLowerCase().split("%")[0];
  const tail = [];
  const v4 = value.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    if (ipv4Blocked(v4[2]) === "invalid") return null;
    const p = v4[2].split(".").map(Number);
    tail.push((p[0] << 8) | p[1], (p[2] << 8) | p[3]);
    value = v4[1].endsWith("::") ? v4[1] : v4[1].slice(0, -1);
  }
  const parts = value.split("::");
  if (parts.length > 2) return null;
  const left = parts[0] ? parts[0].split(":") : [];
  const right = parts.length === 2 && parts[1] ? parts[1].split(":") : [];
  const fill = 8 - tail.length - left.length - right.length;
  if (parts.length === 1 ? fill !== 0 : fill < 0) return null;
  const words = [...left, ...Array(parts.length === 2 ? fill : 0).fill("0"), ...right]
    .map((h) => (/^[0-9a-f]{1,4}$/.test(h) ? parseInt(h, 16) : NaN));
  const all = [...words, ...tail];
  return all.length === 8 && all.every(Number.isInteger) ? all : null;
}

function v4From(w1, w2) {
  return `${w1 >> 8}.${w1 & 255}.${w2 >> 8}.${w2 & 255}`;
}

/** IPv6 محجوز/خاص؟ ⇒ سبب أو null */
function ipv6Blocked(address) {
  const w = ipv6Words(address);
  if (!w) return "invalid";
  const zeroPrefix = (n) => w.slice(0, n).every((x) => x === 0);
  if (w.every((x) => x === 0)) return "unspecified";
  if (zeroPrefix(7) && w[7] === 1) return "loopback";
  if (zeroPrefix(5) && w[5] === 0xffff) return ipv4Blocked(v4From(w[6], w[7])) ? "mapped-private" : null; // ::ffff:a.b.c.d
  if (zeroPrefix(6)) return "ipv4-compatible";
  if (w[0] === 0x64 && w[1] === 0xff9b && w.slice(2, 6).every((x) => x === 0)) {
    return ipv4Blocked(v4From(w[6], w[7])) ? "nat64-private" : null;
  }
  if (w[0] === 0x64 && w[1] === 0xff9b && w[2] === 1) return "nat64-local";
  if (w[0] === 0x100 && w[1] === 0 && w[2] === 0 && w[3] === 0) return "discard";
  if (w[0] === 0x2001 && w[1] === 0) return "teredo";
  if (w[0] === 0x2001 && w[1] === 0xdb8) return "documentation";
  if (w[0] === 0x2002) return ipv4Blocked(v4From(w[1], w[2])) ? "6to4-private" : null;
  if ((w[0] & 0xfe00) === 0xfc00) return "unique-local";
  if ((w[0] & 0xffc0) === 0xfe80) return "link-local";
  if ((w[0] & 0xffc0) === 0xfec0) return "site-local";
  if ((w[0] & 0xff00) === 0xff00) return "multicast";
  return null;
}

/** عنوان IP (v4/v6) محظور؟ ⇒ سبب أو null */
function blockedAddress(address) {
  const ip = String(address || "").replace(/^\[|\]$/g, "");
  const kind = net.isIP(ip);
  if (kind === 4) return ipv4Blocked(ip);
  if (kind === 6) return ipv6Blocked(ip);
  return "invalid";
}

/** واجهة قديمة: true إن كان العنوان خاصاً/محلياً */
function isPrivateAddress(address) {
  return net.isIP(String(address || "").replace(/^\[|\]$/g, "")) ? Boolean(blockedAddress(address)) : false;
}

// ── الروابط ──────────────────────────────────────

function hostAllowed(host, allowPrivateHosts = []) {
  const value = String(host || "").toLowerCase().replace(/^\[|\]$/g, "");
  return (allowPrivateHosts || []).some((h) => String(h || "").toLowerCase().replace(/^\[|\]$/g, "") === value);
}

/** اسم مضيف داخلي بالاسم (قبل DNS)؟ */
function blockedHostname(host) {
  const value = String(host || "").toLowerCase().replace(/\.$/, "");
  if (!value) return "empty";
  if (BLOCKED_HOSTNAMES.has(value)) return "internal-name";
  if (BLOCKED_SUFFIXES.some((s) => value.endsWith(s))) return "internal-name";
  if (!net.isIP(value.replace(/^\[|\]$/g, "")) && !value.includes(".")) return "single-label";
  return null;
}

/**
 * فحص ثابت للرابط (بلا شبكة).
 * @returns {URL}
 * @throws {NetGuardError} invalid-url · bad-protocol · credentials-in-url · bad-port · blocked-host · blocked-address
 */
function checkUrl(value, { allowPrivateHosts = [], allowPrivateNetworks = false } = {}) {
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    throw new NetGuardError("invalid-url");
  }
  if (!["http:", "https:"].includes(url.protocol)) throw new NetGuardError("bad-protocol");
  if (url.username || url.password) throw new NetGuardError("credentials-in-url");
  if (url.port && (Number(url.port) < 1 || Number(url.port) > 65535)) throw new NetGuardError("bad-port");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (allowPrivateNetworks || hostAllowed(host, allowPrivateHosts)) return url;
  if (net.isIP(host)) {
    if (blockedAddress(host)) throw new NetGuardError("blocked-address");
    return url;
  }
  if (blockedHostname(host)) throw new NetGuardError("blocked-host");
  return url;
}

/**
 * يحل المضيف ويتحقق من كل العناوين.
 * @returns {Promise<Array<{address:string, family:number}>>}
 */
async function resolvePublic(host, { allowPrivateHosts = [], allowPrivateNetworks = false } = {}) {
  const name = String(host || "").replace(/^\[|\]$/g, "");
  let addresses;
  if (net.isIP(name)) addresses = [{ address: name, family: net.isIP(name) }];
  else {
    try {
      addresses = await dns.promises.lookup(name, { all: true, verbatim: true });
    } catch {
      throw new NetGuardError("dns-failed");
    }
  }
  if (!addresses.length) throw new NetGuardError("dns-failed");
  if (allowPrivateNetworks || hostAllowed(name, allowPrivateHosts)) return addresses;
  if (addresses.some((a) => blockedAddress(a.address))) throw new NetGuardError("blocked-address");
  return addresses;
}

/** lookup للاتصال: يحل ويفحص لحظة الاتصال نفسها (لا يُستخدم أي عنوان لم يُفحص) */
function guardedLookup(policy) {
  return (hostname, options, callback) => {
    const cb = typeof options === "function" ? options : callback;
    const opts = typeof options === "object" && options ? options : {};
    resolvePublic(hostname, policy).then(
      (addresses) => {
        const usable = opts.family ? addresses.filter((a) => a.family === opts.family) : addresses;
        const list = usable.length ? usable : addresses;
        if (opts.all) cb(null, list);
        else cb(null, list[0].address, list[0].family);
      },
      (error) => cb(error),
    );
  };
}

/** إعادة توجيه مقبولة؟ نفس المضيف (ومن http إلى https مسموح) */
function sameTarget(from, to) {
  if (from.hostname !== to.hostname) return false;
  const port = (u) => u.port || (u.protocol === "https:" ? "443" : "80");
  if (from.protocol === to.protocol) return port(from) === port(to);
  return from.protocol === "http:" && to.protocol === "https:";
}

/**
 * طلب HTTP(S) محمي.
 * @param {string} url
 * @param {{method?:string, headers?:Object, body?:string|Buffer, timeoutMs?:number, maxRedirects?:number,
 *          maxBytes?:number, signal?:AbortSignal, verifyTLS?:boolean, allowPrivateHosts?:string[],
 *          allowPrivateNetworks?:boolean}} options
 * @returns {Promise<{status:number, headers:Object, body:Buffer, url:string}>}
 * @throws {NetGuardError} + timeout · aborted · too-large · redirect-blocked · too-many-redirects · network · tls
 */
async function guardedRequest(url, options = {}) {
  const {
    method = "GET", headers = {}, body = null, timeoutMs = 15000, maxRedirects = 3,
    maxBytes = 5 * 1024 * 1024, signal = null, verifyTLS = true,
  } = options;
  const policy = { allowPrivateHosts: options.allowPrivateHosts || [], allowPrivateNetworks: Boolean(options.allowPrivateNetworks) };
  let current = checkUrl(url, policy);
  let currentMethod = method;
  let currentBody = body;
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const response = await once(current, { method: currentMethod, headers, body: currentBody, timeoutMs, maxBytes, signal, verifyTLS, policy });
    if (![301, 302, 303, 307, 308].includes(response.status) || !response.headers.location) return { ...response, url: current.toString() };
    let next;
    try {
      next = checkUrl(new URL(response.headers.location, current).toString(), policy);
    } catch (error) {
      throw error instanceof NetGuardError ? error : new NetGuardError("redirect-blocked");
    }
    // بيانات الاعتماد لا تغادر المضيف الأصلي أبداً
    if (!sameTarget(current, next)) throw new NetGuardError("redirect-blocked");
    if (response.status === 303 || ((response.status === 301 || response.status === 302) && currentMethod === "POST")) {
      currentMethod = "GET";
      currentBody = null;
    }
    current = next;
  }
  throw new NetGuardError("too-many-redirects");
}

function once(url, { method, headers, body, timeoutMs, maxBytes, signal, verifyTLS, policy }) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new NetGuardError("aborted"));
    const lib = url.protocol === "https:" ? https : http;
    const req = lib.request(url, {
      method,
      headers: { ...headers, ...(body ? { "Content-Length": Buffer.byteLength(body) } : {}) },
      lookup: guardedLookup(policy),
      rejectUnauthorized: verifyTLS !== false,
      timeout: timeoutMs,
      agent: false,
    }, (res) => {
      const chunks = [];
      let size = 0;
      res.on("data", (chunk) => {
        size += chunk.length;
        if (size > maxBytes) {
          req.destroy(new NetGuardError("too-large"));
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () => resolve({ status: res.statusCode || 0, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on("error", (error) => reject(mapError(error)));
    });
    const onAbort = () => req.destroy(new NetGuardError("aborted"));
    signal?.addEventListener?.("abort", onAbort, { once: true });
    req.on("timeout", () => req.destroy(new NetGuardError("timeout")));
    req.on("error", (error) => reject(mapError(error)));
    req.on("close", () => signal?.removeEventListener?.("abort", onAbort));
    if (body) req.write(body);
    req.end();
  });
}

function mapError(error) {
  if (error instanceof NetGuardError) return error;
  const code = String(error?.code || "");
  if (/CERT|SSL|TLS|SELF_SIGNED|UNABLE_TO_VERIFY/i.test(code) || /certificate/i.test(error?.message || "")) return new NetGuardError("tls");
  if (code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT") return new NetGuardError("timeout");
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return new NetGuardError("dns-failed");
  return new NetGuardError("network");
}

export { NetGuardError, blockedAddress, blockedHostname, checkUrl, guardedLookup, guardedRequest, ipv6Words, isPrivateAddress, resolvePublic };
export default { checkUrl, resolvePublic, guardedRequest, blockedAddress, isPrivateAddress, NetGuardError };
