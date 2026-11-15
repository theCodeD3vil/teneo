import { readonly, ref } from "vue";

// The app's window is made shorter by the on-screen keyboard (Capacitor pads
// it by the keyboard's height), so the keyboard shows as a window that lost
// a good part of its height without changing width. A browser's address bar
// hiding, or a split screen, changes it by far less or changes the width.
const smallestKeyboard = 150;

/** Whether a window this tall, once `tallest` at the same width, has the
 *  keyboard over it */
export function isKeyboardHeight(tallest: number, height: number): boolean {
  return tallest - height > smallestKeyboard;
}

const isKeyboardOpen = ref(false);
let width = 0;
let tallest = 0;
let isWatching = false;

function measure(): void {
  // another width is another layout (the phone was turned): start again
  if (window.innerWidth !== width) {
    width = window.innerWidth;
    tallest = window.innerHeight;
  }
  tallest = Math.max(tallest, window.innerHeight);
  isKeyboardOpen.value = isKeyboardHeight(tallest, window.innerHeight);
}

/** Whether the on-screen keyboard is up */
export function useKeyboard() {
  if (!isWatching) {
    isWatching = true;
    measure();
    window.addEventListener("resize", measure);
  }
  return { isKeyboardOpen: readonly(isKeyboardOpen) };
}
