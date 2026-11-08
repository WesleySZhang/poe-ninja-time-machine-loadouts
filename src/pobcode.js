// PoB build codes: base64url(zlib-deflate(XML)).
// Same format as Path of Building's export (PoB v2.67.2, src/Classes/ImportTab.lua:504
// common.base64.encode(Deflate(xml)) with "+" -> "-" and "/" -> "_"; import at :631 reverses it).
// Uses only CompressionStream / DecompressionStream ("deflate" = zlib format) and atob/btoa,
// which exist in Chrome 80+, Firefox 113+ and Node 18+.
(function (root) {
  "use strict";

  async function pipeBytes(bytes, stream) {
    const out = new Blob([bytes]).stream().pipeThrough(stream);
    return new Uint8Array(await new Response(out).arrayBuffer());
  }

  function base64UrlToBytes(code) {
    if (typeof code !== "string") throw new Error("PoB code must be a string");
    let b64 = code.trim().replace(/-/g, "+").replace(/_/g, "/").replace(/\s+/g, "");
    if (!/^[A-Za-z0-9+/]*=*$/.test(b64) || b64.length === 0) {
      throw new Error("PoB code is not valid base64");
    }
    b64 += "=".repeat((4 - (b64.length % 4)) % 4);
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  function bytesToBase64Url(bytes) {
    let bin = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_");
  }

  async function decode(code) {
    const bytes = base64UrlToBytes(code);
    let inflated;
    try {
      inflated = await pipeBytes(bytes, new DecompressionStream("deflate"));
    } catch (e) {
      throw new Error("PoB code could not be decompressed");
    }
    return new TextDecoder("utf-8").decode(inflated);
  }

  async function encode(xml) {
    if (typeof xml !== "string" || xml.length === 0) throw new Error("XML must be a non-empty string");
    const deflated = await pipeBytes(new TextEncoder().encode(xml), new CompressionStream("deflate"));
    return bytesToBase64Url(deflated);
  }

  const api = { decode, encode };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.NinjaPobCode = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
