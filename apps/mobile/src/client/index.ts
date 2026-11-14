import type { App, InjectionKey } from "vue";
import { inject } from "vue";

import type { TeneoClient } from "../types/client";

export const TENEO_CLIENT_KEY: InjectionKey<TeneoClient> =
  Symbol("TeneoClient");

export function provideClient(app: App, client: TeneoClient): void {
  app.provide(TENEO_CLIENT_KEY, client);
}

export function useClient(): TeneoClient {
  const client = inject(TENEO_CLIENT_KEY);
  if (!client) {
    throw new Error("TeneoClient was not provided in the component tree");
  }
  return client;
}

export type { TeneoClient, PairResult } from "../types/client";
export type { MobileSettings } from "../types/settings";
export type { PairedDevice, SyncState, SyncStatus } from "../types/sync";
