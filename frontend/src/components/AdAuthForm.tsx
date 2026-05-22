// Shared credentials form for every AD tool. Reads/writes a single CredsModel
// the parent component owns. Persists the non-secret fields to localStorage
// so the user doesn't have to retype dc_host / domain / username every time
// they switch between LDAP / SMB / Sprayer / etc.

import { useEffect, useState } from "react";

export type Creds = {
  dc_host: string;
  domain: string;
  username: string;
  password: string;
  nt_hash: string;
  bind: "simple" | "ntlm" | "anonymous";
  use_ssl: boolean;
  use_tls: boolean;
};

const STORAGE_KEY = "mhp:ad-creds-non-secret:v1";

function loadDefaults(): Creds {
  const base: Creds = {
    dc_host: "", domain: "", username: "", password: "", nt_hash: "",
    bind: "ntlm", use_ssl: false, use_tls: false,
  };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...base, ...parsed, password: "", nt_hash: "" };
    }
  } catch { /* ignore */ }
  return base;
}

export function useAdCreds(): [Creds, (c: Creds) => void] {
  const [creds, setCreds] = useState<Creds>(() => loadDefaults());
  useEffect(() => {
    const { password: _p, nt_hash: _n, ...persist } = creds;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(persist)); }
    catch { /* quota */ }
  }, [creds]);
  return [creds, setCreds];
}

type Props = {
  creds: Creds;
  setCreds: (c: Creds) => void;
  disabled?: boolean;
};

export default function AdAuthForm({ creds, setCreds, disabled }: Props) {
  const update = (patch: Partial<Creds>) => setCreds({ ...creds, ...patch });

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[11px] text-ink-muted tracking-wider mb-1">DC HOST / IP</label>
          <input value={creds.dc_host} onChange={(e) => update({ dc_host: e.target.value })}
                 disabled={disabled} placeholder="dc01.corp.local"
                 className="w-full bg-bg-base border border-divider rounded px-2 py-1.5
                            text-[12px] font-mono focus:outline-none focus:border-accent
                            disabled:opacity-50" />
        </div>
        <div>
          <label className="block text-[11px] text-ink-muted tracking-wider mb-1">DOMAIN</label>
          <input value={creds.domain} onChange={(e) => update({ domain: e.target.value })}
                 disabled={disabled} placeholder="corp.local"
                 className="w-full bg-bg-base border border-divider rounded px-2 py-1.5
                            text-[12px] font-mono focus:outline-none focus:border-accent
                            disabled:opacity-50" />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="block text-[11px] text-ink-muted tracking-wider mb-1">BIND</label>
          <select value={creds.bind} onChange={(e) => update({ bind: e.target.value as Creds["bind"] })}
                  disabled={disabled}
                  className="w-full bg-bg-base border border-divider rounded px-2 py-1.5
                             text-[12px] focus:outline-none focus:border-accent
                             disabled:opacity-50">
            <option value="ntlm">NTLM</option>
            <option value="simple">Simple (LDAP)</option>
            <option value="anonymous">Anonymous</option>
          </select>
        </div>
        <div>
          <label className="block text-[11px] text-ink-muted tracking-wider mb-1">USERNAME</label>
          <input value={creds.username} onChange={(e) => update({ username: e.target.value })}
                 disabled={disabled || creds.bind === "anonymous"}
                 placeholder="jdoe"
                 className="w-full bg-bg-base border border-divider rounded px-2 py-1.5
                            text-[12px] font-mono focus:outline-none focus:border-accent
                            disabled:opacity-50" />
        </div>
        <div>
          <label className="block text-[11px] text-ink-muted tracking-wider mb-1">PASSWORD</label>
          <input type="password"
                 value={creds.password} onChange={(e) => update({ password: e.target.value })}
                 disabled={disabled || creds.bind === "anonymous" || !!creds.nt_hash}
                 placeholder={creds.nt_hash ? "(using NT hash)" : ""}
                 className="w-full bg-bg-base border border-divider rounded px-2 py-1.5
                            text-[12px] font-mono focus:outline-none focus:border-accent
                            disabled:opacity-50" />
        </div>
      </div>

      <details className="text-[11px]">
        <summary className="cursor-pointer text-ink-muted hover:text-ink-primary">
          NT hash (pass-the-hash) · TLS / SSL options
        </summary>
        <div className="grid grid-cols-2 gap-3 mt-2">
          <div className="col-span-2">
            <label className="block text-[11px] text-ink-muted tracking-wider mb-1">
              NT HASH (32 hex)
            </label>
            <input value={creds.nt_hash}
                   onChange={(e) => update({ nt_hash: e.target.value.trim().toLowerCase() })}
                   disabled={disabled}
                   placeholder="aad3b435b51404eeaad3b435b51404ee"
                   className="w-full bg-bg-base border border-divider rounded px-2 py-1
                              text-[11px] font-mono focus:outline-none focus:border-accent
                              disabled:opacity-50" />
          </div>
          <label className="flex items-center gap-2 text-[12px] cursor-pointer">
            <input type="checkbox" checked={creds.use_ssl} disabled={disabled}
                   onChange={(e) => update({ use_ssl: e.target.checked })} />
            LDAPS (port 636)
          </label>
          <label className="flex items-center gap-2 text-[12px] cursor-pointer">
            <input type="checkbox" checked={creds.use_tls} disabled={disabled || creds.use_ssl}
                   onChange={(e) => update({ use_tls: e.target.checked })} />
            StartTLS
          </label>
        </div>
      </details>
    </div>
  );
}
