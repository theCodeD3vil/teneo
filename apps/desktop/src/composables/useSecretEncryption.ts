import { ref } from "vue";

// Turning encryption on reads the Keychain, where macOS may ask for the Mac
// password; turning it off decrypts the keys already saved
export function useSecretEncryption() {
  const isChanging = ref(false);
  const error = ref("");

  async function setEncryption(enabled: boolean): Promise<void> {
    isChanging.value = true;
    error.value = "";
    try {
      const isDone: boolean = await tiny.api.call("setSecretEncryption", {
        enabled,
      });
      if (!isDone) {
        error.value = enabled
          ? "Teneo couldn't use your Keychain, so keys aren't encrypted."
          : "Teneo couldn't read its key from your Keychain, so keys stay encrypted.";
      }
    } finally {
      isChanging.value = false;
    }
  }

  return { isChanging, error, setEncryption };
}
