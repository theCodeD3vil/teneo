import { keepPreviousData, useMutation, useQuery } from "@tanstack/vue-query";
import { computed } from "vue";

import type { ExcludedApp } from "../../shared/types/settings";
import { useSettings } from "./useSettings";

// Installed apps rarely change, so a cached list is reused when the tab reopens
const excludedAppsCacheDuration = 5 * 60 * 1000;

export function useExcludedApps() {
  const { settings, updateSettings } = useSettings();

  const excludedAppsQuery = useQuery({
    // The user's apps are part of the key, so adding or removing one (from any
    // window) loads that list, and going back to an earlier list is instant
    queryKey: computed(() => [
      "excluded-apps",
      [...settings.value.excludedApps],
    ]),
    queryFn: ({ queryKey: [, addedBundleIds] }): Promise<ExcludedApp[]> =>
      tiny.api.call("excludedApps", { addedBundleIds }),
    staleTime: excludedAppsCacheDuration,
    // keep showing the current list while the changed one loads
    placeholderData: keepPreviousData,
  });

  // The backend saves the picked app to settings; the settings push then
  // changes the query key above, which loads the new list
  const chooseAppMutation = useMutation({
    mutationFn: (): Promise<void> => tiny.api.call("chooseAppToExclude"),
  });

  function removeExcludedApp(bundleId: string): void {
    void updateSettings({
      excludedApps: settings.value.excludedApps.filter((id) => id !== bundleId),
    });
  }

  return {
    excludedApps: excludedAppsQuery.data,
    excludedAppsError: excludedAppsQuery.error,
    chooseAppToExclude: () => chooseAppMutation.mutate(),
    isChoosingApp: chooseAppMutation.isPending,
    chooseAppError: chooseAppMutation.error,
    removeExcludedApp,
  };
}
