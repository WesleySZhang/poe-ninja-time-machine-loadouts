// pobb.in upload, as done by Path of Building's own "Share" (PoB v2.67.2,
// src/Modules/BuildSiteTools.lua: postUrl "https://pobb.in/pob/", postFields "", codeOut
// "https://pobb.in/"): POST the raw build code; a 200 reply body is the paste id.
(function (root) {
  "use strict";

  const POST_URL = "https://pobb.in/pob/";
  const LINK_BASE = "https://pobb.in/";

  async function uploadToPobbin(code, fetchImpl) {
    if (typeof code !== "string" || code.length === 0) throw new Error("Nothing to upload");
    const f = fetchImpl || fetch;
    let res;
    try {
      res = await f(POST_URL, { method: "POST", headers: { "Content-Type": "text/plain" }, body: code });
    } catch (e) {
      throw new Error("Could not reach pobb.in");
    }
    const text = (await res.text()).trim();
    if (res.status !== 200) {
      throw new Error("pobb.in refused the upload (HTTP " + res.status + (text ? ": " + text.slice(0, 200) : "") + ")");
    }
    if (!/^[A-Za-z0-9_-]{4,64}$/.test(text)) {
      throw new Error("pobb.in sent an unexpected reply: " + text.slice(0, 200));
    }
    return LINK_BASE + text;
  }

  const api = { uploadToPobbin: uploadToPobbin, POST_URL: POST_URL };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.NinjaUpload = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
