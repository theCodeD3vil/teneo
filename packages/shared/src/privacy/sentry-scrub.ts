// Keeps clipboard contents out of the error reports the desktop and mobile
// apps send to Sentry. Typed structurally so this package needs no Sentry SDK.
import { findSecrets } from "../detection/secrets";

const REDACTED = "[redacted]";

// quoted text and URLs are where copied content shows up in error messages
const QUOTED = /"[^"]*"|'[^']*'|`[^`]*`|“[^”]*”/g;
const URL_LIKE = /\b[a-z][a-z0-9+.-]*:\/\/\S+/gi;
// a copied file's path ("ENOENT: /Users/me/plans.pdf") or an address in a
// copied text, which no rule above finds without quotes
const PATH_LIKE = /~?(?:\/[^\s/'"`<>()[\]{},;]+){2,}\/?/g;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
// the user's name in a home folder, as in a desktop page's file:// address
const HOME = /\/(Users|home)\/[^/\s]+/g;

function redactSecrets(text: string): string {
  let redacted = "";
  let at = 0;
  for (const { start, end } of findSecrets(text)) {
    redacted += text.slice(at, start) + REDACTED;
    at = end;
  }
  return redacted + text.slice(at);
}

export function redactText(text: string): string {
  return redactSecrets(text)
    .replace(URL_LIKE, REDACTED)
    .replace(QUOTED, REDACTED)
    .replace(PATH_LIKE, REDACTED)
    .replace(EMAIL, REDACTED);
}

/** A path or address with the home folder's owner taken out */
export function redactHome(text: string): string {
  return text.replace(HOME, "/$1/~");
}

/** A page's address without its query, fragment, or the user's name */
function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return redactHome(
      parsed.protocol === "file:"
        ? `file://${parsed.pathname}`
        : `${parsed.protocol}//${parsed.host}${parsed.pathname}`,
    );
  } catch {
    return REDACTED;
  }
}

/** Every string in a value redacted, objects and arrays walked */
function redactValues(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return redactText(value);
  if (depth > 6 || typeof value !== "object" || value === null) return value;
  if (Array.isArray(value))
    return value.map((item) => redactValues(item, depth + 1));
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      redactValues(item, depth + 1),
    ]),
  );
}

interface ScrubbableFrame {
  vars?: unknown;
  abs_path?: string;
  filename?: string;
}

interface ScrubbableSpan {
  description?: string;
  data?: unknown;
}

interface ScrubbableEvent {
  message?: string;
  transaction?: string;
  exception?: {
    values?: {
      value?: string;
      stacktrace?: { frames?: ScrubbableFrame[] };
    }[];
  };
  extra?: unknown;
  contexts?: Record<string, unknown>;
  request?: {
    url?: string;
    query_string?: unknown;
    data?: unknown;
    cookies?: unknown;
    headers?: Record<string, string>;
  };
  breadcrumbs?: ScrubbableBreadcrumb[];
  spans?: ScrubbableSpan[];
}

interface ScrubbableBreadcrumb {
  category?: string;
  message?: string;
  data?: unknown;
}

// What a context may say: the device, the app and the trace. Anything else,
// such as the props @sentry/vue attaches as contexts.vue, is dropped.
const KEPT_CONTEXTS = new Set([
  "app",
  "browser",
  "culture",
  "device",
  "gpu",
  "os",
  "runtime",
  "trace",
]);

// console output and network requests can carry copied text or links
const DROPPED_BREADCRUMBS = new Set(["console", "fetch", "xhr"]);

export function scrubBreadcrumb<B extends ScrubbableBreadcrumb>(
  breadcrumb: B,
): B | null {
  if (DROPPED_BREADCRUMBS.has(breadcrumb.category ?? "")) return null;
  if (breadcrumb.message) breadcrumb.message = redactText(breadcrumb.message);
  delete breadcrumb.data;
  return breadcrumb;
}

function scrubFrame(frame: ScrubbableFrame): void {
  // the values of a frame's local variables: the copied text itself
  delete frame.vars;
  if (frame.abs_path) frame.abs_path = redactHome(frame.abs_path);
  if (frame.filename) frame.filename = redactHome(frame.filename);
}

export function scrubEvent<E extends ScrubbableEvent>(event: E): E {
  if (event.message) event.message = redactText(event.message);
  if (event.transaction) event.transaction = redactHome(event.transaction);
  for (const exception of event.exception?.values ?? []) {
    if (exception.value) exception.value = redactText(exception.value);
    for (const frame of exception.stacktrace?.frames ?? []) scrubFrame(frame);
  }
  delete event.extra;
  if (event.contexts) {
    for (const name of Object.keys(event.contexts)) {
      if (!KEPT_CONTEXTS.has(name)) delete event.contexts[name];
    }
  }
  if (event.request) {
    delete event.request.query_string;
    delete event.request.data;
    delete event.request.cookies;
    if (event.request.url) event.request.url = redactUrl(event.request.url);
    const agent = event.request.headers?.["User-Agent"];
    event.request.headers = agent ? { "User-Agent": agent } : {};
  }
  for (const span of event.spans ?? []) {
    if (span.description) span.description = redactText(span.description);
    if (span.data) span.data = redactValues(span.data);
  }
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.flatMap((b) => {
      const kept = scrubBreadcrumb(b);
      return kept ? [kept] : [];
    });
  }
  return event;
}
