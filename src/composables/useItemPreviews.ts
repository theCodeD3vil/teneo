import { useQueries } from "@tanstack/vue-query";
import { computed, type MaybeRefOrGetter, toValue } from "vue";

import { useSettings } from "@/composables/useSettings";
import type { ClipboardHistoryItem, FilePreview } from "@/types/clipboard";

/** Images and files are previewed from disk: the saved image, or the first copied file. */
export function getPreviewPath(item: ClipboardHistoryItem): string | null {
  if (item.kind === "image") return item.image;
  if (item.kind === "files") return item.paths[0] ?? null;
  return null;
}

// Each result carries its own key (via select), so a lookup never depends on
// the results lining up with the keys while the list changes.
function toMap<T>(results: { data?: readonly [string, T] }[]): Map<string, T> {
  return new Map(results.flatMap(({ data }) => (data ? [data] : [])));
}

function unique(values: (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((value) => value != null))];
}

/**
 * The list asks for its cards' app icons, previews and link icons in one
 * place: a few queries per distinct app, file and link, not three per card.
 * Everything loads after the list shows and is cached, so a list seen before
 * shows it at once. A lookup is undefined until its query has loaded.
 */
export function useItemPreviews(
  items: MaybeRefOrGetter<ClipboardHistoryItem[]>,
) {
  const { settings } = useSettings();

  const bundleIds = computed(() =>
    unique(toValue(items).map((item) => item.sourceApp?.bundleId)),
  );
  const previewPaths = computed(() =>
    unique(toValue(items).map(getPreviewPath)),
  );
  const linkUrls = computed(() =>
    settings.value.showLinkPreviews
      ? unique(toValue(items).map((item) => item.link?.url))
      : [],
  );

  // data: URL of the app's icon, or null when the app can't be found
  const appIcons = useQueries({
    queries: computed(() =>
      bundleIds.value.map((bundleId) => ({
        queryKey: ["app-icon", bundleId],
        queryFn: (): Promise<string | null> =>
          tiny.api.call("appIcon", { bundleId }),
        select: (iconUrl: string | null) => [bundleId, iconUrl] as const,
        // an app's icon doesn't change while Teneo runs
        staleTime: Infinity,
        gcTime: Infinity,
      })),
    ),
    combine: toMap,
  });

  // data: URL of a thumbnail, or null when there's none; isMissing when the
  // file was moved or deleted since it was copied
  const filePreviews = useQueries({
    queries: computed(() =>
      previewPaths.value.map((path) => ({
        queryKey: ["file-preview", path],
        queryFn: (): Promise<FilePreview> =>
          tiny.api.call("filePreview", { path }),
        select: (preview: FilePreview) => [path, preview] as const,
        // the panel only hides, and a tab switch shows its cards again: either
        // would redo every preview
        refetchOnWindowFocus: false,
        refetchOnMount: false,
      })),
    ),
    combine: toMap,
  });

  // A link shows its site's icon, fetched by the backend from the site itself
  const linkIcons = useQueries({
    queries: computed(() =>
      linkUrls.value.map((url) => ({
        queryKey: ["link-preview", url],
        queryFn: (): Promise<string | null> =>
          tiny.api.call("linkPreview", { url }),
        select: (iconUrl: string | null) => [url, iconUrl] as const,
        // saved on disk by the backend; a site that couldn't be reached is asked
        // again when its card next shows, not retried in a loop
        staleTime: Infinity,
        refetchOnWindowFocus: false,
        retry: false,
      })),
    ),
    combine: toMap,
  });

  return {
    sourceAppIconUrl: (item: ClipboardHistoryItem) => {
      const bundleId = item.sourceApp?.bundleId;
      return bundleId ? appIcons.value.get(bundleId) : undefined;
    },
    filePreview: (item: ClipboardHistoryItem) => {
      const path = getPreviewPath(item);
      return path ? filePreviews.value.get(path) : undefined;
    },
    linkPreviewUrl: (item: ClipboardHistoryItem) => {
      const url = item.link?.url;
      return url ? linkIcons.value.get(url) : undefined;
    },
  };
}
