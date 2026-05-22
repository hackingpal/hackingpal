/**
 * Shared form scaffold for the WEB EXPLOIT pages.
 *
 * Renders: target URL (with FUZZ marker hint), method, body, headers, cookies,
 * authorization checkbox, allow-internal-IPs checkbox, rate slider.
 *
 * Parent component owns the state via a single `RequestState` value + setter,
 * plus its own tool-specific option controls rendered above the Start button.
 */
import { useState } from "react";

export type KV = { key: string; value: string };

export type RequestState = {
  url: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body: string;
  headers: KV[];
  cookies: KV[];
  allowPrivate: boolean;
  confirmAuth: boolean;
  ratePerSec: number;
};

export const initialRequestState: RequestState = {
  url: "",
  method: "GET",
  body: "",
  headers: [],
  cookies: [],
  allowPrivate: false,
  confirmAuth: false,
  ratePerSec: 8,
};

function kvToObject(kvs: KV[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const { key, value } of kvs) {
    if (key.trim()) out[key.trim()] = value;
  }
  return out;
}

export function requestToInit(s: RequestState): Record<string, unknown> {
  return {
    url: s.url,
    method: s.method,
    body: s.body,
    headers: kvToObject(s.headers),
    cookies: kvToObject(s.cookies),
    allow_private: s.allowPrivate,
    confirm_auth: s.confirmAuth,
    rate_per_sec: s.ratePerSec,
  };
}

type Props = {
  state: RequestState;
  setState: (s: RequestState) => void;
  running: boolean;
};

export default function RequestForm({ state, setState, running }: Props) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  const update = (patch: Partial<RequestState>) =>
    setState({ ...state, ...patch });

  function updateKV(field: "headers" | "cookies", index: number, patch: Partial<KV>) {
    const next = state[field].slice();
    next[index] = { ...next[index], ...patch };
    update({ [field]: next } as Partial<RequestState>);
  }

  function addKV(field: "headers" | "cookies") {
    update({ [field]: [...state[field], { key: "", value: "" }] } as Partial<RequestState>);
  }

  function removeKV(field: "headers" | "cookies", index: number) {
    update({ [field]: state[field].filter((_, i) => i !== index) } as Partial<RequestState>);
  }

  return (
    <div className="space-y-3">
      {/* Target URL */}
      <div>
        <label className="block text-[11px] text-ink-muted mb-1 tracking-wider">
          TARGET URL — use <code className="text-amber bg-bg-base px-1">FUZZ</code> as the payload marker
        </label>
        <div className="flex gap-2">
          <select
            value={state.method}
            onChange={(e) => update({ method: e.target.value as RequestState["method"] })}
            disabled={running}
            className="bg-bg-base border border-divider rounded px-2 py-1.5 text-[13px] text-ink-primary
                       focus:outline-none focus:border-accent disabled:opacity-50"
          >
            {["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <input
            value={state.url}
            onChange={(e) => update({ url: e.target.value })}
            disabled={running}
            placeholder="https://example.com/search?q=FUZZ"
            className="flex-1 bg-bg-base border border-divider rounded px-2 py-1.5 text-[13px] text-ink-primary
                       font-mono focus:outline-none focus:border-accent disabled:opacity-50"
          />
        </div>
      </div>

      {/* Body */}
      {(state.method !== "GET") && (
        <div>
          <label className="block text-[11px] text-ink-muted mb-1 tracking-wider">
            REQUEST BODY (FUZZ marker also works here)
          </label>
          <textarea
            value={state.body}
            onChange={(e) => update({ body: e.target.value })}
            disabled={running}
            rows={3}
            placeholder='{"q":"FUZZ"}'
            className="w-full bg-bg-base border border-divider rounded px-2 py-1.5 text-[12px] text-ink-primary
                       font-mono focus:outline-none focus:border-accent disabled:opacity-50"
          />
        </div>
      )}

      {/* Advanced toggle */}
      <button
        onClick={() => setShowAdvanced((v) => !v)}
        type="button"
        className="text-[11px] text-ink-muted hover:text-ink-primary tracking-wider"
      >
        {showAdvanced ? "▾" : "▸"} HEADERS · COOKIES · ({state.headers.length}h, {state.cookies.length}c)
      </button>

      {showAdvanced && (
        <div className="space-y-3 pl-3 border-l border-divider">
          {(["headers", "cookies"] as const).map((field) => (
            <div key={field}>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[11px] text-ink-muted tracking-wider uppercase">{field}</span>
                <button onClick={() => addKV(field)} disabled={running}
                        type="button"
                        className="text-[11px] text-accent hover:underline disabled:opacity-40">
                  + add
                </button>
              </div>
              {state[field].map((kv, i) => (
                <div key={i} className="flex gap-2 mb-1">
                  <input value={kv.key} onChange={(e) => updateKV(field, i, { key: e.target.value })}
                         disabled={running}
                         placeholder={field === "headers" ? "X-Header-Name" : "session_id"}
                         className="w-1/3 bg-bg-base border border-divider rounded px-2 py-1 text-[12px] font-mono
                                    focus:outline-none focus:border-accent disabled:opacity-50" />
                  <input value={kv.value} onChange={(e) => updateKV(field, i, { value: e.target.value })}
                         disabled={running}
                         placeholder="value (FUZZ ok)"
                         className="flex-1 bg-bg-base border border-divider rounded px-2 py-1 text-[12px] font-mono
                                    focus:outline-none focus:border-accent disabled:opacity-50" />
                  <button onClick={() => removeKV(field, i)} disabled={running}
                          type="button"
                          className="text-ink-muted hover:text-danger px-2 disabled:opacity-40">×</button>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Safety rails */}
      <div className="border-t border-divider pt-3 space-y-2">
        <label className="flex items-start gap-2 text-[12px] cursor-pointer">
          <input
            type="checkbox"
            checked={state.confirmAuth}
            onChange={(e) => update({ confirmAuth: e.target.checked })}
            disabled={running}
            className="mt-0.5"
          />
          <span className={state.confirmAuth ? "text-ink-primary" : "text-amber"}>
            I have authorization to test this target.
          </span>
        </label>
        <label className="flex items-start gap-2 text-[12px] cursor-pointer">
          <input
            type="checkbox"
            checked={state.allowPrivate}
            onChange={(e) => update({ allowPrivate: e.target.checked })}
            disabled={running}
            className="mt-0.5"
          />
          <span className="text-ink-muted">
            Allow internal targets (RFC1918, loopback, link-local). Off by default — protects you from accidentally fuzzing your own LAN.
          </span>
        </label>
        <div className="flex items-center gap-2 text-[12px]">
          <span className="text-ink-muted">Rate:</span>
          <input
            type="range" min={1} max={30} value={state.ratePerSec}
            onChange={(e) => update({ ratePerSec: parseInt(e.target.value) })}
            disabled={running}
            className="flex-1"
          />
          <span className="text-ink-primary tabular-nums w-10 text-right">{state.ratePerSec}/s</span>
        </div>
      </div>
    </div>
  );
}
