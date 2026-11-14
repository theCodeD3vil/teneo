import { ref } from "vue";

export interface Toast {
  id: number;
  message: string;
}

const activeToast = ref<Toast | null>(null);
let timer: ReturnType<typeof setTimeout> | null = null;
let toastId = 0;

export function useToast() {
  function showToast(message: string, duration = 2000) {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    activeToast.value = { id: ++toastId, message };
    timer = setTimeout(() => {
      activeToast.value = null;
      timer = null;
    }, duration);
  }

  function dismissToast() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    activeToast.value = null;
  }

  return {
    activeToast,
    showToast,
    dismissToast,
  };
}
