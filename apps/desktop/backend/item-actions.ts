import {
  ClipboardItemAction,
  ClipboardItemActionsVersion,
  hasClipboardAction,
} from "@teneo/shared/types/clipboard";
import {
  findContact,
  formatJson,
  tidyText,
} from "@teneo/ui/utils/text-actions";

import { findErrorLine } from "../src/utils/error-line";

export { ClipboardItemAction, ClipboardItemActionsVersion, hasClipboardAction };

/** Maximum length for QR codes in TextPreview.vue. */
export const qrTextLimit = 500;

/** Upper bound on in-memory cached item action entries. */
export const maxActionCacheItems = 1024;

export interface CachedItemActions {
  actions: number;
  actionsVersion: number;
}

const actionCache = new Map<string, CachedItemActions>();

export function getCachedActions(id: string): CachedItemActions | undefined {
  const existing = actionCache.get(id);
  if (!existing) return undefined;
  actionCache.delete(id);
  actionCache.set(id, existing);
  return existing;
}

export function setCachedActions(id: string, entry: CachedItemActions): void {
  actionCache.delete(id);
  actionCache.set(id, {
    actions: entry.actions,
    actionsVersion: entry.actionsVersion,
  });
  if (actionCache.size > maxActionCacheItems) {
    const oldest = actionCache.keys().next().value;
    if (oldest !== undefined) actionCache.delete(oldest);
  }
}

export function deleteCachedActions(id: string): void {
  actionCache.delete(id);
}

export function clearCachedActions(): void {
  actionCache.clear();
}

export function cachedActionCount(): number {
  return actionCache.size;
}

/** Deterministic text preview actions (`Tidy`, `Format JSON`, `QR`, `Contact`).
 *  Items holding secrets offer no actions so they always copy verbatim. */
export function computeDeterministicActions(
  text: string | null,
  hasSecrets: boolean,
): number {
  if (!text || hasSecrets) return 0;
  let mask = 0;
  if (tidyText(text) !== text) {
    mask |= ClipboardItemAction.tidy;
  }
  const formatted = formatJson(text);
  if (formatted !== null && formatted !== text) {
    mask |= ClipboardItemAction.formatJson;
  }
  if (text.length > 0 && text.length <= qrTextLimit) {
    mask |= ClipboardItemAction.qr;
  }
  const contact = findContact(text);
  if (contact?.kind === "email") {
    mask |= ClipboardItemAction.contactEmail;
  } else if (contact?.kind === "phone") {
    mask |= ClipboardItemAction.contactPhone;
  }
  return mask;
}

/** Whether a non-secret, non-link text has a candidate stack-trace error line
 *  worth verifying with Local AI. */
export function needsErrorLineCheck(
  text: string | null,
  hasSecrets: boolean,
  hasLink: boolean,
): boolean {
  return Boolean(text && !hasSecrets && !hasLink && findErrorLine(text));
}
