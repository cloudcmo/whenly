/* Whenly domain move (Oct 2026): whenly.co.uk -> whenly.carlosfandango.net.
   Included first in the <head> of every page. Does two jobs by hostname:
   - On the OLD hosts: copy localStorage (streak, state, the guff bar's ticks)
     into the URL hash and send the browser to the new address. PHASE "silent"
     goes at once; PHASE "notice" goes via /moved.html, which shows "this game
     has moved, update your bookmark" and forwards after a few seconds.
     Flip PHASE to "notice" on Thu 12 Nov 2026 (see the consolidation plan).
   - On the NEW host: write any ABSENT keys from the hash into localStorage
     (never overwrites), then drop guffmove from the hash, leaving #guff=<id>
     for the guff bar. Runs before the page's own scripts. */
(function () {
  var OLD = ["whenly.co.uk", "www.whenly.co.uk"];
  var NEW = "https://whenly.carlosfandango.net";
  var PHASE = "silent";
  var SECS = 6;

  function b64url(s) { return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
  function unb64url(s) { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; return decodeURIComponent(escape(atob(s))); }

  function destination(pathAndSearch) {
    var bundle = {}, id = null, m = (location.hash || "").match(/[#&]guff=([A-Za-z0-9-]{8,64})/);
    try {
      for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k === "guffbar_id") continue; bundle[k] = localStorage.getItem(k); }
      id = (m && m[1]) || localStorage.getItem("guffbar_id");
    } catch (e) {}
    var parts = [];
    if (id) parts.push("guff=" + id);
    var json = JSON.stringify(bundle);
    if (json !== "{}") parts.push("guffmove=" + b64url(json));
    return NEW + pathAndSearch + (parts.length ? "#" + parts.join("&") : "");
  }

  if (OLD.indexOf(location.hostname) >= 0) {
    var onNotice = location.pathname === "/moved.html";
    if (onNotice) {
      var to = new URLSearchParams(location.search).get("to") || "/";
      if (to.charAt(0) !== "/") to = "/";
      var dest = destination(to);
      document.addEventListener("DOMContentLoaded", function () {
        var go = document.getElementById("go"), el = document.getElementById("count"), left = SECS;
        if (go) go.href = dest;
        (function tick() {
          if (el) el.textContent = "Taking you there in " + left + "…";
          if (left-- <= 0) { location.replace(dest); return; }
          setTimeout(tick, 1000);
        })();
      });
      return;
    }
    if (PHASE === "notice") {
      location.replace("/moved.html?to=" + encodeURIComponent(location.pathname + location.search) + (location.hash || ""));
    } else {
      location.replace(destination(location.pathname + location.search));
    }
    return;
  }

  // New host: import.
  try {
    var h = location.hash || "", mm = h.match(/[#&]guffmove=([A-Za-z0-9_-]+)/); if (!mm) return;
    var incoming = JSON.parse(unb64url(mm[1]));
    Object.keys(incoming).forEach(function (k) { if (localStorage.getItem(k) === null) localStorage.setItem(k, incoming[k]); });
    var cleaned = h.replace(/[#&]guffmove=[A-Za-z0-9_-]+/, "");
    if (cleaned && cleaned.charAt(0) === "&") cleaned = "#" + cleaned.slice(1);
    history.replaceState(null, "", location.pathname + location.search + (cleaned && cleaned !== "#" ? cleaned : ""));
  } catch (e) {}
})();
