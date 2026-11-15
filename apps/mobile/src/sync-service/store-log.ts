import type { SyncStore } from "@teneo/sync";

/** For a debug build: says what the store is asked and what a transaction
 *  saved, so a person trying sync can see items arrive and where it picks up
 *  after a restart. Item text is shown, as in the Mac's peer tool. */
export function loggedStore(
  store: SyncStore,
  log: (line: string) => void,
): SyncStore {
  return {
    epoch: () => store.epoch(),
    changesAfter: (after, limit) => store.changesAfter(after, limit),
    latestStamp: () => store.latestStamp(),
    trimHistory: () => store.trimHistory(),
    getPeer: async (deviceId) => {
      const peer = await store.getPeer(deviceId);
      log(
        `device ${deviceId.slice(0, 8)}: ${
          peer
            ? `met before, read up to change ${peer.receivedSeq}`
            : "not met before"
        }`,
      );
      return peer;
    },
    transaction: async (work) => {
      let received = 0;
      let saved: string[] = [];
      let cursor: { device: string; seq: number } | null = null;
      const result = await store.transaction(async (tx) => {
        // a transaction that has to run again starts the counts again
        received = 0;
        saved = [];
        cursor = null;
        return work({
          // the engine reads each record it receives once
          get: (id) => {
            received += 1;
            return tx.get(id);
          },
          newestUnpinned: () => tx.newestUnpinned(),
          updatePeer: (deviceId, patch) => {
            if (patch.receivedSeq !== undefined) {
              cursor = { device: deviceId, seq: patch.receivedSeq };
            }
            return tx.updatePeer(deviceId, patch);
          },
          put: async (record) => {
            await tx.put(record);
            const pin = record.pinned?.at != null ? " pinned" : "";
            const gone = record.deletedAt !== null ? " deleted" : "";
            saved.push(
              `${record.id.slice(0, 8)} "${(record.text ?? "").slice(0, 40)}"${pin}${gone}`,
            );
          },
        });
      });
      // only what was saved in the end
      for (const line of saved) log(`saved ${line}`);
      const read = cursor as { device: string; seq: number } | null;
      if (read) {
        log(
          `batch from ${read.device.slice(0, 8)}: ${received} received, ${saved.length} saved, read up to change ${read.seq}`,
        );
      }
      return result;
    },
  };
}
