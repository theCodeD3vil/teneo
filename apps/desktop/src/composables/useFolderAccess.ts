import {
  type FolderAccess,
  type FolderAccessStatus,
  folderAccessChangedEvent,
} from "@teneo/shared/types/storage";
import { onMounted, onUnmounted, ref } from "vue";

export function useFolderAccess() {
  const status = ref<FolderAccessStatus>({});
  const loading = ref(true);
  const requesting = ref<FolderAccess["name"] | null>(null);
  const error = ref("");

  let unsubscribe: (() => void) | undefined;
  let receivedUpdate = false;
  onMounted(() => {
    unsubscribe = tiny.api.on(
      folderAccessChangedEvent,
      (value: FolderAccessStatus) => {
        receivedUpdate = true;
        status.value = value;
      },
    );
    void tiny.api
      .call("folderAccessStatus")
      .then((value: FolderAccessStatus) => {
        if (!receivedUpdate) status.value = value;
      })
      .catch(() => {
        if (!receivedUpdate)
          error.value = "Couldn't load folder preview settings.";
      })
      .finally(() => (loading.value = false));
  });
  onUnmounted(() => unsubscribe?.());

  async function setEnabled(
    name: FolderAccess["name"],
    enabled: boolean,
  ): Promise<void> {
    if (loading.value || requesting.value !== null) return;
    requesting.value = name;
    error.value = "";
    try {
      status.value = await tiny.api.call("setFolderPreviews", {
        name,
        enabled,
      });
    } catch {
      error.value = "Couldn't save the folder preview setting. Try again.";
    } finally {
      requesting.value = null;
    }
  }

  return { status, loading, requesting, error, setEnabled };
}
