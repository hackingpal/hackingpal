import { ReactNode } from "react";
import { safeHttpUrl } from "../lib/url";

type Props = {
  href: unknown;
  children: ReactNode;
  className?: string;
  title?: string;
  mailto?: boolean;
};

// Drop-in replacement for `<a href={apiData.url}>` that drops the href
// (and silently falls back to a plain <span>) when the URL is not
// http(s). Always opens in a new tab with noopener+noreferrer.
export function SafeAnchor({ href, children, className, title, mailto }: Props) {
  const safe = safeHttpUrl(href, { mailto });
  if (!safe) return <span className={className} title={title}>{children}</span>;
  return (
    <a
      href={safe}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      title={title}
    >
      {children}
    </a>
  );
}
