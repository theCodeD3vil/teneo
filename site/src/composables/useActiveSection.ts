import { onBeforeUnmount, onMounted, ref } from "vue";

// The section under the middle of the viewport is the active one. Anywhere else (the hero,
// a gap) nothing is active. Sections are looked up again on every scroll, so one that was
// re-rendered (hot reload) or doesn't exist yet never leaves a stale element behind.
export function useActiveSection(ids: string[]) {
  const active = ref("");

  function update() {
    const middle = window.innerHeight / 2;
    active.value =
      ids.find((id) => {
        const box = document.getElementById(id)?.getBoundingClientRect();
        return box && box.top <= middle && box.bottom > middle;
      }) ?? "";
  }

  onMounted(() => {
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
  });
  onBeforeUnmount(() => {
    window.removeEventListener("scroll", update);
    window.removeEventListener("resize", update);
  });

  return active;
}
