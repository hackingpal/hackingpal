import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Rotator, Sparkle, TokenStream } from "performative-ui";
import {
  authFetch,
  fetchChatConfig,
  formatDetail,
  suggestChecks,
  type ChatConfig,
  type SuggestedCheck,
} from "../api";
import {
  listEngagements,
  useActiveEngagementId,
  type Engagement,
} from "../lib/engagement";
import { snapshot } from "../lib/sessionLog";
import { chatBubbleIn, popIn } from "../lib/anim";
import { shouldAutoOpen } from "../lib/setupState";
import { approvePlan } from "../lib/suggestion";
import { writeLabIntent } from "../lib/labIntent";
import { setActiveTarget, getActiveTargetSnapshot } from "../lib/targets";
import AnthropicSetupWizard from "./AnthropicSetupWizard";
import SuggestionPanel from "./SuggestionPanel";

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

const BUBBLE_SIZE = 56;
const BUBBLE_MARGIN = 24;
const PANEL_W = 380;
const PANEL_H = 560;
const GENERAL_TAB: TabKey = "general";

// Sparkle from performative-ui — the mandatory ✦ glyph with a subtle
// twinkle. `solid` keeps it monochrome so it inherits currentColor and
// stays on-brand with the mono palette.
function SparkleIcon({ size = 22 }: { size?: number }) {
  return (
    <Sparkle
      solid
      style={{ fontSize: size, lineHeight: 1, display: "inline-flex" }}
    />
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
      <code
        key={key++}
        style={{
          fontFamily: "var(--font-mono)",
          background: "var(--bg-base)",
          color: "var(--medium)",
          padding: "1px 6px",
          borderRadius: 4,
          fontSize: 11,
        }}
      >
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
          <pre
            key={i}
            style={{
              margin: "6px 0",
              padding: 10,
              background: "var(--bg-base)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              overflowX: "auto",
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--success)",
            }}
          >
            {b.body}
          </pre>
        ) : (
          <div
            key={i}
            style={{
              whiteSpace: "pre-wrap",
              fontFamily: "var(--font-sans)",
              fontSize: 12.5,
              lineHeight: 1.55,
              color: "var(--text-primary)",
            }}
          >
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

export default function ChatBubble(
  { activePage, onNavigate }: { activePage: string; onNavigate?: (id: string) => void },
): JSX.Element {
  const [open, setOpen] = useState(false);
  const [tabMessages, setTabMessages] = useState<Record<TabKey, ChatMessage[]>>({});
  const [activeTab, setActiveTab] = useState<TabKey>(GENERAL_TAB);
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [chatConfig, setChatConfig] = useState<ChatConfig | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const autoOpenedSetupRef = useRef(false);

  const activeEid = useActiveEngagementId();
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bubbleRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchChatConfig().then(setChatConfig).catch(() => setChatConfig(null));
  }, []);

  // Auto-open the Anthropic setup wizard the first time the chat is opened
  // with an unusable Anthropic config and the user hasn't dismissed before.
  useEffect(() => {
    if (!open || !chatConfig || autoOpenedSetupRef.current) return;
    const needs = chatConfig.provider === "anthropic" && !chatConfig.usable;
    if (shouldAutoOpen("anthropic", needs)) {
      autoOpenedSetupRef.current = true;
      setSetupOpen(true);
    }
  }, [open, chatConfig]);

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

  useEffect(() => {
    if (activeEid) setActiveTab(activeEid);
    else setActiveTab(GENERAL_TAB);
  }, [activeEid]);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [tabMessages, activeTab, open]);

  // First-mount entrance for the bubble itself
  useEffect(() => {
    chatBubbleIn(bubbleRef.current);
  }, []);

  // Open-panel entrance
  useEffect(() => {
    if (open) popIn(panelRef.current);
  }, [open]);

  const toggleOpen = useCallback(() => setOpen((o) => !o), []);

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

  // ── "Suggest checks" → approval cards ─────────────────────────────────────
  const [suggestions, setSuggestions] = useState<SuggestedCheck[] | null>(null);
  const [suggestBusy, setSuggestBusy] = useState(false);
  const [suggestNote, setSuggestNote] = useState("");

  async function runSuggest() {
    if (suggestBusy) return;
    setSuggestBusy(true); setSuggestNote(""); setSuggestions(null);
    try {
      const history = (tabMessages[activeTab] ?? [])
        .filter((m) => !m.streaming && m.content.trim())
        .map((m) => ({ role: m.role, content: m.content }));
      const { checks } = await suggestChecks({
        messages: history,
        active_page: activePage,
        target: getActiveTargetSnapshot()?.address,
      });
      if (checks.length === 0) {
        setSuggestNote("No checks to propose yet — chat about a target first.");
      } else {
        setSuggestions(checks);
      }
    } catch (e) {
      setSuggestNote(e instanceof Error ? e.message : String(e));
    } finally {
      setSuggestBusy(false);
    }
  }

  // Approve → pre-fill the tool's active target + one-shot intent, then jump.
  function approveCheck(check: SuggestedCheck) {
    const plan = approvePlan(check);
    setActiveTarget(plan.target);
    writeLabIntent(plan.navId, plan.intent);
    onNavigate?.(plan.navId);
  }

  const tabs = useMemo<{ key: TabKey; label: string }[]>(() => {
    return [
      { key: GENERAL_TAB, label: "General" },
      ...engagements.map((e) => ({ key: e.id, label: e.name })),
    ];
  }, [engagements]);

  return (
    <>
      <button
        ref={bubbleRef}
        type="button"
        onClick={toggleOpen}
        style={{
          position: "fixed",
          right: BUBBLE_MARGIN,
          bottom: BUBBLE_MARGIN,
          width: BUBBLE_SIZE,
          height: BUBBLE_SIZE,
          zIndex: 9999,
          borderRadius: "50%",
          background: "var(--accent)",
          border: "1px solid var(--border-accent)",
          boxShadow: open
            ? "0 12px 32px -8px var(--accent-glow), 0 0 0 4px var(--accent-dim)"
            : "0 8px 24px -8px var(--accent-glow)",
          color: "white",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          transition: "transform 150ms ease, box-shadow 200ms ease, background 150ms ease",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "var(--accent-bright)";
          e.currentTarget.style.transform = "scale(1.06)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "var(--accent)";
          e.currentTarget.style.transform = "scale(1)";
        }}
        title="HackingPal Assistant"
        aria-label="Open chat assistant"
      >
        <SparkleIcon size={22} />
      </button>

      {open && (
        <div
          ref={panelRef}
          style={{
            position: "fixed",
            right: BUBBLE_MARGIN,
            bottom: BUBBLE_MARGIN + BUBBLE_SIZE + 12,
            width: PANEL_W,
            height: `min(${PANEL_H}px, calc(100vh - ${BUBBLE_MARGIN * 2 + BUBBLE_SIZE + 24}px))`,
            maxHeight: `calc(100vh - ${BUBBLE_MARGIN * 2 + BUBBLE_SIZE + 24}px)`,
            zIndex: 9998,
            background: "var(--bg-elevated)",
            border: "1px solid var(--border-bright)",
            borderRadius: 16,
            boxShadow: "0 32px 64px -16px rgba(0,0,0,0.55), 0 0 0 1px var(--border-accent)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            opacity: 0, // GSAP fades in
          }}
        >
          <header
            className="flex items-center gap-2 px-3"
            style={{
              height: 44,
              borderBottom: "1px solid var(--border)",
              background: "var(--bg-surface)",
            }}
          >
            <span
              style={{
                color: "var(--accent-bright)",
                display: "inline-flex",
                alignItems: "center",
              }}
            >
              <SparkleIcon size={16} />
            </span>
            <span
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: 13,
                fontWeight: 600,
                color: "var(--text-primary)",
                letterSpacing: "-0.01em",
              }}
            >
              AI Assistant
            </span>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                color: "var(--text-muted)",
                letterSpacing: "0.06em",
              }}
              className="truncate"
            >
              {chatConfig?.model ?? "claude"}
            </span>
            <span className="flex-1" />
            {chatConfig && !chatConfig.usable && chatConfig.provider === "anthropic" && (
              <button
                onClick={() => setSetupOpen(true)}
                title="Set up Claude API key"
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 10,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  padding: "4px 8px",
                  borderRadius: 6,
                  border: "1px solid var(--accent)",
                  background: "transparent",
                  color: "var(--accent-bright)",
                  cursor: "pointer",
                  transition: "background 150ms ease",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "rgb(124 58 237 / 0.1)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              >
                Set up Claude
              </button>
            )}
            <button
              onClick={scanThisPage}
              disabled={sending}
              title={`Ask about the ${labelFor(activePage)} page`}
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                padding: "4px 8px",
                borderRadius: 6,
                border: "1px solid var(--border)",
                background: "transparent",
                color: "var(--text-secondary)",
                cursor: sending ? "not-allowed" : "pointer",
                opacity: sending ? 0.45 : 1,
                transition: "color 150ms ease, border-color 150ms ease",
              }}
              onMouseEnter={(e) => {
                if (sending) return;
                e.currentTarget.style.color = "var(--accent-bright)";
                e.currentTarget.style.borderColor = "var(--border-accent)";
              }}
              onMouseLeave={(e) => {
                if (sending) return;
                e.currentTarget.style.color = "var(--text-secondary)";
                e.currentTarget.style.borderColor = "var(--border)";
              }}
            >
              Scan page
            </button>
            <button
              onClick={runSuggest}
              disabled={suggestBusy}
              title="Propose concrete next checks as approval cards"
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                padding: "4px 8px",
                borderRadius: 6,
                border: "1px solid var(--border)",
                background: "transparent",
                color: "var(--text-secondary)",
                cursor: suggestBusy ? "wait" : "pointer",
                opacity: suggestBusy ? 0.45 : 1,
                transition: "color 150ms ease, border-color 150ms ease",
              }}
              onMouseEnter={(e) => {
                if (suggestBusy) return;
                e.currentTarget.style.color = "var(--accent-bright)";
                e.currentTarget.style.borderColor = "var(--border-accent)";
              }}
              onMouseLeave={(e) => {
                if (suggestBusy) return;
                e.currentTarget.style.color = "var(--text-secondary)";
                e.currentTarget.style.borderColor = "var(--border)";
              }}
            >
              {suggestBusy ? "Thinking…" : "Suggest checks"}
            </button>
            <button
              onClick={() => setOpen(false)}
              style={{
                color: "var(--text-muted)",
                background: "transparent",
                border: "none",
                fontSize: 18,
                lineHeight: 1,
                cursor: "pointer",
                padding: 2,
              }}
              title="Close"
              aria-label="Close chat"
            >
              ×
            </button>
          </header>

          {tabs.length > 1 && (
            <div
              className="flex items-center gap-1 px-2 py-2 overflow-x-auto"
              style={{
                borderBottom: "1px solid var(--border)",
                background: "var(--bg-base)",
              }}
            >
              {tabs.map((t) => {
                const isActive = t.key === activeTab;
                return (
                  <button
                    key={t.key}
                    onClick={() => setActiveTab(t.key)}
                    title={t.label}
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 10,
                      letterSpacing: "0.06em",
                      padding: "4px 10px",
                      borderRadius: 6,
                      whiteSpace: "nowrap",
                      background: isActive ? "var(--accent-dim)" : "transparent",
                      color: isActive ? "var(--text-accent)" : "var(--text-secondary)",
                      border: `1px solid ${isActive ? "var(--border-accent)" : "transparent"}`,
                      cursor: "pointer",
                    }}
                  >
                    {t.label.length > 22 ? t.label.slice(0, 22) + "…" : t.label}
                  </button>
                );
              })}
            </div>
          )}

          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto"
            style={{
              padding: 12,
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            {messages.length === 0 && (
              <div
                style={{
                  fontFamily: "var(--font-sans)",
                  fontSize: 12,
                  color: "var(--text-secondary)",
                  lineHeight: 1.55,
                }}
              >
                <TokenStream
                  text="Reading your session log…"
                  speedMs={[30, 70]}
                  hideCaret
                  style={{
                    display: "block",
                    marginBottom: 6,
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    color: "var(--text-muted)",
                    letterSpacing: "0.02em",
                  }}
                />
                <p style={{ margin: 0 }}>
                  On the{" "}
                  <span style={{ color: "var(--accent-bright)", fontWeight: 600 }}>
                    {labelFor(activePage)}
                  </span>{" "}
                  page. Ask anything, or hit{" "}
                  <span style={{ color: "var(--accent-bright)", fontWeight: 600 }}>
                    Scan page
                  </span>{" "}
                  for ideas.
                </p>
                {activeTab !== GENERAL_TAB && (
                  <p style={{ margin: "8px 0 0", color: "var(--text-muted)", fontSize: 11 }}>
                    This tab is scoped to the active engagement.
                  </p>
                )}
                <div
                  style={{
                    marginTop: 10,
                    paddingTop: 8,
                    borderTop: "1px solid var(--border)",
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    color: "var(--text-muted)",
                    letterSpacing: "0.02em",
                  }}
                >
                  Try:{" "}
                  <Rotator
                    words={[
                      "Audit TLS on this host",
                      "Hunt subdomains for the target",
                      "Check scope coverage",
                      "Summarize today's findings",
                      "Suggest the next recon step",
                    ]}
                    typeMs={48}
                    deleteMs={28}
                    holdMs={1600}
                    style={{ color: "var(--accent-bright)" }}
                  />
                </div>
              </div>
            )}

            {messages.map((m) => (
              <div
                key={m.id}
                className="animate-in"
                style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}
              >
                <div
                  style={{
                    maxWidth: m.role === "user" ? "85%" : "100%",
                    width: m.role === "user" ? "auto" : "100%",
                    background: m.role === "user" ? "var(--accent)" : "var(--bg-hover)",
                    color: m.role === "user" ? "white" : "var(--text-primary)",
                    borderRadius: 10,
                    padding: "8px 12px",
                    border: m.role === "user"
                      ? "1px solid var(--accent-bright)"
                      : "1px solid var(--border)",
                  }}
                >
                  {m.role === "assistant" && m.thinking && m.streaming && !m.content && (
                    <div
                      style={{
                        color: "var(--text-muted)",
                        fontSize: 10,
                        fontStyle: "italic",
                        marginBottom: 4,
                      }}
                    >
                      thinking…
                    </div>
                  )}
                  {m.role === "user" ? (
                    <div
                      style={{
                        fontFamily: "var(--font-sans)",
                        fontSize: 12.5,
                        lineHeight: 1.55,
                        whiteSpace: "pre-wrap",
                      }}
                    >
                      {m.content}
                    </div>
                  ) : (
                    <MessageBody msg={m} />
                  )}
                  {m.role === "assistant" && m.streaming && m.content && (
                    <span
                      className="caret-blink"
                      style={{
                        display: "inline-block",
                        marginLeft: 2,
                        height: 12,
                        verticalAlign: "text-bottom",
                      }}
                    />
                  )}
                  {m.error && (
                    <div
                      style={{
                        color: "var(--critical)",
                        fontSize: 10.5,
                        marginTop: 4,
                      }}
                    >
                      {m.error}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {(suggestions || suggestNote) && (
            <div style={{ padding: "0 10px", background: "var(--bg-surface)" }}>
              {suggestNote && (
                <div style={{ fontSize: 10.5, color: "var(--text-muted)", padding: "4px 0" }}>
                  {suggestNote}
                </div>
              )}
              {suggestions && (
                <SuggestionPanel
                  checks={suggestions}
                  onApprove={approveCheck}
                  onClose={() => setSuggestions(null)}
                />
              )}
            </div>
          )}

          <div
            style={{
              borderTop: "1px solid var(--border)",
              padding: 10,
              display: "flex",
              gap: 8,
              background: "var(--bg-surface)",
            }}
          >
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
              style={{
                flex: 1,
                resize: "none",
                background: "var(--bg-base)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: "8px 10px",
                fontFamily: "var(--font-sans)",
                fontSize: 12.5,
                color: "var(--text-primary)",
                outline: "none",
                maxHeight: 128,
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = "var(--accent)";
                e.currentTarget.style.boxShadow = "0 0 0 3px var(--accent-dim)";
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = "var(--border)";
                e.currentTarget.style.boxShadow = "none";
              }}
            />
            {sending ? (
              <button
                onClick={onStop}
                style={{
                  padding: "0 12px",
                  borderRadius: 8,
                  background: "var(--critical-dim)",
                  color: "var(--critical)",
                  border: "1px solid var(--critical)",
                  fontFamily: "var(--font-sans)",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Stop
              </button>
            ) : (
              <button
                onClick={onSend}
                disabled={!input.trim()}
                style={{
                  padding: "0 14px",
                  borderRadius: 8,
                  background: input.trim() ? "var(--accent)" : "color-mix(in srgb, var(--accent) 30%, transparent)",
                  color: "white",
                  border: "1px solid var(--accent-bright)",
                  fontFamily: "var(--font-sans)",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: input.trim() ? "pointer" : "not-allowed",
                  opacity: input.trim() ? 1 : 0.55,
                }}
              >
                Send
              </button>
            )}
          </div>
        </div>
      )}
      <AnthropicSetupWizard
        open={setupOpen}
        onClose={() => setSetupOpen(false)}
        onCompleted={() => fetchChatConfig().then(setChatConfig).catch(() => {})}
      />
    </>
  );
}
