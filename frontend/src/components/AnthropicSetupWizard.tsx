// SetupWizard variant for the Anthropic API key. Lets the user paste their
// key directly inside the popup — we store it in the macOS Keychain via the
// same `/settings/api-key` endpoint the Settings page uses.

import { useEffect, useMemo, useState } from "react";
import SetupWizard, { type SetupStep } from "./SetupWizard";
import {
  fetchApiKeyStatus, fetchChatConfig, setApiKey,
  type ApiKeyStatus, type ChatConfig,
} from "../api";

type Props = {
  open: boolean;
  onClose: () => void;
  /** Called when the wizard finishes — caller usually refetches its own ChatConfig. */
  onCompleted?: () => void;
};

export default function AnthropicSetupWizard({ open, onClose, onCompleted }: Props) {
  const [keyStatus, setKeyStatus] = useState<ApiKeyStatus | null>(null);
  const [cfg, setCfg] = useState<ChatConfig | null>(null);
  const [introDone, setIntroDone] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  async function refresh() {
    try {
      const [k, c] = await Promise.all([fetchApiKeyStatus(), fetchChatConfig()]);
      setKeyStatus(k); setCfg(c);
    } catch { /* ignore — wizard tolerates partial state */ }
  }

  useEffect(() => { if (open) void refresh(); }, [open]);

  const present = !!keyStatus?.present;
  const usable = !!cfg?.usable;

  const steps = useMemo<SetupStep[]>(() => [
    {
      id: "intro",
      title: "Bring your own Claude key",
      description: (
        <>
          The in-app chat uses Anthropic&apos;s Claude API. Grab a key from{" "}
          <code className="text-ink-primary">console.anthropic.com</code>{" "}
          (any tier works) and we&apos;ll stash it in macOS Keychain — never
          on disk.
        </>
      ),
      done: introDone || present,
      cta: { label: "I have a key", onRun: () => setIntroDone(true) },
    },
    {
      id: "save",
      title: present ? `Key saved (…${keyStatus?.last4 ?? ""})` : "Paste & save",
      description: (
        <div className="space-y-2">
          <div>
            Your key stays on this Mac. Paste it below — we&apos;ll save it
            and verify the chat backend picks it up.
          </div>
          {!present && (
            <div className="flex gap-2">
              <input
                type="password"
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                placeholder="sk-ant-…"
                autoComplete="off"
                spellCheck={false}
                className="flex-1 bg-bg-card border border-divider rounded
                           px-2.5 py-1.5 text-xs font-mono text-ink-primary
                           placeholder:text-ink-dim focus:outline-none
                           focus:border-accent focus:ring-1 focus:ring-accent/30"
              />
              <button
                type="button"
                onClick={async () => {
                  if (!keyInput.trim() || saving) return;
                  setSaving(true); setSaveErr(null);
                  try {
                    await setApiKey(keyInput.trim());
                    setKeyInput("");
                    await refresh();
                  } catch (e) {
                    setSaveErr(e instanceof Error ? e.message : String(e));
                  } finally { setSaving(false); }
                }}
                disabled={saving || !keyInput.trim()}
                className="bg-accent hover:bg-accentDim text-white text-xs font-bold
                           tracking-wide px-3 rounded border border-accent/60
                           disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          )}
          {saveErr && (
            <div className="text-[11px] font-mono text-danger">{saveErr}</div>
          )}
        </div>
      ),
      done: present && usable,
    },
  ], [introDone, present, usable, keyStatus, keyInput, saving, saveErr]);

  return (
    <SetupWizard
      open={open}
      toolKey="anthropic"
      title="Set Up Claude"
      steps={steps}
      onClose={onClose}
      onCompleted={onCompleted}
    />
  );
}
