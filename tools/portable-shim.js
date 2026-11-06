(function () {
  var map = window.__SF_DLC_ASSETS__ || {};
  var EMPTY = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";
  function stripQuotes(s) {
    if (!s) return s;
    var a = s.charAt(0);
    if (a === '"' || a === "'") return s.slice(1, -1);
    return s;
  }
  function fixBg(el) {
    var bg = el.style.backgroundImage || "";
    if (bg.indexOf("/dlc/") < 0) return;
    var out = "", idx = 0, guard = 0;
    while (guard++ < 20) {
      var a = bg.indexOf("url(", idx);
      if (a < 0) { out += bg.slice(idx); break; }
      var b = bg.indexOf(")", a);
      if (b < 0) { out += bg.slice(idx); break; }
      var inner = stripQuotes(bg.slice(a + 4, b).trim());
      out += bg.slice(idx, a);
      if (inner.indexOf("/dlc/") === 0) {
        var val = map[inner];
        out += val ? "url(\"" + val + "\")" : "none";
      } else {
        out += "url(\"" + inner + "\")";
      }
      idx = b + 1;
    }
    el.style.backgroundImage = out;
  }
  function fix(root) {
    if (!root) return;
    var scope = root.querySelectorAll ? root : document;
    if (root.tagName === "IMG") {
      var s0 = root.getAttribute("src") || "";
      if (s0.indexOf("/dlc/") === 0) root.src = map[s0] || EMPTY;
    }
    var imgs = scope.querySelectorAll ? scope.querySelectorAll("img[src]") : [];
    Array.prototype.forEach.call(imgs, function (img) {
      var s = img.getAttribute("src") || "";
      if (s.indexOf("/dlc/") === 0) img.src = map[s] || EMPTY;
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
