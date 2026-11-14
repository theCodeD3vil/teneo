import { useQuery, useQueryClient } from "@tanstack/vue-query";
import { clipboardHistoryChangedEvent } from "@teneo/shared/types/clipboard";
import type { DataFolderUsage } from "@teneo/shared/types/storage";
import { onUnmounted } from "vue";

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
