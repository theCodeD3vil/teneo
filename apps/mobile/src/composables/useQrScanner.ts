import { Capacitor, registerPlugin } from "@capacitor/core";
import { readonly, ref } from "vue";

/** Google's code scanner, through QrScannerPlugin.java in the Android app */
interface QrScannerPlugin {
  isReady(): Promise<{ ready: boolean }>;
  prepare(): Promise<void>;
  scan(): Promise<{ value?: string }>;
}

const QrScanner = registerPlugin<QrScannerPlugin>("QrScanner");

/** The scanner needs the phone's camera; a browser shows the typed code only */
export const canScanQrCode = Capacitor.isNativePlatform();

const isPreparing = ref(false);
const isScanning = ref(false);

/**
 * Scan a QR code with Google's code scanner. It opens its own camera screen,
 * so Teneo never asks for the camera permission. Play services downloads the
 * scanner the first time; that wait shows as `isPreparing`.
 */
export function useQrScanner() {
  /** The code's text, or null if the user backed out of the scanner */
  async function scan(): Promise<string | null> {
    if (isScanning.value) return null;
    isScanning.value = true;
    try {
      await ensureScannerReady();
      const { value } = await QrScanner.scan();
      return value ?? null;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      throw new Error(`Couldn't scan. ${message}.`, { cause: caught });
    } finally {
      isScanning.value = false;
    }
  }

  return {
    scan,
    isPreparing: readonly(isPreparing),
    isScanning: readonly(isScanning),
  };
}

async function ensureScannerReady(): Promise<void> {
  const { ready } = await QrScanner.isReady();
  if (ready) return;

  isPreparing.value = true;
  try {
    await QrScanner.prepare();
  } catch (caught) {
    throw new Error(
      "The scanner couldn't be downloaded. Check your connection, or type the join code",
      { cause: caught },
    );
  } finally {
    isPreparing.value = false;
  }
}
