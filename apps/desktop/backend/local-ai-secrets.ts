import {
  possibleCredentialLabel,
  type SecretSpan,
} from "@teneo/shared/types/clipboard";

type Candidate = SecretSpan & { context?: string };
const scanLimit = 64 * 1024;
const explicit =
  /(?:^|[\s"'?&#,{])(?:[\w.-]*[_-])?(?:password|passwd|passphrase|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|client[_ -]?secret|secret[_ -]?key|auth[_ -]?token|credential|token)["']?[ \t]*[:=][ \t]*(?:"(?<double>(?:\\.|[^"\r\n])+)"|'(?<single>(?:\\.|[^'\r\n])+)'|(?<bare>[^"'\s,;&}]+))/dgim;
const bearer =
  /\bauthorization["']?[ \t]*[:=][ \t]*["']?(?:bearer|basic)[ \t]+(?<credential>[a-z\d+/_=.-]+)/dgi;
const cue =
  /(?:^|[^A-Za-z0-9])(?:authenticat\w*|authoriz\w*|bearer|credentials?|pass(?:word|phrase|wd)|token|api[ _-]?key|client[ _-]?secret|(?:access|secret)[ _-]?key|x-(?:access|auth|api)(?:-[\w-]+)?|login[ -]code)(?=$|[^A-Za-z0-9])/i;

function isPlaceholder(value: string): boolean {
  return (
    /^(?:<[^>]+>|\[[^\]]+\]|\$\{[^}]+\}|\$[\w]+|%[\w]+%|\*{3,}|x{4,})$/i.test(
      value,
    ) ||
    /^(?:null|undefined|none|false|true|password|secret|token|changeme|redacted|placeholder|example|dummy|your(?:[_ -].+)|(?:insert|replace)(?:[_ -].+))$/i.test(
      value,
    )
  );
}

/** Identify exact values first. Only ambiguous values go to the model, with
 * the value itself replaced. The reply cannot echo text or invent offsets. */
export function credentialCandidates(text: string): Candidate[] {
  const sample = text.slice(0, scanLimit);
  if (!cue.test(sample)) return [];
  const spans: Candidate[] = [];
  const add = (start: number, end: number, context?: string) => {
    const value = sample.slice(start, end);
    if (value.length < 3 || isPlaceholder(value)) return;
    if (spans.some((span) => span.start < end && start < span.end)) return;
    spans.push({ start, end, label: possibleCredentialLabel, context });
  };

  for (const match of sample.matchAll(bearer)) {
    const range = match.indices?.groups?.credential;
    if (range) add(...range);
  }
  for (const match of sample.matchAll(explicit)) {
    const groups = match.indices?.groups;
    const range = groups?.double ?? groups?.single ?? groups?.bare;
    if (range) {
      const value = sample.slice(...range);
      // An unquoted shell/env reference and an unquoted <placeholder with spaces>.
      if (groups?.bare && /^[<[$%]/.test(value)) continue;
      // Common expressions assign a variable or function call, not its value.
      if (groups?.bare && /^[A-Za-z_$][\w$.]*\([^)]*\)$/.test(value)) continue;
      add(...range);
    }
  }

  // In prose or an unfamiliar format a nearby credential cue isn't enough
  // to treat an identifier as a secret. Let the model look at the context.
  for (const match of sample.matchAll(/[A-Za-z0-9][A-Za-z0-9_+/=-]{11,}/g)) {
    const value = match[0];
    if (!/[a-z]/.test(value) || !/\d/.test(value) || !/[A-Z_+/=]/.test(value))
      continue;
    const start = match.index;
    const end = start + value.length;
    const begin = Math.max(
      sample.lastIndexOf("\n", start - 1) + 1,
      start - 160,
    );
    const newline = sample.indexOf("\n", end);
    const finish = Math.min(newline < 0 ? sample.length : newline, end + 120);
    const before = sample.slice(begin, start);
    const after = sample.slice(end, finish);
    if (cue.test(`${before} ${after}`)) {
      add(start, end, `${before}[VALUE]${after}`);
    }
  }
  return spans.sort((a, b) => a.start - b.start);
}

/** Preserve earlier protection when a copy is bumped, or rules are refreshed.
 * Keep spans sorted and disjoint for the preview masker. */
export function mergeCredentialSpans(
  current: SecretSpan[],
  retained: SecretSpan[],
): SecretSpan[] {
  const result: SecretSpan[] = [];
  for (const span of [...current, ...retained].sort(
    (a, b) => a.start - b.start || b.end - a.end,
  )) {
    const last = result.at(-1);
    if (last && span.start < last.end) {
      if (span.end > last.end) {
        last.end = span.end;
        if (span.label === possibleCredentialLabel) last.label = span.label;
      }
    } else {
      result.push({ ...span });
    }
  }
  return result;
}
