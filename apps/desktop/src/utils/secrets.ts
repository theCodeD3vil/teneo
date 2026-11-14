import type { SecretSpan } from "@/types/clipboard";

export interface TextPart {
  text: string;
  /** set when this part is a masked secret, such as "GitHub token" */
  secretLabel?: string;
}

/** The text split around its secrets, each one replaced by asterisks. */
export function maskSecrets(text: string, secrets: SecretSpan[]): TextPart[] {
  const parts: TextPart[] = [];
  let position = 0;
  for (const { start, end, label } of secrets) {
    parts.push({ text: text.slice(position, start) });
    parts.push({
      text: maskSecret(text.slice(start, end)),
      secretLabel: label,
    });
    position = end;
  }
  parts.push({ text: text.slice(position) });
  return parts.filter((part) => part.text);
}

// A long secret keeps its last 4 characters to tell keys apart, as GitHub and
// Stripe show them; the asterisks never give away its length.
function maskSecret(secret: string): string {
  return `********${secret.length >= 20 ? secret.slice(-4) : ""}`;
}
