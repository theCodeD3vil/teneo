// One GET to an address Teneo has already checked. `fetch` would look the
// name up again, and a name can answer a public address the first time and
// 127.0.0.1 or a router the second (DNS rebinding). macOS's curl, told the
// address with --resolve, connects there and nowhere else, while TLS still
// checks the certificate against the site's own name.
const CURL = "/usr/bin/curl";

export interface PinnedResponse {
  status: number;
  /** by lower-case name; the last value of a repeated header */
  headers: Map<string, string>;
  body: Uint8Array;
  /** The body was longer than maxBytes, so only its start is here. */
  cut: boolean;
}

export interface PinnedGetOptions {
  accept: string;
  userAgent: string;
  maxBytes: number;
  timeoutMs: number;
}

/** The arguments for curl: no proxy (it would look the name up itself), no
 *  redirects (the caller checks each one), http and https only. */
export function curlArguments(
  url: URL,
  address: string,
  options: Pick<PinnedGetOptions, "accept" | "userAgent" | "timeoutMs">,
): string[] {
  const target = new URL(url.href);
  target.username = "";
  target.password = "";
  const host = target.hostname.replace(/^\[|\]$/g, "");
  const port = target.port || (target.protocol === "https:" ? "443" : "80");
  const isAddress = host.includes(":") || /^[\d.]+$/.test(host);
  const pinned = address.includes(":") ? `[${address}]` : address;
  const seconds = Math.max(1, Math.ceil(options.timeoutMs / 1000));
  return [
    CURL,
    "--silent",
    "--show-error",
    "--noproxy",
    "*",
    "--proto",
    "=http,https",
    "--max-redirs",
    "0",
    "--connect-timeout",
    String(Math.min(5, seconds)),
    "--max-time",
    String(seconds),
    "--compressed",
    ...(isAddress ? [] : ["--resolve", `${host}:${port}:${pinned}`]),
    "--header",
    `Accept: ${options.accept}`,
    "--user-agent",
    options.userAgent,
    // the response's headers, as they come and before the body
    "--dump-header",
    "/dev/stderr",
    "--output",
    "-",
    "--url",
    target.href,
  ];
}

/** The status and headers of the last response in curl's header dump. */
export function parseHeaders(dump: string): {
  status: number;
  headers: Map<string, string>;
} {
  let status = 0;
  let headers = new Map<string, string>();
  for (const line of dump.split(/\r?\n/)) {
    const statusLine = /^HTTP\/[\d.]+ (\d{3})/.exec(line);
    if (statusLine) {
      status = Number(statusLine[1]);
      headers = new Map();
      continue;
    }
    const field = /^([!#$%&'*+.^`|~\w-]+):\s*(.*)$/.exec(line);
    if (field && status) headers.set(field[1]!.toLowerCase(), field[2]!.trim());
  }
  return { status, headers };
}

async function readAll(
  stream: ReadableStream<Uint8Array> | null,
): Promise<string> {
  if (!stream) return "";
  const decoder = new TextDecoder();
  let text = "";
  const reader = stream.getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    // a server can send any amount of headers; the start says all we need
    if (text.length < 64 * 1024)
      text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

/** GET `url` from `address`. Rejects when the site can't be reached. */
export async function pinnedGet(
  url: URL,
  address: string,
  options: PinnedGetOptions,
): Promise<PinnedResponse> {
  const child = tjs.spawn(curlArguments(url, address, options), {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const errors = readAll(child.stderr);
  const chunks: Uint8Array[] = [];
  let length = 0;
  let cut = false;
  const reader = child.stdout!.getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    length += value.length;
    if (length > options.maxBytes) {
      cut = true;
      child.kill("SIGTERM");
      void reader.cancel().catch(() => {});
      break;
    }
  }
  const [dump, exit] = await Promise.all([errors, child.wait()]);
  const { status, headers } = parseHeaders(dump);
  if (!cut && (exit.exit_status !== 0 || status === 0)) {
    const reason = dump.split("\n").find((line) => line.startsWith("curl:"));
    throw new Error(reason ?? `curl stopped with ${exit.exit_status}`);
  }
  const body = new Uint8Array(Math.min(length, options.maxBytes));
  let offset = 0;
  for (const chunk of chunks) {
    if (offset >= body.length) break;
    body.set(chunk.subarray(0, body.length - offset), offset);
    offset += chunk.length;
  }
  return { status, headers, body, cut };
}
