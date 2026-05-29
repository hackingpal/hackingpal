// Shared authorization gate for active-attack tools.
//
// Drop this above the Start button on any page that fires actions against
// a target the user might not own (AD spray, S3 enum, subdomain enum,
// kerberoasting, BloodHound collection, WPA capture, etc.). Pages must
// ALSO send `confirm_auth: true` in the WS init / POST body — every
// matching backend handler asserts it as a defence-in-depth check.
//
// The web-exploit pages (XSS / SQLi / Cmdi / LFI / SSRF / IDOR / IMDS)
// already have the same checkbox baked into <RequestForm>; this is for
// the rest of the attack family that doesn't use RequestForm.

type Props = {
  authorized: boolean;
  setAuthorized: (b: boolean) => void;
  /** Short name of the tool — e.g. "AD password spray". Used in the label. */
  toolName: string;
  /** Disable the input while the scan is in flight. */
  disabled?: boolean;
};

export default function AuthorizationGate({
  authorized, setAuthorized, toolName, disabled,
}: Props) {
  return (
    <label className="flex items-start gap-2 text-[12px] cursor-pointer select-none">
      <input
        type="checkbox"
        checked={authorized}
        onChange={(e) => setAuthorized(e.target.checked)}
        disabled={disabled}
        className="mt-0.5"
      />
      <span className={authorized ? "text-ink-primary" : "text-amber"}>
        I have authorization to run <strong>{toolName}</strong> against the
        target(s) above.
      </span>
    </label>
  );
}
