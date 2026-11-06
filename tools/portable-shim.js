(function () {
  var dlc = window.__SF_DLC_ASSETS__ || {};
  var battle = window.__SF_BATTLE_ASSETS__ || {};
  var manifest = window.__SF_BATTLE_MANIFEST__ || null;
  var EMPTY = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";
  function stripQuotes(s) {
    if (!s) return s;
    var a = s.charAt(0);
    if (a === '"' || a === "'") return s.slice(1, -1);
    return s;
  }
  function lookup(url) {
    if (url.indexOf("/dlc/") === 0) return dlc[url];
    if (url.indexOf("/battle/") === 0) return battle[url];
    return null;
  }
  // Image() вне DOM: перехватываем src, чтобы арт M5b/Древних грузился под file://
  try {
    var desc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src");
    if (desc && desc.set) {
      Object.defineProperty(HTMLImageElement.prototype, "src", {
        configurable: true,
        get: desc.get,
        set: function (v) { var hit = lookup(String(v)); desc.set.call(this, hit || v); }
      });
    }
  } catch (e) { /* noop */ }
  // fetch('/battle/manifest.json') под file:// отдаём из встроенного манифеста
  try {
    var origFetch = window.fetch;
    window.fetch = function (input) {
      var url = typeof input === "string" ? input : (input && input.url) || "";
      if (manifest && url.indexOf("/battle/manifest.json") >= 0) {
        return Promise.resolve(new Response(JSON.stringify(manifest), { status: 200, headers: { "Content-Type": "application/json" } }));
      }
      var hit = lookup(url);
      if (hit) return Promise.resolve(new Response("", { status: 200 }));
      return origFetch.apply(this, arguments);
    };
  } catch (e) { /* noop */ }
  function fixBg(el) {
    var bg = el.style.backgroundImage || "";
    if (bg.indexOf("/dlc/") < 0 && bg.indexOf("/battle/") < 0) return;
    var out = "", idx = 0, guard = 0;
    while (guard++ < 20) {
      var a = bg.indexOf("url(", idx);
      if (a < 0) { out += bg.slice(idx); break; }
      var b = bg.indexOf(")", a);
      if (b < 0) { out += bg.slice(idx); break; }
      var inner = stripQuotes(bg.slice(a + 4, b).trim());
      out += bg.slice(idx, a);
      var hit = lookup(inner);
      out += hit ? "url(\"" + hit + "\")" : (inner.indexOf("/dlc/") === 0 || inner.indexOf("/battle/") === 0 ? "none" : "url(\"" + inner + "\")");
      idx = b + 1;
    }
    el.style.backgroundImage = out;
  }
  function fix(root) {
    if (!root) return;
    var scope = root.querySelectorAll ? root : document;
    if (root.tagName === "IMG") {
      var s0 = root.getAttribute("src") || "";
      var h0 = lookup(s0);
      if (h0) root.src = h0;
    }
    var imgs = scope.querySelectorAll ? scope.querySelectorAll("img[src]") : [];
    Array.prototype.forEach.call(imgs, function (img) {
      var s = img.getAttribute("src") || "";
      var hit = lookup(s);
      if (hit) img.src = hit;
    });
    var styled = scope.querySelectorAll ? scope.querySelectorAll("[style]") : [];
    Array.prototype.forEach.call(styled, function (el) { fixBg(el); });
  }
  var mo = new MutationObserver(function (list) { list.forEach(function (m) { fix(m.target); }); });
  function start() {
    fix(document);
    mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["src", "style"] });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else setTimeout(start, 0);
})();
