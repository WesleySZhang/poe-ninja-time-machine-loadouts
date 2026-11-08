// Background script (Chrome service worker / Firefox event page). It does the work a content
// script can't do in every browser:
// - decoding/encoding PoB codes: Firefox content scripts can't use CompressionStream/DecompressionStream
//   (they fail with 'Permission denied to access property "constructor"'), background scripts can;
// - the pobb.in POST: content scripts are bound by the page's cross-site rules.
if (typeof importScripts === "function") importScripts("pobcode.js", "upload.js");

const ext = typeof browser !== "undefined" ? browser : chrome;

async function handle(msg) {
  if (msg.type === "decode-pob") return { xml: await globalThis.NinjaPobCode.decode(msg.code) };
  if (msg.type === "upload-pobbin") {
    const code = await globalThis.NinjaPobCode.encode(msg.xml);
    return { url: await globalThis.NinjaUpload.uploadToPobbin(code), size: code.length };
  }
  throw new Error("Unknown request");
}

ext.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg || (msg.type !== "decode-pob" && msg.type !== "upload-pobbin")) return false;
  handle(msg).then(
    function (result) { sendResponse(Object.assign({ ok: true }, result)); },
    function (e) { sendResponse({ ok: false, error: e.message || String(e) }); }
  );
  return true; // reply comes later
});
