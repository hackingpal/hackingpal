// SetupWizard variant for cloud-provider read-only audits (AWS / Azure / GCP).
// Unlike the Anthropic flow, credentials are configured via the provider's
// CLI — we can't shell out from the browser, so the wizard shows the exact
// command for the user to run in their terminal and re-probes the status
// endpoint when they come back.

import { useEffect, useMemo, useState } from "react";
import SetupWizard, { type SetupStep } from "./SetupWizard";
import { api } from "../api";
import CopyButton from "./CopyButton";

export type CloudKind = "aws" | "azure" | "gcp";

type CloudCopy = {
  label: string;
  blurb: string;
  command: string;
  followup: string;
};

const COPY: Record<CloudKind, CloudCopy> = {
  aws: {
    label: "AWS",
    blurb: "AWS recon uses the boto3 credential chain — env vars, " +
           "~/.aws/credentials, or EC2 IMDS, whichever fires first.",
    command: "aws configure",
    followup: "Enter an access key + secret with read-only permissions " +
              "(SecurityAudit + ViewOnlyAccess works well).",
  },
  azure: {
    label: "Azure",
    blurb: "Azure recon uses DefaultAzureCredential, which prefers the cached " +
           "login from the Azure CLI.",
    command: "az login",
    followup: "A browser tab opens for sign-in. Pick the subscription you " +
              "want to audit when prompted.",
  },
  gcp: {
    label: "GCP",
    blurb: "GCP recon uses Application Default Credentials — the same file " +
           "gcloud writes after an interactive login.",
    command: "gcloud auth application-default login",
    followup: "A browser tab opens for sign-in. The default project from " +
              "`gcloud config` becomes the audit target.",
  },
};

type Props = {
  cloud: CloudKind;
  open: boolean;
  onClose: () => void;
  /** Called when status flips to ok=true. Caller refetches its own state. */
  onCompleted?: () => void;
  /** Optional override; defaults to `/<cloud>/status`. */
  statusPath?: string;
};

export default function CloudSetupWizard({
  cloud, open, onClose, onCompleted, statusPath,
}: Props) {
  const copy = COPY[cloud];
  const path = statusPath ?? `/${cloud}/status`;
  const [introDone, setIntroDone] = useState(false);
  const [ok, setOk] = useState(false);
  const [checking, setChecking] = useState(false);
  const [identity, setIdentity] = useState<string | null>(null);

  async function check() {
    setChecking(true);
    try {
      const r = await api<{ ok?: boolean } & Record<string, unknown>>(path);
      setOk(!!r.ok);
      setIdentity(summarizeIdentity(cloud, r));
    } catch {
      setOk(false); setIdentity(null);
    } finally { setChecking(false); }
  }

  useEffect(() => { if (open) void check(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open, path]);

  const steps = useMemo<SetupStep[]>(() => [
    {
      id: "intro",
      title: `Why ${copy.label} needs a one-time sign-in`,
      description: <>{copy.blurb}</>,
      done: introDone || ok,
      cta: { label: "Got it", onRun: () => setIntroDone(true) },
    },
    {
      id: "command",
      title: "Run this in your terminal",
      description: (
        <div className="space-y-2">
          <div className="flex items-center gap-2 bg-bg-card border border-divider
                          rounded px-2.5 py-1.5 font-mono text-[12px] text-ink-primary">
            <span className="text-ink-dim">$</span>
            <span className="flex-1 truncate">{copy.command}</span>
            <CopyButton text={copy.command} alwaysVisible label="copy" />
          </div>
          <div>{copy.followup}</div>
          {identity && (
            <div className="text-[11px] text-phos font-mono">
              ✓ {identity}
            </div>
          )}
        </div>
      ),
      done: ok,
      cta: {
        label: "Check Again",
        busyLabel: "Checking",
        onRun: check,
      },
    },
  ], [copy, introDone, ok, identity, checking]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <SetupWizard
      open={open}
      toolKey={`cloud-${cloud}`}
      title={`Set Up ${copy.label} Recon`}
      steps={steps}
      onClose={onClose}
      onCompleted={onCompleted}
    />
  );
}

function summarizeIdentity(cloud: CloudKind, status: Record<string, unknown>): string | null {
  if (!status.ok) return null;
  if (cloud === "aws") {
    const arn = typeof status.user_arn === "string" ? status.user_arn : null;
    const acct = typeof status.account === "string" ? status.account : null;
    return arn ? `${arn}${acct ? ` · ${acct}` : ""}` : null;
  }
  if (cloud === "azure") {
    const subs = Array.isArray(status.subscriptions) ? status.subscriptions : [];
    const count = subs.length;
    return count ? `${count} subscription${count === 1 ? "" : "s"} reachable` : null;
  }
  if (cloud === "gcp") {
    const proj = typeof status.default_project === "string" ? status.default_project : null;
    const who = typeof status.principal === "string" ? status.principal : null;
    if (proj && who) return `${who} · project ${proj}`;
    return proj ?? who;
  }
  return null;
}
