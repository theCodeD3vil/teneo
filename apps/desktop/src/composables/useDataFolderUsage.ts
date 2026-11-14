import { useQuery, useQueryClient } from "@tanstack/vue-query";
import { onUnmounted } from "vue";

import { clipboardHistoryChangedEvent } from "../../shared/types/clipboard";
import type { DataFolderUsage } from "../../shared/types/storage";

const dataFolderUsageQueryKey = ["data-folder-usage"] as const;

export function useDataFolderUsage() {
  const queryClient = useQueryClient();
  const usageQuery = useQuery({
    queryKey: dataFolderUsageQueryKey,
    queryFn: (): Promise<DataFolderUsage> => tiny.api.call("dataFolderUsage"),
  });

  // Copies, trimming and clearing all change it; reload while it's on screen
  const unsubscribe = tiny.api.on(clipboardHistoryChangedEvent, () => {
    void queryClient.invalidateQueries({ queryKey: dataFolderUsageQueryKey });
  });
  onUnmounted(unsubscribe);

  return { usage: usageQuery.data, usageError: usageQuery.error };
}
