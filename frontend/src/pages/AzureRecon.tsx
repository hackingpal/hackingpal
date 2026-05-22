import CloudReconView from "../components/CloudReconView";

const SETUP_HINT = `# Once, in your terminal:
az login                              # browser-based auth
#   ── or for a service principal ──
export AZURE_TENANT_ID=...
export AZURE_CLIENT_ID=...
export AZURE_CLIENT_SECRET=...

# Then click "refresh" above.`;

export default function AzureRecon() {
  return (
    <CloudReconView
      cloud="Azure"
      statusPath="/azure/status"
      reconPath="/azure/recon"
      services={[
        { id: "storage",  label: "Storage" },
        { id: "compute",  label: "Compute" },
        { id: "network",  label: "Network (NSGs)" },
        { id: "keyvault", label: "Key Vault" },
      ]}
      setupHint={SETUP_HINT}
      identityRender={(s: any) => (
        <>
          <div className="text-ink-primary">
            Subscriptions visible: <span className="text-accent">{s.subscriptions?.length ?? 0}</span>
          </div>
          {(s.subscriptions ?? []).slice(0, 3).map((sub: any) => (
            <div key={sub.id} className="text-ink-muted text-[11px] font-mono break-all">
              {sub.name} <span className="text-ink-dim">· {sub.id}</span>
            </div>
          ))}
        </>
      )}
    />
  );
}
