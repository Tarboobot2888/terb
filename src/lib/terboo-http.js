// طبقة التوافق القديمة: f(url, responseType, method, headers, body) ⇒ البيانات أو null
// تمر الآن عبر terboo-http-client (مهلة · قاطع دائرة · حد حجم · إعادة محاولة للقراءات فقط · بلا أسرار في الأخطاء)
// مع نفس السلوك الخارجي تماماً: null عند أي فشل.
import { httpRequest } from "./terboo-http-client.js";

const REQUEST_TIMEOUT = 60_000;
const TYPES = { json: "json", text: "text", arrayBuffer: "buffer", buffer: "buffer" };

async function f(url, responseType = "json", method = "GET", headers = {}, body = null) {
  const type = TYPES[responseType];
  if (!type) return null;
  const result = await httpRequest({
    url, method, body,
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36", ...headers },
    timeoutMs: REQUEST_TIMEOUT,
    responseType: type,
  });
  if (!result.ok) return null;
  if (responseType === "arrayBuffer") return result.data.buffer.slice(result.data.byteOffset, result.data.byteOffset + result.data.byteLength);
  return result.data;
}

export { f }
