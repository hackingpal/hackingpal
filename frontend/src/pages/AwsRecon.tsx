import CloudReconView from "../components/CloudReconView";

const SETUP_HINT = `# Once, in your terminal:
aws configure                 # interactive (Access Key ID, Secret, region)
#   ── or ──
export AWS_PROFILE=my-profile
#   ── or ──
export AWS_ACCESS_KEY_ID=...
export AWS_SECRET_ACCESS_KEY=...
export AWS_DEFAULT_REGION=us-east-1

# Then click "refresh" above.`;

export default function AwsRecon() {
  return (
    <CloudReconView
      cloud="AWS"
      statusPath="/aws/status"
      reconPath="/aws/recon"
      services={[
        { id: "iam",    label: "IAM" },
        { id: "s3",     label: "S3" },
        { id: "ec2",    label: "EC2" },
        { id: "lambda", label: "Lambda" },
        { id: "rds",    label: "RDS" },
      ]}
      setupHint={SETUP_HINT}
      identityRender={(s: any) => (
        <>
          <div className="text-ink-primary">
            Account: <span className="font-mono text-accent">{s.account}</span>
          </div>
          <div className="text-ink-muted text-[11px] font-mono break-all">{s.user_arn}</div>
        </>
      )}
    />
  );
}
