import { useRef, useState } from "react";
import "./App.css";

const API_BASE = "https://ask-olake-lr0d.onrender.com";

export default function App() {
  const [messages, setMessages] = useState([
    {
      role: "bot",
      text: "Ask me anything about OLake setup, sources, sync modes, catalogs, maintenance or troubleshooting.",
      sources: [],
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const chatRef = useRef(null);

  function addMessage(msg) {
    setMessages((prev) => [...prev, msg]);
    requestAnimationFrame(() => {
      const el = chatRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }

  async function ask(question) {
    if (!question || busy) return;
    setInput("");
    setBusy(true);
    addMessage({ role: "user", text: question, sources: [] });
    try {
      const res = await fetch(`${API_BASE}/ask`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        addMessage({
          role: "error",
          text: `Error ${res.status}: ${data.error || "request failed"}`,
          sources: [],
        });
      } else {
        addMessage({
          role: "bot",
          text: data.answer || "(empty answer)",
          sources: data.sources || [],
        });
      }
    } catch (err) {
      addMessage({ role: "error", text: `Network error: ${err.message}`, sources: [] });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <header>
        <h1>Ask OLake</h1>
        <p>Chat assistant for OLake docs — OLake Go &amp; OLake Fusion</p>
      </header>

      <div className="app">
        <div className="chat" ref={chatRef}>
          {messages.map((m, i) => (
            <div key={i} className={`msg ${m.role}`}>
              {m.text}
              {m.sources.length > 0 && (
                <ul className="sources">
                  {m.sources.map((url) => (
                    <li key={url}>
                      <a href={url} target="_blank" rel="noopener noreferrer">
                        {url}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            ask(input.trim());
          }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="e.g. How do I set up Postgres CDC?"
            disabled={busy}
            required
          />
          <button type="submit" disabled={busy}>
            {busy ? "Asking…" : "Ask"}
          </button>
        </form>
      </div>
    </>
  );
}
