(function () {
  "use strict";
  if (window.__askOlakeLoaded) return;
  window.__askOlakeLoaded = true;

  var script = document.currentScript;
  var apiBase =
    (script && script.getAttribute("data-api")) ||
    "https://ask-olake-lr0d.onrender.com";
  var accent = (script && script.getAttribute("data-accent")) || "#2f6fed";

  var open = false;
  var busy = false;
  var history = [];

  var root = document.createElement("div");
  root.setAttribute("data-ask-olake", "");
  root.style.cssText =
    "position:fixed;bottom:20px;right:20px;z-index:2147483647;font-family:system-ui,-apple-system,sans-serif;";

  root.innerHTML =
    '<button type="button" aria-label="Ask OLake" style="width:52px;height:52px;border-radius:50%;border:0;background:' +
    accent +
    ';color:#fff;font-size:22px;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.25);line-height:1;">?</button>' +
    '<div style="display:none;position:absolute;bottom:64px;right:0;width:min(380px,calc(100vw - 40px));height:min(520px,70vh);background:#fff;border:1px solid #e2e5ea;border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.22);flex-direction:column;overflow:hidden;">' +
    '<div style="padding:12px 14px;background:' +
    accent +
    ';color:#fff;font-size:14px;font-weight:600;display:flex;justify-content:space-between;align-items:center;">' +
    "<span>Ask OLake</span>" +
    '<button type="button" data-close aria-label="Close" style="border:0;background:transparent;color:#fff;font-size:18px;cursor:pointer;line-height:1;padding:0 2px;">&times;</button>' +
    "</div>" +
    '<div data-messages style="flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px;"></div>' +
    '<form style="display:flex;gap:6px;padding:10px;border-top:1px solid #e2e5ea;">' +
    '<input data-input type="text" placeholder="Ask about OLake docs…" maxlength="2000" required style="flex:1;padding:9px 10px;border:1px solid #cdd2da;border-radius:8px;font-size:13px;min-width:0;" />' +
    '<button data-send type="submit" style="border:0;border-radius:8px;padding:9px 14px;background:' +
    accent +
    ';color:#fff;font-size:13px;cursor:pointer;">Ask</button>' +
    "</form></div>";

  document.body.appendChild(root);

  var panel = root.querySelector("div[data-messages]").parentNode;
  var messages = root.querySelector("[data-messages]");
  var input = root.querySelector("[data-input]");
  var form = input.parentNode;
  var sendBtn = root.querySelector("[data-send]");

  function scrollDown() {
    messages.scrollTop = messages.scrollHeight;
  }

  function addMsg(role, text, sources) {
    var wrap = document.createElement("div");
    var bubble = document.createElement("div");
    var colors =
      role === "user"
        ? ["#e8f0fe", "#1a1d21", "flex-end"]
        : role === "error"
          ? ["#fdecea", "#b3261e", "stretch"]
          : ["#f1f3f5", "#1a1d21", "flex-start"];
    bubble.style.cssText =
      "max-width:92%;padding:9px 12px;border-radius:9px;font-size:13px;line-height:1.5;white-space:pre-wrap;word-wrap:break-word;background:" +
      colors[0] +
      ";color:" +
      colors[1] +
      ";align-self:" +
      colors[2] +
      ";";
    bubble.textContent = text;
    wrap.style.cssText = "display:flex;flex-direction:column;gap:3px;";
    wrap.appendChild(bubble);

    if (sources && sources.length) {
      var ul = document.createElement("ul");
      ul.style.cssText =
        "margin:4px 0 0;padding:0 0 0 14px;font-size:11px;color:#2f6fed;";
      sources.forEach(function (url) {
        var li = document.createElement("li");
        var a = document.createElement("a");
        a.href = url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = url;
        a.style.cssText = "color:#2f6fed;word-break:break-all;";
        li.appendChild(a);
        ul.appendChild(li);
      });
      wrap.appendChild(ul);
    }
    messages.appendChild(wrap);
    scrollDown();
  }

  function setBusy(state) {
    busy = state;
    sendBtn.disabled = state;
    input.disabled = state;
    sendBtn.textContent = state ? "…" : "Ask";
  }

  function ask(question) {
    addMsg("user", question);
    setBusy(true);
    var ctrl = new AbortController();
    var timer = setTimeout(function () {
      ctrl.abort();
    }, 90000);
    fetch(apiBase.replace(/\/$/, "") + "/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: question }),
      signal: ctrl.signal,
    })
      .then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok || data.error) {
            throw new Error(data.error || "request failed (" + res.status + ")");
          }
          return data;
        });
      })
      .then(function (data) {
        addMsg("bot", data.answer || "(empty answer)", data.sources || []);
      })
      .catch(function (err) {
        addMsg(
          "error",
          err.name === "AbortError"
            ? "Request timed out. Please try again."
            : "Error: " + err.message
        );
      })
      .finally(function () {
        clearTimeout(timer);
        setBusy(false);
        input.focus();
      });
  }

  root.querySelector("button").addEventListener("click", function () {
    open = !open;
    panel.style.display = open ? "flex" : "none";
    if (open) {
      if (!history.length) {
        history.push(1);
        addMsg(
          "bot",
          "Ask me anything about OLake — setup, sources, sync modes, catalogs, maintenance."
        );
      }
      input.focus();
    }
  });

  root.querySelector("[data-close]").addEventListener("click", function () {
    open = false;
    panel.style.display = "none";
  });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var q = input.value.trim();
    if (!q || busy) return;
    input.value = "";
    ask(q);
  });
})();
