import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  authFetch,
  fetchChatConfig,
  formatDetail,
  type ChatConfig,
} from "../api";
import {
  listEngagements,
  useActiveEngagementId,
  type Engagement,
} from "../lib/engagement";
import { snapshot } from "../lib/sessionLog";

type ChatRole = "user" | "assistant";

type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  thinking?: string;
  streaming?: boolean;
  error?: string;
};

type TabKey = string;

const POS_KEY = "mhp:chatbubble:pos";
const BUBBLE_SIZE = 56;
const PANEL_W = 380;
const PANEL_H = 520;
const GENERAL_TAB: TabKey = "general";

const BRAND_COLORS = [
  "#61BC47", "#FDB813", "#F58220", "#E03C31",
  "#963D97", "#2966C6", "#039CDE",
];

type Pos = { x: number; y: number };

function loadPos(): Pos {
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Pos;
      if (typeof p.x === "number" && typeof p.y === "number") return p;
    }
  } catch { /* ignore */ }
  return {
    x: Math.max(0, window.innerWidth - BUBBLE_SIZE - 24),
    y: Math.max(0, window.innerHeight - BUBBLE_SIZE - 24),
  };
}

function savePos(p: Pos): void {
  try { localStorage.setItem(POS_KEY, JSON.stringify(p)); } catch { /* quota */ }
}

function clampPos(p: Pos): Pos {
  const maxX = Math.max(0, window.innerWidth - BUBBLE_SIZE);
  const maxY = Math.max(0, window.innerHeight - BUBBLE_SIZE);
  return {
    x: Math.min(Math.max(0, p.x), maxX),
    y: Math.min(Math.max(0, p.y), maxY),
  };
}

function BrandMark({ size = 28 }: { size?: number }) {
  const padY = size * 0.16;
  const padX = size * 0.10;
  const usable = size - 2 * padY;
  const bar = usable / 10.6;
  const gap = bar * 0.6;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}
         aria-label="MyHackingPal" className="shrink-0 rounded-sm">
      <rect width={size} height={size} fill="black" />
      {BRAND_COLORS.map((c, i) => (
        <rect key={c} x={padX} y={padY + i * (bar + gap)}
              width={size - 2 * padX} height={bar} fill={c} />
      ))}
    </svg>
  );
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
      <code key={key++} className="bg-bg-base px-1 py-0.5 rounded text-amber text-[11px]">
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
          <pre key={i} className="my-1.5 p-2 rounded bg-bg-base border border-divider overflow-x-auto text-[11px] text-phos">
            {b.body}
          </pre>
        ) : (
          <div key={i} className="whitespace-pre-wrap text-[12px] leading-relaxed">
            {renderInline(b.body)}
          </div>
        ),
      )}
    </>
  );
}

function labelFor(navId: string): string {
  const map: Record<string, string> = {
    home: "Home", targets: "Targets", tools: "Tools",
    evidence: "Evidence", reports: "Reports", assistant: "AI Assistant",
    playbooks: "Playbooks", labs: "Labs", selfassess: "Self-Assess",
    dashboard: "Dashboard", engagements: "Engagements", findings: "Findings",
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
        let evt: { type?: string; text?: string; detail?: string };
        try {
          evt = JSON.parse(dataLine.slice(5).trim());
        } catch { continue; }
        if (evt.type === "text_delta" && typeof evt.text === "string") cb.onText(evt.text);
        else if (evt.type === "thinking_delta" && typeof evt.text === "string") cb.onThinking(evt.text);
        else if (evt.type === "error") cb.onError(evt.detail ?? "stream error");
      }
    }
  } catch (e) {
    if (!signal.aborted) cb.onError(e instanceof Error ? e.message : String(e));
  } finally {
    cb.onDone();
  }
}

export default function ChatBubble({ activePage }: { activePage: string }): JSX.Element {
  const [pos, setPos] = useState<Pos>(() => loadPos());
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  // Per-tab message history is in-memory only — closing/reopening the bubble
  // preserves it, but a full page reload clears it (panel chat is ephemeral).
  const [tabMessages, setTabMessages] = useState<Record<TabKey, ChatMessage[]>>({});
  const [activeTab, setActiveTab] = useState<TabKey>(GENERAL_TAB);
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [chatConfig, setChatConfig] = useState<ChatConfig | null>(null);

  const activeEid = useActiveEngagementId();
  const dragStartRef = useRef<{ mx: number; my: number; ox: number; oy: number } | null>(null);
  const movedRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchChatConfig().then(setChatConfig).catch(() => setChatConfig(null));
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!open) return;
    listEngagements()
      .then((rows) => {
        if (cancelled) return;
        setEngagements(rows.filter((e) => e.status === "active"));
      })
      .catch(() => { /* ignore */ });
    return () => { cancelled = true; };
  }, [open]);

  // When the user picks an engagement in the rest of the app, jump to its tab.
  useEffect(() => {
    if (activeEid) setActiveTab(activeEid);
    else setActiveTab(GENERAL_TAB);
  }, [activeEid]);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [tabMessages, activeTab, open]);

  useEffect(() => {
    const onResize = () => setPos((p) => clampPos(p));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (open) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragStartRef.current = { mx: e.clientX, my: e.clientY, ox: pos.x, oy: pos.y };
    movedRef.current = false;
    setDragging(true);
  }, [open, pos]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const s = dragStartRef.current;
    if (!s) return;
    const dx = e.clientX - s.mx;
    const dy = e.clientY - s.my;
    if (!movedRef.current && Math.hypot(dx, dy) > 4) movedRef.current = true;
    setPos(clampPos({ x: s.ox + dx, y: s.oy + dy }));
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    (e.target as Element).releasePointerCapture?.(e.pointerId);
    dragStartRef.current = null;
    setDragging(false);
    setPos((p) => { savePos(p); return p; });
    if (!movedRef.current) setOpen((o) => !o);
  }, []);

  const messages = tabMessages[activeTab] ?? [];

  function updateMessages(tab: TabKey, updater: (prev: ChatMessage[]) => ChatMessage[]) {
    setTabMessages((all) => ({ ...all, [tab]: updater(all[tab] ?? []) }));
  }

  const sendPrompt = useCallback((promptText: string) => {
    const text = promptText.trim();
    if (!text || sending) return;
    if (chatConfig && !chatConfig.usable) {
      updateMessages(activeTab, (prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: "",
          error: chatConfig.provider === "anthropic"
            ? "No Anthropic API key configured. Open the AI Assistant page → Settings to add one."
            : "Claude CLI not found and no API key set. Open the AI Assistant page → Settings.",
        },
      ]);
      return;
    }

    const tab = activeTab;
    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: "user", content: text };
    const asstMsg: ChatMessage = { id: crypto.randomUUID(), role: "assistant", content: "", streaming: true };
    const prior = tabMessages[tab] ?? [];
    const nextMsgs = [...prior, userMsg, asstMsg];
    updateMessages(tab, () => nextMsgs);
    setSending(true);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const pageLabel = labelFor(activePage);
    const sysContext = tab === GENERAL_TAB
      ? `User is currently viewing the ${pageLabel} page.`
      : `User is currently viewing the ${pageLabel} page (engagement context: ${tab}).`;

    const payload = {
      messages: [
        { role: "user" as const, content: `[context] ${sysContext}` },
        ...nextMsgs
          .filter((m) => !m.streaming)
          .map((m) => ({ role: m.role, content: m.content })),
      ],
      session_log: snapshot(),
      active_page: activePage,
    };

    streamChat(payload, ctrl.signal, {
      onText: (delta) => updateMessages(tab, (prev) =>
        prev.map((m) => m.id === asstMsg.id ? { ...m, content: m.content + delta } : m),
      ),
      onThinking: (delta) => updateMessages(tab, (prev) =>
        prev.map((m) => m.id === asstMsg.id ? { ...m, thinking: (m.thinking ?? "") + delta } : m),
      ),
      onError: (detail) => updateMessages(tab, (prev) =>
        prev.map((m) => m.id === asstMsg.id ? { ...m, streaming: false, error: detail } : m),
      ),
      onDone: () => updateMessages(tab, (prev) =>
        prev.map((m) => m.id === asstMsg.id ? { ...m, streaming: false } : m),
      ),
    }).finally(() => {
      setSending(false);
      abortRef.current = null;
    });
  }, [sending, chatConfig, activePage, activeTab, tabMessages]);

  function onSend() {
    const text = input.trim();
    if (!text) return;
    setInput("");
    sendPrompt(text);
  }

  function onStop() {
    abortRef.current?.abort();
  }

  function scanThisPage() {
    sendPrompt(`Look at the current ${labelFor(activePage)} state and suggest what to do next.`);
  }

  const tabs = useMemo<{ key: TabKey; label: string }[]>(() => {
    return [
      { key: GENERAL_TAB, label: "General" },
      ...engagements.map((e) => ({ key: e.id, label: e.name })),
    ];
  }, [engagements]);

  return (
    <>
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        style={{
          position: "fixed",
          left: pos.x,
          top: pos.y,
          width: BUBBLE_SIZE,
          height: BUBBLE_SIZE,
          zIndex: 9999,
          cursor: dragging ? "grabbing" : "grab",
          touchAction: "none",
        }}
        className={
          "rounded-full bg-bg-sidebar border border-divider shadow-lg " +
          "flex items-center justify-center hover:border-accent transition-colors " +
          (open ? "ring-2 ring-accent" : "")
        }
        title="MyHackingPal Assistant"
        aria-label="Open chat assistant"
      >
        <BrandMark size={32} />
      </div>

      {open && (
        <div
          style={{
            position: "fixed",
            left: clampPanelLeft(pos.x),
            top: clampPanelTop(pos.y),
            width: PANEL_W,
            height: PANEL_H,
            zIndex: 9998,
          }}
          className="rounded-md bg-bg-sidebar border border-divider shadow-2xl flex flex-col font-mono overflow-hidden"
        >
          <header className="flex items-center gap-2 px-3 py-2 border-b border-divider bg-bg-card">
            <BrandMark size={18} />
            <span className="text-accent text-[11px] font-bold tracking-widest">ASSISTANT</span>
            <span className="text-ink-dim text-[10px] truncate">
              {chatConfig?.model ?? "claude"}
            </span>
            <span className="flex-1" />
            <button
              onClick={scanThisPage}
              disabled={sending}
              className="text-[10px] px-2 py-0.5 rounded border border-divider text-ink-muted
                         hover:text-accent hover:border-accent transition-colors
                         disabled:opacity-40 disabled:cursor-not-allowed"
              title={`Ask about the ${labelFor(activePage)} page`}
            >
              Scan this page
            </button>
            <button
              onClick={() => setOpen(false)}
              className="text-ink-muted hover:text-ink-primary text-sm leading-none px-1"
              title="Close"
              aria-label="Close chat"
            >
              ×
            </button>
          </header>

          {tabs.length > 1 && (
            <div className="flex items-center gap-1 px-2 py-1.5 border-b border-divider bg-bg-base overflow-x-auto">
              {tabs.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setActiveTab(t.key)}
                  className={
                    "text-[10px] px-2 py-1 rounded whitespace-nowrap transition-colors " +
                    (t.key === activeTab
                      ? "bg-accentDim/40 text-accent border border-accentDim"
                      : "text-ink-muted hover:text-ink-primary border border-transparent")
                  }
                  title={t.label}
                >
                  {t.label.length > 22 ? t.label.slice(0, 22) + "…" : t.label}
                </button>
              ))}
            </div>
          )}

          <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2 text-ink-primary">
            {messages.length === 0 && (
              <div className="text-ink-dim text-[11px] leading-relaxed">
                <p>
                  On the <span className="text-accent">{labelFor(activePage)}</span> page.
                  Ask anything, or hit <span className="text-accent">Scan this page</span> for ideas.
                </p>
                {activeTab !== GENERAL_TAB && (
                  <p className="mt-1 text-ink-dim">
                    This tab is scoped to the active engagement.
                  </p>
                )}
              </div>
            )}

            {messages.map((m) => (
              <div key={m.id} className={m.role === "user" ? "flex justify-end" : ""}>
                <div
                  className={
                    m.role === "user"
                      ? "max-w-[85%] bg-accentDim/40 border border-accentDim rounded-md px-2.5 py-1.5 text-[12px]"
                      : "max-w-full w-full"
                  }
                >
                  {m.role === "assistant" && m.thinking && m.streaming && !m.content && (
                    <div className="text-ink-dim text-[10px] italic mb-1">thinking…</div>
                  )}
                  <MessageBody msg={m} />
                  {m.role === "assistant" && m.streaming && m.content && (
                    <span className="inline-block w-1.5 h-2.5 bg-accent align-text-bottom animate-pulse ml-0.5" />
                  )}
                  {m.error && (
                    <div className="text-danger text-[10px] mt-1">{m.error}</div>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="border-t border-divider p-2 flex gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  onSend();
                }
              }}
              placeholder="Ask the assistant…"
              rows={2}
              className="flex-1 resize-none bg-bg-base border border-divider rounded px-2 py-1.5
                         text-[12px] text-ink-primary focus:outline-none focus:border-accent
                         max-h-32"
            />
            {sending ? (
              <button
                onClick={onStop}
                className="px-2.5 py-1 rounded bg-bg-base border border-danger text-danger text-[11px]"
              >
                Stop
              </button>
            ) : (
              <button
                onClick={onSend}
                disabled={!input.trim()}
                className="px-3 py-1 rounded bg-accent text-white text-[11px] font-bold
                           disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Send
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function clampPanelLeft(bubbleX: number): number {
  // Prefer anchoring to the bubble's left edge but flip into view when the
  // bubble is too close to the right edge of the window.
  const maxLeft = Math.max(8, window.innerWidth - PANEL_W - 8);
  const candidate = bubbleX + BUBBLE_SIZE - PANEL_W;
  if (candidate < 8) return Math.min(bubbleX, maxLeft);
  return Math.min(candidate, maxLeft);
}

function clampPanelTop(bubbleY: number): number {
  // Float above the bubble if there isn't room below.
  const wantBelow = bubbleY + BUBBLE_SIZE + 8;
  if (wantBelow + PANEL_H <= window.innerHeight - 8) return wantBelow;
  const wantAbove = bubbleY - PANEL_H - 8;
  if (wantAbove >= 8) return wantAbove;
  return Math.max(8, window.innerHeight - PANEL_H - 8);
}
