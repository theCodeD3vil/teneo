import { onBeforeUnmount, onMounted, ref } from "vue";

// The section crossing a thin band at the middle of the viewport is the active one.
// Anywhere else (the hero, a gap) nothing is active. Ids with no matching element yet are skipped.
export function useActiveSection(ids: string[]) {
  const active = ref("");
  let observer: IntersectionObserver | undefined;

  onMounted(() => {
    const crossing = new Set<string>();
    observer = new IntersectionObserver(
      (entries) => {
        for (const { isIntersecting, target } of entries) {
          if (isIntersecting) crossing.add(target.id);
          else crossing.delete(target.id);
        }
        active.value = ids.find((id) => crossing.has(id)) ?? "";
      },
      { rootMargin: "-45% 0px -50% 0px" },
    );
    for (const id of ids) {
      const section = document.getElementById(id);
      if (section) observer.observe(section);
    }
  });
  onBeforeUnmount(() => observer?.disconnect());

  return active;
}
