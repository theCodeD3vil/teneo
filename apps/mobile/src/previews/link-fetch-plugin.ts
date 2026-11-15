import { registerPlugin } from "@capacitor/core";

import type { FetchedPage, LinkFetcher } from "./link-previews";

/** LinkFetchPlugin.java in the Android app */
export interface LinkFetchPlugin {
  get(options: {
    url: string;
    accept: string;
    maxBytes: number;
    allowCut: boolean;
  }): Promise<{
    blocked?: boolean;
    status?: number;
    location?: string | null;
    contentType?: string | null;
    /** base64; absent when the answer was too long or not a success */
    body?: string | null;
  }>;
}

export const LinkFetch = registerPlugin<LinkFetchPlugin>("LinkFetch");

/** A release build may not make plain http requests, and nearly every site
 *  that still takes them sends them on to https: ask there directly. */
export function secureUrl(url: string): string {
  return url.replace(/^http:/i, "https:");
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function nativeLinkFetcher(plugin: LinkFetchPlugin): LinkFetcher {
  return {
    async get(request): Promise<FetchedPage> {
      const answer = await plugin.get({
        ...request,
        url: secureUrl(request.url),
      });
      if (answer.blocked) return { blocked: true };
      return {
        status: answer.status ?? 0,
        location: answer.location ?? null,
        contentType: answer.contentType ?? null,
        body: typeof answer.body === "string" ? fromBase64(answer.body) : null,
      };
    },
  };
}
