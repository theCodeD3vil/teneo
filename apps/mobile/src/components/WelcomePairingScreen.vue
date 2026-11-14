<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import IconArrowLeft from "~icons/tabler/arrow-left";
import IconCheck from "~icons/tabler/check";
import IconDeviceDesktop from "~icons/tabler/device-desktop";
import IconKeyboard from "~icons/tabler/keyboard";
import IconQrcode from "~icons/tabler/qrcode";

import { useClient } from "../client";
import { useNavigation } from "../composables/useNavigation";
import { useToast } from "../composables/useToast";

const props = withDefaults(
  defineProps<{
    initialStep?: "scan" | "manual" | "success";
  }>(),
  {
    initialStep: "scan",
  },
);

const client = useClient();
const { goBack } = useNavigation();
const { showToast } = useToast();

const currentStep = ref<"scan" | "manual" | "success">(props.initialStep);
const manualCode = ref("");
const isSubmitting = ref(false);
const errorMessage = ref("");
const pairedDeviceName = ref("MacBook Pro");

// Video stream reference for camera
const videoRef = ref<HTMLVideoElement | null>(null);
const cameraActive = ref(false);
const cameraPermissionDenied = ref(false);
let mediaStream: MediaStream | null = null;
let scanInterval: ReturnType<typeof setInterval> | null = null;

async function startCamera() {
  if (
    typeof navigator === "undefined" ||
    !navigator.mediaDevices?.getUserMedia
  ) {
    cameraPermissionDenied.value = true;
    return;
  }

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" },
    });
    cameraActive.value = true;
    cameraPermissionDenied.value = false;

    if (videoRef.value) {
      videoRef.value.srcObject = mediaStream;
      await videoRef.value.play();
    }

    // Check for native BarcodeDetector API
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const barcodeDetectorClass = (window as any).BarcodeDetector;
    if (barcodeDetectorClass) {
      const detector = new barcodeDetectorClass({ formats: ["qr_code"] });
      scanInterval = setInterval(async () => {
        if (!videoRef.value || videoRef.value.readyState < 2) return;
        try {
          const barcodes = await detector.detect(videoRef.value);
          if (barcodes.length > 0 && barcodes[0].rawValue) {
            stopCamera();
            await submitCode(barcodes[0].rawValue);
          }
        } catch {
          // ignore detection frame error
        }
      }, 500);
    }
  } catch {
    cameraPermissionDenied.value = true;
    cameraActive.value = false;
  }
}

function stopCamera() {
  if (scanInterval) {
    clearInterval(scanInterval);
    scanInterval = null;
  }
  if (mediaStream) {
    for (const track of mediaStream.getTracks()) {
      track.stop();
    }
    mediaStream = null;
  }
  cameraActive.value = false;
}

async function submitCode(code: string) {
  if (!code.trim()) {
    errorMessage.value = "Please enter a pairing code.";
    return;
  }

  isSubmitting.value = true;
  errorMessage.value = "";

  try {
    const result = await client.pair(code);
    if (result.ok) {
      pairedDeviceName.value = result.deviceName ?? "MacBook Pro";
      currentStep.value = "success";
      showToast("Device paired successfully");
    } else {
      errorMessage.value =
        result.error ?? "Invalid pairing code. Please check and try again.";
    }
  } finally {
    isSubmitting.value = false;
  }
}

async function handlePaste() {
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        manualCode.value = text;
      }
    } catch {
      // Clipboard read blocked
    }
  }
}

// Development quick-pairing simulation
function simulateScanSuccess() {
  stopCamera();
  submitCode("teneo://pair?v=1&k=pub_macbook_pro_sample_key_2026");
}

function handleDone() {
  stopCamera();
  goBack();
}

function handleUseWithoutPairing() {
  stopCamera();
  goBack();
}

onMounted(() => {
  if (currentStep.value === "scan") {
    startCamera();
  }
});

onUnmounted(() => {
  stopCamera();
});
</script>

<template>
  <div class="bg-background flex h-dvh flex-col overflow-hidden">
    <!-- Header -->
    <header
      class="safe-area-header border-border bg-background/95 border-b px-4 pt-3 pb-3 backdrop-blur-md">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-1.5">
          <button
            class="text-foreground hover:bg-muted active:bg-muted/80 flex size-11 items-center justify-center rounded-full"
            aria-label="Go back"
            @click="handleDone">
            <IconArrowLeft class="size-5" />
          </button>
          <span class="text-base font-semibold tracking-tight"
            >Pair with Mac</span
          >
        </div>

        <button
          class="text-muted-foreground hover:text-foreground px-2 py-1 text-xs font-semibold"
          @click="handleUseWithoutPairing">
          Skip
        </button>
      </div>
    </header>

    <!-- Main Content Flow -->
    <main class="flex-1 overflow-y-auto px-5 py-6">
      <!-- 1. Scanner Step -->
      <div
        v-if="currentStep === 'scan'"
        class="flex flex-col items-center text-center">
        <h2 class="text-foreground text-xl font-bold tracking-tight">
          Scan QR code on your Mac
        </h2>
        <p class="text-muted-foreground mt-2 max-w-xs text-xs">
          Open Teneo on your Mac, click
          <strong class="text-foreground">Settings → Sync</strong>, and point
          your phone camera at the code.
        </p>

        <!-- Camera / Viewport Box -->
        <div
          class="border-primary/40 relative mt-6 aspect-square w-full max-w-[280px] overflow-hidden rounded-3xl border-2 bg-black/90 shadow-lg">
          <video
            v-show="cameraActive"
            ref="videoRef"
            playsinline
            muted
            class="size-full object-cover" />

          <!-- Camera permission refused or inactive fallback -->
          <div
            v-if="!cameraActive"
            class="flex size-full flex-col items-center justify-center p-6 text-white">
            <IconQrcode class="text-primary mb-3 size-16" />
            <p
              v-if="cameraPermissionDenied"
              class="text-muted-foreground text-xs">
              Camera access is denied or not available.
            </p>
            <p v-else class="text-muted-foreground text-xs">
              Initializing camera scanner…
            </p>
          </div>

          <!-- Targeting Corner Overlays -->
          <div
            class="border-primary/60 pointer-events-none absolute inset-4 rounded-2xl border-2 border-dashed" />
        </div>

        <!-- Simulated Scan Button for easy testing & offline pairing -->
        <div class="mt-6 flex w-full max-w-[280px] flex-col gap-2.5">
          <button
            class="bg-primary text-primary-foreground active:bg-primary/90 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl text-xs font-semibold shadow-xs"
            @click="simulateScanSuccess">
            <IconQrcode class="size-4" />
            <span>Simulate QR Code Scan</span>
          </button>

          <button
            class="border-border bg-card text-foreground hover:bg-muted active:bg-muted/80 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border text-xs font-semibold"
            @click="
              stopCamera();
              currentStep = 'manual';
            ">
            <IconKeyboard class="text-muted-foreground size-4" />
            <span>Enter code manually</span>
          </button>
        </div>
      </div>

      <!-- 2. Manual Code Step -->
      <div
        v-else-if="currentStep === 'manual'"
        class="flex flex-col items-center text-center">
        <h2 class="text-foreground text-xl font-bold tracking-tight">
          Enter pairing code
        </h2>
        <p class="text-muted-foreground mt-2 max-w-xs text-xs">
          Type the 16-character recovery code or paste the pairing URI from your
          Mac.
        </p>

        <div class="mt-6 w-full max-w-sm space-y-3 text-left">
          <div class="relative">
            <input
              v-model="manualCode"
              type="text"
              placeholder="e.g. ABCD-1234-EFGH-5678"
              class="border-input bg-card text-foreground placeholder:text-muted-foreground focus:border-primary focus:ring-primary/20 h-12 w-full rounded-2xl border px-4 font-mono text-sm placeholder:font-sans focus:ring-2 focus:outline-hidden"
              @keydown.enter="submitCode(manualCode)" />
            <button
              class="text-primary absolute inset-y-0 right-0 flex items-center pr-3 text-xs font-semibold hover:underline"
              @click="handlePaste">
              Paste
            </button>
          </div>

          <p v-if="errorMessage" class="text-destructive text-xs font-medium">
            {{ errorMessage }}
          </p>

          <div class="space-y-2 pt-2">
            <button
              class="bg-primary text-primary-foreground active:bg-primary/90 flex min-h-12 w-full items-center justify-center rounded-2xl text-xs font-semibold shadow-xs disabled:opacity-50"
              :disabled="isSubmitting"
              @click="submitCode(manualCode)">
              <span v-if="isSubmitting">Connecting…</span>
              <span v-else>Connect</span>
            </button>

            <button
              class="text-muted-foreground hover:bg-muted active:bg-muted/80 flex min-h-12 w-full items-center justify-center rounded-2xl text-xs font-semibold"
              @click="
                currentStep = 'scan';
                startCamera();
              ">
              Back to camera scan
            </button>
          </div>
        </div>
      </div>

      <!-- 3. Success Step -->
      <div
        v-else-if="currentStep === 'success'"
        class="flex flex-col items-center py-10 text-center">
        <div
          class="flex size-16 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-500">
          <IconCheck class="size-8 stroke-[2.5]" />
        </div>

        <h2 class="text-foreground mt-4 text-xl font-bold tracking-tight">
          Paired successfully!
        </h2>
        <p class="text-muted-foreground mt-1 text-xs">
          Teneo is now connected with your Mac.
        </p>

        <div
          class="border-border bg-card mt-6 flex w-full max-w-xs items-center gap-3.5 rounded-2xl border p-4 text-left shadow-2xs">
          <span
            class="bg-primary/10 text-primary flex size-10 items-center justify-center rounded-xl">
            <IconDeviceDesktop class="size-5" />
          </span>
          <div>
            <p class="text-foreground text-sm font-semibold">
              {{ pairedDeviceName }}
            </p>
            <p class="text-xs font-medium text-emerald-500">Connected</p>
          </div>
        </div>

        <div class="mt-8 w-full max-w-xs">
          <button
            class="bg-primary text-primary-foreground active:bg-primary/90 flex min-h-12 w-full items-center justify-center rounded-2xl text-xs font-semibold shadow-xs"
            @click="handleDone">
            Go to clipboard history
          </button>
        </div>
      </div>

      <div class="safe-area-bottom-spacer" />
    </main>

    <!-- Footer: Use without pairing option -->
    <footer
      v-if="currentStep !== 'success'"
      class="safe-area-footer border-border bg-background/95 border-t px-4 py-3 text-center backdrop-blur-md">
      <button
        class="text-muted-foreground hover:text-foreground min-h-11 text-xs font-medium"
        @click="handleUseWithoutPairing">
        Use without pairing
      </button>
    </footer>
  </div>
</template>

<style scoped>
.safe-area-header {
  padding-top: max(
    0.75rem,
    var(--safe-area-inset-top, env(safe-area-inset-top))
  );
}

.safe-area-footer {
  padding-bottom: max(
    1rem,
    var(--safe-area-inset-bottom, env(safe-area-inset-bottom))
  );
}

.safe-area-bottom-spacer {
  height: max(
    2.5rem,
    calc(var(--safe-area-inset-bottom, env(safe-area-inset-bottom)) + 1.5rem)
  );
}
</style>
