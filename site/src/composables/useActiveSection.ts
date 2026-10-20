import { onBeforeUnmount, onMounted, ref } from "vue";

// The section crossing a thin band at the middle of the viewport is the active one.
// Ids with no matching element yet are skipped.
export function useActiveSection(ids: string[]) {
  const active = ref(ids[0]);
  let observer: IntersectionObserver | undefined;

  onMounted(() => {
    observer = new IntersectionObserver(
      (entries) => {
        for (const { isIntersecting, target } of entries) {
          if (isIntersecting) active.value = target.id;
        }
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
