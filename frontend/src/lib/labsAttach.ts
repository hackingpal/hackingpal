// Pure decision helpers behind the Labs page's "attach to engagement"
// one-click flow. Factored out of the `attachLab` handler in Labs.tsx so the
// consequential branches — which engagement gets used, what URL lands in
// scope, and what the confirmation says — are unit-testable without rendering
// the page or hitting the backend. Labs.tsx wires these to its component
// state, fetches, and the toast timer; everything decision-shaped lives here.

import type { Engagement } from "./engagement";

// The slice of a lab the attach flow actually reads.
export type AttachLab = {
  name: string;
  primary_url: string;
  port_map: Record<string, number>;
};

// Where the attach target engagement comes from. Preference order matches the
// operator's mental model: the pill they explicitly set wins, then their most
// recent engagement, then a freshly created one.
export type AttachChoice =
  | { action: "use-active"; engagementId: string }
  | { action: "use-first"; engagementId: string }
  | { action: "create" };

/**
 * Pick the engagement to attach a lab to, or decide to create one.
 *
 *   a) the active engagement from the top-bar pill (explicit operator intent)
 *   b) the first (most-recently-updated) engagement in the list
 *   c) create a fresh "Lab: <name>" engagement
 *
 * `activeId` is whatever `getActiveEngagementId()` returns; any truthy value is
 * honored as-is (the active engagement may be archived and thus absent from
 * `list`, which omits archived rows — we still want to attach to it). The
 * backend attach endpoint 404s on a genuinely-stale id, surfaced as an error
 * toast, so we don't second-guess it here.
 */
export function chooseAttachEngagement(
  activeId: string | null,
  list: Pick<Engagement, "id">[],
): AttachChoice {
  if (activeId) {
    return { action: "use-active", engagementId: activeId };
  }
  if (list.length > 0) {
    return { action: "use-first", engagementId: list[0].id };
  }
  return { action: "create" };
}

/**
 * The URL to seed a freshly-created engagement's scope with: the lab's
 * advertised primary URL, else a loopback URL on its first published port,
 * else "" when the lab publishes nothing (compose labs mid-spin-up).
 */
export function deriveLabUrl(lab: AttachLab): string {
  if (lab.primary_url) return lab.primary_url;
  const port = Object.values(lab.port_map)[0];
  return port ? `http://127.0.0.1:${port}` : "";
}

/**
 * The one-line confirmation shown in the page toast after a successful attach.
 * Three branches: we auto-created an engagement, we added the lab URL to an
 * existing scope, or the URL was already in scope (idempotent re-attach).
 */
export function attachConfirmation(opts: {
  created: boolean;
  addedToScope: boolean;
  engName: string;
  scopeEntry: string;
}): string {
  if (opts.created) {
    return `Created engagement "${opts.engName}" and attached this lab`;
  }
  if (opts.addedToScope) {
    return `Attached to ${opts.engName} — added ${opts.scopeEntry} to scope`;
  }
  return `Attached to ${opts.engName} — already in scope`;
}
