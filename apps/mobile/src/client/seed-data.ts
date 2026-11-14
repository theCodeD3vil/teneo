import type {
  ClipboardHistoryItem,
  ClipboardSourceApp,
  SecretSpan,
} from "@teneo/shared/types/clipboard";

interface SeedTemplate {
  text: string;
  sourceApp: ClipboardSourceApp;
  sourceURL?: string | null;
  link?: { url: string; host: string } | null;
  secrets?: SecretSpan[];
  pinned?: boolean;
}

const DEVICES = {
  macbook: { name: "MacBook Pro", bundleId: "com.apple.Safari" },
  vscode: { name: "MacBook Pro", bundleId: "com.microsoft.VSCode" },
  terminal: { name: "MacBook Pro", bundleId: "com.apple.Terminal" },
  slack: { name: "MacBook Pro", bundleId: "com.tinyspeck.slackmacgap" },
  notes: { name: "MacBook Pro", bundleId: "com.apple.Notes" },
  pixel: { name: "Pixel 6 Pro", bundleId: null },
  pixelChrome: { name: "Pixel 6 Pro", bundleId: "com.android.chrome" },
  imac: { name: "iMac", bundleId: "com.google.Chrome" },
  macStudio: { name: "Mac Studio", bundleId: "com.apple.Terminal" },
};

export function createSeedItems(): ClipboardHistoryItem[] {
  const now = Date.now();
  const MINUTE = 60 * 1000;
  const HOUR = 60 * MINUTE;

  const curatedTemplates: SeedTemplate[] = [
    // Pinned items
    {
      text: "https://github.com/theCodeD3vil/teneo",
      sourceApp: DEVICES.macbook,
      sourceURL: "https://github.com/theCodeD3vil/teneo",
      link: {
        url: "https://github.com/theCodeD3vil/teneo",
        host: "github.com",
      },
      pinned: true,
    },
    {
      text: "npm run test:e2e -- --project=chromium --headed",
      sourceApp: DEVICES.terminal,
      pinned: true,
    },
    {
      text: "teneo://pair?v=1&k=pub_99a8b7c6d5e4f3a2b1c09876543210ab",
      sourceApp: DEVICES.macStudio,
      pinned: true,
    },
    {
      text: "color-scheme: light dark;\n--primary: hsl(221.2 83.2% 53.3%);\n--background: hsl(0 0% 100%);",
      sourceApp: DEVICES.vscode,
      pinned: true,
    },
    {
      text: "export OPENAI_API_KEY=example-openai-key-xxxxxxxxxxxxxxxxxxxxxxxx0001",
      sourceApp: DEVICES.terminal,
      secrets: [
        {
          start: 22,
          end: 69,
          label: "OpenAI API key",
        },
      ],
      pinned: true,
    },

    // Links
    {
      text: "https://capacitorjs.com/docs/apis/system-bars",
      sourceApp: DEVICES.pixelChrome,
      sourceURL: "https://capacitorjs.com/docs/apis/system-bars",
      link: {
        url: "https://capacitorjs.com/docs/apis/system-bars",
        host: "capacitorjs.com",
      },
    },
    {
      text: "https://developer.android.com/about/versions/15/behavior-changes-15",
      sourceApp: DEVICES.imac,
      sourceURL:
        "https://developer.android.com/about/versions/15/behavior-changes-15",
      link: {
        url: "https://developer.android.com/about/versions/15/behavior-changes-15",
        host: "developer.android.com",
      },
    },
    {
      text: "https://tailwindcss.com/docs/theme",
      sourceApp: DEVICES.macbook,
      sourceURL: "https://tailwindcss.com/docs/theme",
      link: {
        url: "https://tailwindcss.com/docs/theme",
        host: "tailwindcss.com",
      },
    },
    {
      text: "https://news.ycombinator.com/item?id=39120485",
      sourceApp: DEVICES.pixelChrome,
      sourceURL: "https://news.ycombinator.com/item?id=39120485",
      link: {
        url: "https://news.ycombinator.com/item?id=39120485",
        host: "news.ycombinator.com",
      },
    },
    {
      text: "https://github.com/vuejs/core/releases/tag/v3.5.0",
      sourceApp: DEVICES.macbook,
      sourceURL: "https://github.com/vuejs/core/releases/tag/v3.5.0",
      link: {
        url: "https://github.com/vuejs/core/releases/tag/v3.5.0",
        host: "github.com",
      },
    },

    // Secrets / Sensitive Items
    {
      text: "Authorization: Bearer example-github-token-xxxxxxxxxxxxxxxx0002",
      sourceApp: DEVICES.terminal,
      secrets: [
        {
          start: 22,
          end: 63,
          label: "GitHub personal access token",
        },
      ],
    },
    {
      text: "STRIPE_SECRET_KEY=example-stripe-key-xxxxxxxxxxxxxxxxxxxxxxx0003",
      sourceApp: DEVICES.vscode,
      secrets: [
        {
          start: 18,
          end: 64,
          label: "Stripe live secret key",
        },
      ],
    },
    {
      text: "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE\nAWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      sourceApp: DEVICES.terminal,
      secrets: [
        { start: 18, end: 38, label: "AWS access key" },
        { start: 61, end: 101, label: "AWS secret access key" },
      ],
    },
    {
      text: "export SLACK_BOT_TOKEN=example-slack-token-xxxxxxxxxxxxxxxxxxxx0004",
      sourceApp: DEVICES.terminal,
      secrets: [
        {
          start: 23,
          end: 67,
          label: "Slack bot token",
        },
      ],
    },
    {
      text: "ANTHROPIC_API_KEY=example-anthropic-key-xxxxxxxxxxxxxxxxxxxxxxx0005",
      sourceApp: DEVICES.vscode,
      secrets: [
        {
          start: 18,
          end: 67,
          label: "Anthropic API key",
        },
      ],
    },

    // Code snippets
    {
      text: `export function useKeyboard() {
  const isVisible = ref(false);
  const height = ref(0);

  onMounted(() => {
    Keyboard.addListener("keyboardWillShow", (info) => {
      isVisible.value = true;
      height.value = info.keyboardHeight;
    });
    Keyboard.addListener("keyboardWillHide", () => {
      isVisible.value = false;
      height.value = 0;
    });
  });

  return { isVisible, height };
}`,
      sourceApp: DEVICES.vscode,
    },
    {
      text: "SELECT items.id, items.text, items.pinned, items.date_copied FROM clipboard_items items WHERE items.concealed = 0 ORDER BY items.pinned DESC, items.date_copied DESC LIMIT 50;",
      sourceApp: DEVICES.terminal,
    },
    {
      text: 'curl -X POST https://api.anthropic.com/v1/messages \\\n  -H \'content-type: application/json\' \\\n  -d \'{"model": "claude-3-5-sonnet-20241022", "max_tokens": 1024}\'',
      sourceApp: DEVICES.terminal,
    },
    {
      text: `interface DeviceSyncProtocol {
  version: 1;
  deviceId: string;
  deviceName: string;
  publicKey: Uint8Array;
  timestamp: number;
}`,
      sourceApp: DEVICES.vscode,
    },
    {
      text: "mise exec -- ./android/gradlew -p android :app:assembleDebug",
      sourceApp: DEVICES.terminal,
    },
    {
      text: "git checkout -b feat/mobile-ui development",
      sourceApp: DEVICES.terminal,
    },
    {
      text: "adb shell am start -n com.michael.teneo/.MainActivity",
      sourceApp: DEVICES.terminal,
    },

    // Messages & notes
    {
      text: "Meeting notes: sync engine core is settling on development branch. UI components already moved into @teneo/ui in PR #26.",
      sourceApp: DEVICES.slack,
    },
    {
      text: "Remember to test edge-to-edge status bar padding and system back gesture swipe on physical Pixel 6 Pro.",
      sourceApp: DEVICES.notes,
    },
    {
      text: "Flight confirmation: BA0245 London Heathrow to Berlin Brandenburg, Gate B14, Departure 14:20.",
      sourceApp: DEVICES.notes,
    },
    {
      text: "Parcel tracking number: 1Z9999999999999999 (UPS Express)",
      sourceApp: DEVICES.pixel,
    },
    {
      text: "Wi-Fi Password: changeme-example-wifi",
      sourceApp: DEVICES.pixel,
    },
    {
      text: "Color token palette: primary hsl(221.2 83.2% 53.3%), secondary hsl(210 40% 96.1%), muted hsl(210 40% 96.1%).",
      sourceApp: DEVICES.macbook,
    },

    // Long multi-paragraph text (> 1000 chars)
    {
      text: `# Teneo Sync Engine Architecture Overview

Teneo's local-first sync protocol connects your desktop and mobile devices peer-to-peer over your local network using mutual TLS and state-based Conflict-Free Replicated Data Types (CRDTs).

## Key Principles

1. Zero Cloud Dependency: Your data never leaves your devices. Transfers take place directly over local Wi-Fi, Ethernet, or USB tethering without traversing third-party relay servers.
2. End-to-End Cryptographic Verification: Devices pair once by scanning a cryptographic QR code containing the pairing key. Subsequent sessions authenticate using pre-shared Ed25519 public keys.
3. Tombstone Garbage Collection: Deleted clipboard items are marked with tombstones that persist for 30 days across all devices before being purged from the local SQLite databases.
4. Secret Isolation: Credentials and sensitive tokens detected by Teneo's local regex scanner can be excluded from sync based on user preference.

## Data Model

Each clipboard entry is identified by a ULID (Universally Unique Lexicographically Sortable Identifier) generated at capture time. Changes are tracked using vector clocks that increment on every mutation (e.g. pin, tag, update). When concurrent modifications occur, the latest timestamp wins.

Teneo is built for speed and privacy.`,
      sourceApp: DEVICES.notes,
    },
    {
      text: `// Comprehensive Database Schema Migration: V3 -> V4
CREATE TABLE IF NOT EXISTS clipboard_entries (
    id TEXT PRIMARY KEY NOT NULL,
    device_id TEXT NOT NULL,
    kind TEXT CHECK(kind IN ('text', 'files', 'image', 'color')) NOT NULL,
    text_content TEXT,
    html_content TEXT,
    color_hex TEXT,
    pinned INTEGER DEFAULT 0 NOT NULL,
    concealed INTEGER DEFAULT 0 NOT NULL,
    date_copied INTEGER NOT NULL,
    date_modified INTEGER NOT NULL,
    change_count INTEGER DEFAULT 1 NOT NULL,
    source_app_name TEXT,
    source_app_bundle TEXT,
    source_url TEXT
);

CREATE INDEX IF NOT EXISTS idx_entries_search ON clipboard_entries(pinned DESC, date_copied DESC);
CREATE INDEX IF NOT EXISTS idx_entries_kind ON clipboard_entries(kind);
CREATE INDEX IF NOT EXISTS idx_entries_device ON clipboard_entries(device_id);

CREATE TABLE IF NOT EXISTS secret_occurrences (
    id TEXT PRIMARY KEY NOT NULL,
    entry_id TEXT NOT NULL REFERENCES clipboard_entries(id) ON DELETE CASCADE,
    start_offset INTEGER NOT NULL,
    end_offset INTEGER NOT NULL,
    label TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_peers (
    peer_id TEXT PRIMARY KEY NOT NULL,
    peer_name TEXT NOT NULL,
    model TEXT NOT NULL,
    public_key BLOB NOT NULL,
    last_synced INTEGER NOT NULL,
    is_trusted INTEGER DEFAULT 1 NOT NULL
);`,
      sourceApp: DEVICES.vscode,
    },
  ];

  const items: ClipboardHistoryItem[] = [];

  // Generate 250 items total, alternating between curated and generated realistic entries
  const extraSnippets = [
    "docker compose up -d postgres redis",
    "pnpm dlx shadcn-vue@latest add button input select",
    "npx cap run android --target 1A251FDEE005C8",
    "https://developer.mozilla.org/en-US/docs/Web/API/Clipboard_API",
    "border-radius: calc(var(--radius) - 2px);",
    "git stash && git pull --rebase origin main && git stash pop",
    "sudo systemctl restart nginx.service",
    "const [state, send] = useMachine(toggleMachine);",
    "https://crates.io/crates/rusqlite",
    "ssh -i ~/.ssh/id_ed25519 developer@192.168.1.150",
    "bun add @tanstack/vue-virtual clsx tailwind-merge",
    "https://vitest.dev/guide/coverage.html",
    "console.log('[SyncEngine] Handshake initiated with peer', peerId);",
    "export const dynamic = 'force-dynamic';",
    "grep -rn 'TeneoClient' apps/mobile/src",
    "adb logcat -s Capacitor/Console:D",
    "https://kotlinlang.org/docs/coroutines-overview.html",
    "zsh: command not found: mise",
    "SELECT COUNT(*) FROM history_items WHERE date_copied > strftime('%s', 'now', '-7 days');",
    "const debounce = (fn, ms) => { let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); }; };",
  ];

  let idCounter = 1;

  // Add curated templates first with realistic time offsets
  for (let i = 0; i < curatedTemplates.length; i++) {
    const t = curatedTemplates[i];
    // Offset backwards in time: items from recent minutes to a couple weeks
    const timeOffset = i * 42 * MINUTE + (i % 3) * 15 * MINUTE;
    const dateCopied = now - timeOffset;
    const isTruncated = t.text.length > 1000;

    items.push({
      id: `item-${String(idCounter++).padStart(4, "0")}`,
      dateCopied,
      kind: "text",
      changeCount: 1,
      text: t.text,
      html: null,
      paths: [],
      image: null,
      imageSize: null,
      color: null,
      concealed: false,
      sourceApp: t.sourceApp,
      sourceURL: t.sourceURL ?? null,
      pinned: t.pinned ?? false,
      pasteAsFile: false,
      fileSize: null,
      secrets: t.secrets ?? [],
      link: t.link ?? null,
      isTruncated,
    });
  }

  // Fill up to 250 items with realistic entries
  const appList = Object.values(DEVICES);
  while (items.length < 250) {
    const idx = items.length;
    const snippet = extraSnippets[idx % extraSnippets.length];
    const text =
      idx % 9 === 0
        ? `${snippet} // variant ${idx}\n// Generated sample entry for virtualized scroll test`
        : idx % 13 === 0
          ? `https://teneo.app/docs/sync/device-${idx}`
          : `${snippet} #${idx}`;

    const isLink = text.startsWith("http://") || text.startsWith("https://");
    const linkObj = isLink
      ? {
          url: text,
          host: new URL(text).hostname.replace(/^www\./, ""),
        }
      : null;

    const sourceApp = appList[idx % appList.length];
    const timeOffset = curatedTemplates.length * 42 * MINUTE + idx * 2.5 * HOUR;
    const dateCopied = now - timeOffset;

    // Pin a couple more items sprinkled in
    const pinned = idx === 35 || idx === 72;

    items.push({
      id: `item-${String(idCounter++).padStart(4, "0")}`,
      dateCopied,
      kind: "text",
      changeCount: 1,
      text,
      html: null,
      paths: [],
      image: null,
      imageSize: null,
      color: null,
      concealed: false,
      sourceApp,
      sourceURL: isLink ? text : null,
      pinned,
      pasteAsFile: false,
      fileSize: null,
      secrets: [],
      link: linkObj,
      isTruncated: false,
    });
  }

  // Sort items: pinned first (by dateCopied desc), then unpinned by dateCopied desc
  return items.sort((a, b) => {
    if (a.pinned !== b.pinned) {
      return a.pinned ? -1 : 1;
    }
    if (b.dateCopied !== a.dateCopied) {
      return b.dateCopied - a.dateCopied;
    }
    return b.id.localeCompare(a.id);
  });
}
