import { useEffect, useRef, useState } from "react";
import {
  BACKEND_URL,
  fetchApiKeyStatus,
  formatDetail,
  setApiKey as putApiKey,
  deleteApiKey,
  type ApiKeyStatus,
} from "../api";
import { snapshot, useSessionLog, clearLog } from "../lib/sessionLog";

type ChatRole = "user" | "assistant";

type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  thinking?: string;
  streaming?: boolean;
  error?: string;
};

const STORAGE_KEY = "mhp:chat:messages:v1";

function loadMessages(): ChatMessage[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as ChatMessage[];
  } catch {
    return [];
  }
}

function saveMessages(msgs: ChatMessage[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(msgs.slice(-200)));
  } catch {
    /* quota — ignore */
  }
}

// Tiny inline-only renderer: backticks → <code>. Preserves newlines via
// `whitespace-pre-wrap` on the surrounding element.
function renderInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const re = /`([^`\n]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(
      <code key={key++} className="bg-bg-base px-1 py-0.5 rounded text-amber text-[12px]">
        {m[1]}
      </code>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function MessageBody({ msg }: { msg: ChatMessage }) {
  // Split fenced code blocks (```…```) from prose; render fenced as <pre>.
  const blocks: { kind: "code" | "text"; body: string }[] = [];
  const fence = /```([\s\S]*?)```/g;
  let cursor = 0;
  let m: RegExpExecArray | null;
  while ((m = fence.exec(msg.content)) !== null) {
    if (m.index > cursor) blocks.push({ kind: "text", body: msg.content.slice(cursor, m.index) });
    blocks.push({ kind: "code", body: m[1].replace(/^\w*\n?/, "") });
    cursor = m.index + m[0].length;
  }
  if (cursor < msg.content.length) blocks.push({ kind: "text", body: msg.content.slice(cursor) });

  return (
    <>
      {blocks.map((b, i) =>
        b.kind === "code" ? (
          <pre key={i} className="my-2 p-2 rounded bg-bg-base border border-divider overflow-x-auto text-[12px] text-phos">
            {b.body}
          </pre>
        ) : (
          <div key={i} className="whitespace-pre-wrap text-[13px] leading-relaxed">
            {renderInline(b.body)}
          </div>
        ),
      )}
    </>
  );
}

type Props = { activePage: string };

export default function ChatBubble({ activePage }: Props) {
  const [open, setOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [keyStatus, setKeyStatus] = useState<ApiKeyStatus | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [savingKey, setSavingKey] = useState(false);

  const [messages, setMessages] = useState<ChatMessage[]>(() => loadMessages());
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  const events = useSessionLog();
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Persist transcript
  useEffect(() => { saveMessages(messages); }, [messages]);

  // Load key status when panel opens (or on first mount so the badge is fresh)
  useEffect(() => {
    if (!open) return;
    fetchApiKeyStatus().then(setKeyStatus).catch(() => setKeyStatus({ present: false }));
  }, [open]);

  // Auto-scroll on new content
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Cancel any inflight stream on unmount
  useEffect(() => () => abortRef.current?.abort(), []);

  async function saveKey() {
    setSavingKey(true);
    try {
      const s = await putApiKey(keyInput.trim());
      setKeyStatus(s);
      setKeyInput("");
      setShowSettings(false);
    } catch (e) {
      alert(`Failed to save key: ${e instanceof Error ? e.message : e}`);
    } finally {
      setSavingKey(false);
    }
  }

  async function clearKey() {
    if (!confirm("Remove the saved Anthropic API key from the Keychain?")) return;
    setKeyStatus(await deleteApiKey());
  }

  function send() {
    const text = input.trim();
    if (!text || sending) return;
    if (!keyStatus?.present) {
      setShowSettings(true);
      return;
    }
    setInput("");

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(), role: "user", content: text,
    };
    const asstMsg: ChatMessage = {
      id: crypto.randomUUID(), role: "assistant", content: "", streaming: true,
    };
    const nextMsgs = [...messages, userMsg, asstMsg];
    setMessages(nextMsgs);
    setSending(true);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const payload = {
      messages: nextMsgs
        .filter((m) => !m.streaming)
        .map((m) => ({ role: m.role, content: m.content })),
      session_log: snapshot(),
      active_page: activePage,
    };

    streamChat(payload, ctrl.signal, {
      onText: (delta) => {
        setMessages((prev) => prev.map((m) =>
          m.id === asstMsg.id ? { ...m, content: m.content + delta } : m,
        ));
      },
      onThinking: (delta) => {
        setMessages((prev) => prev.map((m) =>
          m.id === asstMsg.id ? { ...m, thinking: (m.thinking ?? "") + delta } : m,
        ));
      },
      onError: (detail) => {
        setMessages((prev) => prev.map((m) =>
          m.id === asstMsg.id ? { ...m, streaming: false, error: detail } : m,
        ));
      },
      onDone: () => {
        setMessages((prev) => prev.map((m) =>
          m.id === asstMsg.id ? { ...m, streaming: false } : m,
        ));
      },
    }).finally(() => {
      setSending(false);
      abortRef.current = null;
    });
  }

  function stop() {
    abortRef.current?.abort();
  }

  function clearChat() {
    if (!confirm("Clear the chat transcript? (Session log is separate.)")) return;
    setMessages([]);
  }

  const eventCount = events.length;

  // ── Floating button ──
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-50 w-12 h-12 rounded-full bg-accent text-white
                   shadow-lg hover:scale-105 transition flex items-center justify-center
                   font-bold text-lg ring-2 ring-bg-base"
        title="Ask the assistant"
        aria-label="Open assistant chat"
      >
        AI
      </button>
    );
  }

  // ── Expanded panel ──
  return (
    <div
      className="fixed bottom-5 right-5 z-50 w-[420px] h-[600px] bg-bg-card border border-divider
                 rounded-lg shadow-2xl flex flex-col font-mono"
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-divider bg-bg-sidebar
                      rounded-t-lg">
        <span className="text-accent text-[11px] font-bold tracking-widest">ASSISTANT</span>
        <span className="text-ink-dim text-[10px]">claude-opus-4-7</span>
        <span className="flex-1" />
        <span className="text-[10px] text-ink-dim" title="Session log entries Claude can see">
          ctx {eventCount}
        </span>
        <button
          onClick={() => { setShowSettings((s) => !s); }}
          className="text-ink-muted hover:text-ink-primary text-sm px-1"
          title="Settings"
        >⚙</button>
        <button
          onClick={clearChat}
          className="text-ink-muted hover:text-ink-primary text-xs px-1"
          title="Clear chat"
        >⎚</button>
        <button
          onClick={() => setOpen(false)}
          className="text-ink-muted hover:text-ink-primary px-1"
          title="Close"
        >✕</button>
      </div>

      {/* Body */}
      {showSettings ? (
        <div className="flex-1 overflow-y-auto p-4 text-[12px] space-y-3">
          <div>
            <div className="text-ink-primary font-bold text-[13px] mb-1">Anthropic API key</div>
            <div className="text-ink-dim text-[11px] mb-2">
              Stored in the macOS Keychain under <code className="text-amber">MyHackingPal</code>.
              Never written to disk.
            </div>
            <div className="text-[11px] mb-2">
              Status:{" "}
              {keyStatus?.present ? (
                <span className="text-phos">configured (…{keyStatus.last4})</span>
              ) : (
                <span className="text-amber">not set</span>
              )}
            </div>
            <input
              type="password"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="sk-ant-…"
              className="w-full bg-bg-base border border-divider rounded px-2 py-1.5
                         text-[12px] text-ink-primary focus:outline-none focus:border-accent"
            />
            <div className="flex gap-2 mt-2">
              <button
                onClick={saveKey}
                disabled={savingKey || keyInput.trim().length < 10}
                className="px-3 py-1 rounded bg-accent text-white text-[12px] font-bold
                           disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {savingKey ? "Saving…" : "Save"}
              </button>
              {keyStatus?.present && (
                <button
                  onClick={clearKey}
                  className="px-3 py-1 rounded bg-bg-base border border-danger text-danger text-[12px]"
                >
                  Remove
                </button>
              )}
              <button
                onClick={() => setShowSettings(false)}
                className="px-3 py-1 rounded bg-bg-base border border-divider text-ink-muted text-[12px] ml-auto"
              >
                Back
              </button>
            </div>
          </div>

          <div className="border-t border-divider pt-3">
            <div className="text-ink-primary font-bold text-[13px] mb-1">Session log</div>
            <div className="text-ink-dim text-[11px] mb-2">
              {eventCount} recent tool results are visible to the assistant.
            </div>
            <button
              onClick={() => { clearLog(); }}
              className="px-3 py-1 rounded bg-bg-base border border-divider text-ink-muted text-[12px]"
            >
              Clear session log
            </button>
          </div>
        </div>
      ) : (
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3 text-ink-primary">
          {messages.length === 0 && (
            <div className="text-ink-dim text-[12px] leading-relaxed">
              <p>
                Hi — I'm wired into MyHackingPal. I can see your recent tool results
                (currently <span className="text-accent">{eventCount}</span> entries in
                this session) and explain what they mean. Try:
              </p>
              <ul className="list-disc ml-5 mt-2 space-y-1">
                <li>"What does this scan show?"</li>
                <li>"Why is that port flagged as high risk?"</li>
                <li>"Explain what the {labelFor(activePage)} tool does."</li>
              </ul>
            </div>
          )}

          {messages.map((m) => (
            <div key={m.id} className={m.role === "user" ? "flex justify-end" : ""}>
              <div
                className={
                  m.role === "user"
                    ? "max-w-[85%] bg-accentDim/40 border border-accentDim rounded-md px-3 py-2 text-[13px]"
                    : "max-w-full w-full"
                }
              >
                {m.role === "assistant" && m.thinking && m.streaming && !m.content && (
                  <div className="text-ink-dim text-[11px] italic mb-1">thinking…</div>
                )}
                <MessageBody msg={m} />
                {m.role === "assistant" && m.streaming && m.content && (
                  <span className="inline-block w-2 h-3 bg-accent align-text-bottom animate-pulse ml-0.5" />
                )}
                {m.error && (
                  <div className="text-danger text-[11px] mt-1">⚠ {m.error}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Footer */}
      {!showSettings && (
        <div className="border-t border-divider p-2 flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={keyStatus?.present
              ? "Ask about the current view or your scan results…"
              : "Set an API key in ⚙ Settings first"}
            rows={1}
            className="flex-1 resize-none bg-bg-base border border-divider rounded px-2 py-1.5
                       text-[13px] text-ink-primary focus:outline-none focus:border-accent
                       max-h-24"
          />
          {sending ? (
            <button
              onClick={stop}
              className="px-3 py-1 rounded bg-bg-base border border-danger text-danger text-[12px]"
            >
              Stop
            </button>
          ) : (
            <button
              onClick={send}
              disabled={!input.trim()}
              className="px-3 py-1 rounded bg-accent text-white text-[12px] font-bold
                         disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Send
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// Light human-readable mapping for nav ids — only used in the placeholder hint.
function labelFor(navId: string): string {
  const map: Record<string, string> = {
    ip: "IP Checker", lan: "LAN Scan", dns: "DNS Recon", whois: "WHOIS",
    ports: "Port Scanner", nmap: "Nmap", audit: "Network Audit",
    tls: "TLS Auditor", fingerprint: "Fingerprint", http: "HTTP Probe",
    ct: "CT Logs", email: "Email Security", takeover: "Takeover",
    revip: "Reverse IP", cms: "CMS", jwt: "JWT", graphql: "GraphQL",
    hash: "Hash Cracker", ids: "IDS", persistence: "Persistence",
    processes: "Processes", stego: "Steganography", macos: "macOS Posture",
    wifi: "WiFi Integrity", vpn: "VPN", term: "Terminal", brew: "Brew",
    tcpdump: "TCPDump", ping: "Ping", localdisco: "Local Discovery",
  };
  return map[navId] ?? navId;
}

// ── SSE streaming client ────────────────────────────────────────────────────

type StreamCallbacks = {
  onText: (delta: string) => void;
  onThinking: (delta: string) => void;
  onError: (detail: string) => void;
  onDone: () => void;
};

async function streamChat(
  body: unknown,
  signal: AbortSignal,
  cb: StreamCallbacks,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${BACKEND_URL}/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if (signal.aborted) return;
    cb.onError(e instanceof Error ? e.message : String(e));
    cb.onDone();
    return;
  }

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try { detail = formatDetail((await res.json()).detail) || detail; } catch { /* ignore */ }
    cb.onError(detail);
    cb.onDone();
    return;
  }

  const reader = res.body?.getReader();
  if (!reader) { cb.onDone(); return; }
  const decoder = new TextDecoder();
  let buf = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      // SSE frames are separated by blank lines
      let idx;
      while ((idx = buf.indexOf("\n\n")) !== -1) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const dataLine = frame.split("\n").find((l) => l.startsWith("data:"));
        if (!dataLine) continue;
        let evt: any;
        try { evt = JSON.parse(dataLine.slice(5).trim()); } catch { continue; }
        if (evt.type === "text_delta") cb.onText(evt.text);
        else if (evt.type === "thinking_delta") cb.onThinking(evt.text);
        else if (evt.type === "error") cb.onError(evt.detail);
        else if (evt.type === "done") { /* falls through to onDone below */ }
      }
    }
  } catch (e) {
    if (!signal.aborted) cb.onError(e instanceof Error ? e.message : String(e));
  } finally {
    cb.onDone();
  }
}
