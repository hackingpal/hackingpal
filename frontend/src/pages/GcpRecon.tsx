import CloudReconView from "../components/CloudReconView";

const SETUP_HINT = `# Once, in your terminal:
gcloud auth application-default login    # browser-based auth
gcloud config set project YOUR-PROJECT   # set the default project

#   ── or use a service-account JSON ──
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json

# Then click "refresh" above.`;

export default function GcpRecon() {
  return (
    <CloudReconView
      cloud="GCP"
      statusPath="/gcp/status"
      reconPath="/gcp/recon"
      services={[
        { id: "iam",     label: "IAM" },
        { id: "storage", label: "Cloud Storage" },
        { id: "compute", label: "Compute Engine" },
      ]}
      setupHint={SETUP_HINT}
      identityRender={(s: any) => (
        <>
          <div className="text-ink-primary">
            Default project: <span className="font-mono text-accent">{s.default_project ?? "(none)"}</span>
          </div>
          <div className="text-ink-muted text-[11px]">
            Principal: <span className="font-mono">{s.principal}</span>
          </div>
        </>
      )}
    />
  );
}
