import { readonly, ref } from "vue";

const COPIED_NOTICE_TIMEOUT = 1500;

// One notice for the whole app: the list and the preview both copy
const isCopiedNoticeShown = ref(false);
let hideTimeout: ReturnType<typeof setTimeout> | undefined;

/** Show "Copied" in the footer for a moment. */
export function showCopiedNotice(): void {
  isCopiedNoticeShown.value = true;
  clearTimeout(hideTimeout);
  hideTimeout = setTimeout(() => {
    isCopiedNoticeShown.value = false;
  }, COPIED_NOTICE_TIMEOUT);
}

export function useCopiedNotice() {
  return { isCopiedNoticeShown: readonly(isCopiedNoticeShown) };
}
