import { useEffect, useRef, useState } from "react";
import "./App.css";

const API_BASE = "https://ask-olake-lr0d.onrender.com";

const SUGGESTIONS = [
  "Which source databases and systems can OLake ingest data from?",
  "Where can OLake write data to?",
  "What sync modes does OLake support?",
  "What is an incremental sync in OLake?",
];

function TypingDots() {
  return (
    <div className="msg bot typing">
      <div className="avatar bot-avatar">
        <OLakeIcon />
      </div>
      <div className="bubble">
        <span className="dot" /><span className="dot" /><span className="dot" />
      </div>
    </div>
  );
}

function OLakeIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 46" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path fill="currentColor" d="M25.946 44.938c-.664.845-2.021.375-2.021-.698V33.937a2.26 2.26 0 0 0-2.262-2.262H10.287c-.92 0-1.456-1.04-.92-1.788l7.48-10.471c1.07-1.497 0-3.578-1.842-3.578H1.237c-.92 0-1.456-1.04-.92-1.788L10.013.474c.214-.297.556-.474.92-.474h28.894c.92 0 1.456 1.04.92 1.788l-7.48 10.471c-1.07 1.498 0 3.579 1.842 3.579h11.377c.943 0 1.473 1.088.89 1.83L25.947 44.94z"/>
    </svg>
  );
}

function SendIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}

function ExternalLinkIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

function renderMarkdown(text) {
  // code blocks
  text = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) =>
    `<pre><code class="lang-${lang}">${escHtml(code.trim())}</code></pre>`
  );
  // inline code
  text = text.replace(/`([^`]+)`/g, (_, c) => `<code>${escHtml(c)}</code>`);
  // bold
  text = text.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  // italic
  text = text.replace(/\*(.+?)\*/g, "<em>$1</em>");
  // headings
  text = text.replace(/^### (.+)$/gm, "<h3>$1</h3>");
  text = text.replace(/^## (.+)$/gm, "<h2>$1</h2>");
  text = text.replace(/^# (.+)$/gm, "<h1>$1</h1>");
  // unordered list items
  text = text.replace(/^[-*] (.+)$/gm, "<li>$1</li>");
  text = text.replace(/(<li>.*<\/li>)/s, "<ul>$1</ul>");
  // numbered list
  text = text.replace(/^\d+\. (.+)$/gm, "<li>$1</li>");
  // line breaks
  text = text.replace(/\n{2,}/g, "</p><p>");
  text = text.replace(/\n/g, "<br/>");
  return `<p>${text}</p>`;
}

function escHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function Message({ m }) {
  const isUser = m.role === "user";
  const isError = m.role === "error";

  return (
    <div className={`msg ${m.role}`}>
      {!isUser && (
        <div className={`avatar ${isError ? "error-avatar" : "bot-avatar"}`}>
          {isError ? "!" : <OLakeIcon />}
        </div>
      )}
      <div className="bubble">
        {isUser ? (
          <span>{m.text}</span>
        ) : (
          <div
            className="md-content"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(m.text) }}
          />
        )}
        {m.sources && m.sources.length > 0 && (
          <div className="sources">
            <span className="sources-label">Sources</span>
            <div className="sources-list">
              {m.sources.map((url) => {
                const label = url.replace(/^https?:\/\//, "").replace(/\/$/, "");
                return (
                  <a key={url} href={url} target="_blank" rel="noopener noreferrer" className="source-chip">
                    {label} <ExternalLinkIcon />
                  </a>
                );
              })}
            </div>
          </div>
        )}
      </div>
      {isUser && <div className="avatar user-avatar">You</div>}
    </div>
  );
}

export default function App() {
  const [messages, setMessages] = useState([
    {
      role: "bot",
      text: "Hi! I'm the **OLake Assistant**. Ask me anything about OLake setup, sources, sync modes, catalogs, maintenance, or troubleshooting.",
      sources: [],
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const chatRef = useRef(null);
  const inputRef = useRef(null);

  function scrollToBottom() {
    requestAnimationFrame(() => {
      const el = chatRef.current;
      if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    });
  }

  function addMessage(msg) {
    setMessages((prev) => [...prev, msg]);
    scrollToBottom();
  }

  useEffect(scrollToBottom, [messages]);

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
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }

  const showSuggestions = messages.length === 1 && !busy;

  return (
    <div className="layout">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <OLakeIcon size={24} />
          <span>OLake</span>
        </div>
        <nav className="sidebar-nav">
          <span className="nav-label">Assistant</span>
          <a className="nav-item active" href="#">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            Ask OLake
          </a>
        </nav>
        <div className="sidebar-footer">
          <a href="https://olake.io/docs" target="_blank" rel="noopener noreferrer" className="footer-link">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
            Docs
          </a>
          <a href="https://github.com/datazip-inc/olake" target="_blank" rel="noopener noreferrer" className="footer-link">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.385-1.335-1.755-1.335-1.755-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 21.795 24 17.295 24 12c0-6.63-5.37-12-12-12"/></svg>
            GitHub
          </a>
        </div>
      </aside>

      {/* Main chat area */}
      <main className="chat-main">
        <header className="chat-header">
          <div className="header-title">
            <OLakeIcon size={18} />
            <span>Ask OLake</span>
          </div>
          <span className="header-sub">OLake Go &amp; OLake Fusion</span>
        </header>

        <div className="chat-body" ref={chatRef}>
          {messages.map((m, i) => (
            <Message key={i} m={m} />
          ))}
          {busy && <TypingDots />}

          {showSuggestions && (
            <div className="suggestions">
              <p className="suggestions-label">Try asking</p>
              <div className="suggestions-grid">
                {SUGGESTIONS.map((s) => (
                  <button key={s} className="suggestion-btn" onClick={() => ask(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="chat-input-area">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              ask(input.trim());
            }}
          >
            <div className="input-wrapper">
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask anything about OLake…"
                disabled={busy}
                required
                autoFocus
              />
              <button type="submit" disabled={busy || !input.trim()} aria-label="Send">
                <SendIcon />
              </button>
            </div>
          </form>
          <p className="input-hint">OLake Assistant may make mistakes. Verify with the <a href="https://olake.io/docs" target="_blank" rel="noopener noreferrer">official docs</a>.</p>
        </div>
      </main>
    </div>
  );
}
