// AI Assistant page — full-page chat surface wired into the engagement's
// session log. Replaces the floating ChatBubble used pre-pivot.

import { useEffect, useRef, useState } from "react";
import {
  authFetch,
  fetchApiKeyStatus,
  fetchChatConfig,
  formatDetail,
  setApiKey as putApiKey,
  deleteApiKey,
  type ApiKeyStatus,
  type ChatConfig,
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

export default function AiAssistant({ activePage }: Props) {
  const [showSettings, setShowSettings] = useState(false);
  const [keyStatus, setKeyStatus] = useState<ApiKeyStatus | null>(null);
  const [chatConfig, setChatConfig] = useState<ChatConfig | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [savingKey, setSavingKey] = useState(false);

  const [messages, setMessages] = useState<ChatMessage[]>(() => loadMessages());
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  const events = useSessionLog();
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => { saveMessages(messages); }, [messages]);

  const refreshChatConfig = () => {
    fetchApiKeyStatus().then(setKeyStatus).catch(() => setKeyStatus({ present: false }));
    fetchChatConfig().then(setChatConfig).catch(() => setChatConfig(null));
  };

  useEffect(() => {
    refreshChatConfig();
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function saveKey() {
    setSavingKey(true);
    try {
      const s = await putApiKey(keyInput.trim());
      setKeyStatus(s);
      setKeyInput("");
      setShowSettings(false);
      // Provider may have flipped now that a key is present.
      refreshChatConfig();
    } catch (e) {
      alert(`Failed to save key: ${e instanceof Error ? e.message : e}`);
    } finally {
      setSavingKey(false);
    }
  }

  async function clearKey() {
    if (!confirm("Remove the saved Anthropic API key from the Keychain?")) return;
    setKeyStatus(await deleteApiKey());
    refreshChatConfig();
  }

  function send() {
    const text = input.trim();
    if (!text || sending) return;
    // Gate on the backend's resolved provider so the CLI-fallback path
    // works when there's no API key but the local CLI is installed.
    if (chatConfig && !chatConfig.usable) {
      setShowSettings(true);
      return;
    }
    if (!chatConfig && !keyStatus?.present) {
      // Conservative fallback if config didn't load yet.
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

  return (
    <div className="h-full flex flex-col font-mono">
      <header className="flex items-center gap-2 px-4 py-2 border-b border-divider bg-bg-sidebar">
        <span className="text-accent text-[11px] font-bold tracking-widest">AI ASSISTANT</span>
        <span className="text-ink-dim text-[10px]">
          {chatConfig?.model ?? "claude-sonnet-4-6"}
        </span>
        <ProviderPill cfg={chatConfig} keyPresent={!!keyStatus?.present} />
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
      </header>

      {chatConfig && !chatConfig.usable && (
        <div className="border-b border-amber/40 bg-amber/10 px-4 py-2 text-[11px] text-amber flex items-center gap-2">
          <span>⚠</span>
          <span className="flex-1">
            Chat is unusable.{" "}
            {chatConfig.provider === "anthropic"
              ? "Add an Anthropic API key in Settings."
              : "Claude Code CLI not found — install it, or add an Anthropic API key in Settings."}
          </span>
          <button onClick={() => setShowSettings(true)}
                  className="text-amber underline decoration-dotted">
            Open Settings
          </button>
        </div>
      )}
      {chatConfig?.usable && chatConfig.provider === "claude-cli" && !keyStatus?.present && (
        <div className="border-b border-divider bg-bg-base px-4 py-1.5 text-[10px] text-ink-dim">
          Using local <code className="text-amber">claude</code> CLI (your Claude Code subscription).
          Add an API key in Settings to use the SDK directly + avoid 5-hour rate limits.
        </div>
      )}

      {showSettings ? (
        <div className="flex-1 overflow-y-auto p-6 text-[12px] space-y-4 max-w-2xl">
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
                Back to chat
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
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-3 text-ink-primary">
          {messages.length === 0 && (
            <div className="text-ink-dim text-[13px] leading-relaxed max-w-2xl">
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
                    ? "max-w-[75%] bg-accentDim/40 border border-accentDim rounded-md px-3 py-2 text-[13px]"
                    : "max-w-3xl w-full"
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

      {!showSettings && (
        <div className="border-t border-divider p-3 flex gap-2">
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
            rows={2}
            className="flex-1 resize-none bg-bg-base border border-divider rounded px-3 py-2
                       text-[13px] text-ink-primary focus:outline-none focus:border-accent
                       max-h-40"
          />
          {sending ? (
            <button
              onClick={stop}
              className="px-3 py-1.5 rounded bg-bg-base border border-danger text-danger text-[12px]"
            >
              Stop
            </button>
          ) : (
            <button
              onClick={send}
              disabled={!input.trim()}
              className="px-4 py-1.5 rounded bg-accent text-white text-[12px] font-bold
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
    res = await authFetch(`/chat/stream`, {
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

function ProviderPill({ cfg, keyPresent }: { cfg: ChatConfig | null; keyPresent: boolean }) {
  if (!cfg) return null;
  const label = cfg.provider === "anthropic" ? "anthropic" : "cli";
  const tone = cfg.usable
    ? (cfg.provider === "anthropic" ? "border-phos/40 text-phos" : "border-amber/40 text-amber")
    : "border-danger/40 text-danger";
  const title = cfg.provider === "anthropic"
    ? (keyPresent ? "Using Anthropic SDK directly with your API key." : "Anthropic provider selected but no API key — chat won't work.")
    : (cfg.cli_present ? "Using local `claude` CLI (your Claude Code subscription). May rate-limit." : "claude CLI not found — chat won't work.");
  return (
    <span className={"inline-flex items-center gap-1 border rounded px-1.5 py-0.5 text-[9px] uppercase tracking-widest " + tone}
          title={title}>
      <span className={"inline-block w-1 h-1 rounded-full " + (cfg.usable ? "bg-current" : "bg-current opacity-50")} />
      {label}
    </span>
  );
}
