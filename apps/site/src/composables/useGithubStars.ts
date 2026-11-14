import { useStorage } from "@vueuse/core";
import { computed } from "vue";

const CACHE_TTL_MS = 60 * 60 * 1000;

// Cached because GitHub's unauthenticated API allows only 60 requests/hour per IP.
export function useGithubStars(repo: string) {
  const cache = useStorage(`github-stars:${repo}`, {
    count: null as number | null,
    fetchedAt: 0,
  });

  if (Date.now() - cache.value.fetchedAt > CACHE_TTL_MS) {
    fetch(`https://api.github.com/repos/${repo}`)
      .then((response) => response.json())
      .then(({ stargazers_count }) => {
        if (typeof stargazers_count === "number") {
          cache.value = { count: stargazers_count, fetchedAt: Date.now() };
        }
      })
      .catch(() => {});
  }

  const formatter = new Intl.NumberFormat("en", { notation: "compact" });
  return computed(() =>
    cache.value.count === null ? null : formatter.format(cache.value.count),
  );
}
