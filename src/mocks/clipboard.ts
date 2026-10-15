// Mock clipboard history in the shape returned by tiny.clipboard.read().
// changeCount is unique per item, so it can be used as a v-for key.

const apps = {
  chrome: { name: "Google Chrome", bundleId: "com.google.Chrome" },
  terminal: { name: "Terminal", bundleId: "com.apple.Terminal" },
  vscode: { name: "Visual Studio Code", bundleId: "com.microsoft.VSCode" },
  mail: { name: "Mail", bundleId: "com.apple.mail" },
  notes: { name: "Notes", bundleId: "com.apple.Notes" },
  messages: { name: "Messages", bundleId: "com.apple.MobileSMS" },
  slack: { name: "Slack", bundleId: "com.tinyspeck.slackmacgap" },
  tablePlus: { name: "TablePlus", bundleId: "com.tinyapp.TablePlus" },
  preview: { name: "Preview", bundleId: "com.apple.Preview" },
  photos: { name: "Photos", bundleId: "com.apple.Photos" },
  figma: { name: "Figma", bundleId: "com.figma.Desktop" },
  colorMeter: {
    name: "Digital Color Meter",
    bundleId: "com.apple.DigitalColorMeter",
  },
  finder: { name: "Finder", bundleId: "com.apple.finder" },
};

// Injected by vite.config.ts. File mocks point at real files in this repo,
// so Quick Look can render their previews.
declare const __PROJECT_ROOT__: string;
const repoFile = (relativePath: string) =>
  `${__PROJECT_ROOT__}/${relativePath}`;

// Every field is always present, so each mock starts from this and overrides what it needs.
const baseItem: TinyClipboardData = {
  kind: "empty",
  changeCount: 0,
  text: null,
  html: null,
  paths: [],
  image: null,
  imageSize: null,
  color: null,
  concealed: false,
  sourceApp: null,
  sourceURL: null,
};

export const mockTextItems: TinyClipboardData[] = [
  {
    ...baseItem,
    kind: "text",
    changeCount: 101,
    text: "git log --oneline --graph --decorate -20",
    sourceApp: apps.terminal,
  },
  {
    ...baseItem,
    kind: "text",
    changeCount: 102,
    text: "https://developer.apple.com/documentation/appkit/nspasteboard",
    sourceApp: apps.chrome,
  },
  {
    ...baseItem,
    kind: "text",
    changeCount: 103,
    text: "jane.doe@example.com",
    sourceApp: apps.mail,
  },
  {
    ...baseItem,
    kind: "text",
    changeCount: 104,
    text: '{\n  "name": "teneo",\n  "version": "0.1.0",\n  "private": true\n}',
    sourceApp: apps.vscode,
  },
  {
    ...baseItem,
    kind: "text",
    changeCount: 105,
    text: "export const sum = (a: number, b: number) => a + b;",
    sourceApp: apps.vscode,
  },
  {
    ...baseItem,
    kind: "text",
    changeCount: 106,
    text: "Standup: ship clipboard tabs, fix the scroll area, review PR #42.",
    html: "<p>Standup: ship clipboard tabs, fix the scroll area, review PR #42.</p>",
    sourceApp: apps.notes,
  },
  {
    ...baseItem,
    kind: "text",
    changeCount: 107,
    text: "221B Baker Street, London NW1 6XE",
    sourceApp: apps.messages,
  },
  {
    ...baseItem,
    kind: "text",
    changeCount: 108,
    text: "The best way to get a project done faster is to start sooner.",
    html: "<blockquote>The best way to get a project done faster is to start sooner.</blockquote>",
    sourceApp: apps.chrome,
    sourceURL: "https://www.example.com/blog/shipping-faster",
  },
  {
    ...baseItem,
    kind: "text",
    changeCount: 109,
    text: "Can we move the sync to 3pm tomorrow? I have a conflict at 2.",
    sourceApp: apps.slack,
  },
  {
    ...baseItem,
    kind: "text",
    changeCount: 110,
    text: "SELECT id, email FROM users WHERE created_at > now() - interval '7 days';",
    sourceApp: apps.tablePlus,
  },
];

// Real clipboard images are PNGs the backend saved to the app's data dir. Mocks
// use real files instead, so the card's preview path runs as it does for real items.
// macOS ships these sample pictures (the account-photo set) on every Mac.
const samplePicture = (name: string) => `/Library/User Pictures/${name}.heic`;

export const mockImageItems: TinyClipboardData[] = [
  {
    ...baseItem,
    kind: "image",
    changeCount: 201,
    image: samplePicture("Animals/Owl"),
    imageSize: { width: 512, height: 512 },
    sourceApp: apps.chrome,
    sourceURL: "https://unsplash.com/s/photos/owl",
    // Chrome's "Copy Image" also writes an <img> tag; the card reads the filename from it
    html: `<meta charset="utf-8"><img src="https://images.unsplash.com/snowy-owl.jpg?w=1200" alt="owl">`,
  },
  {
    ...baseItem,
    kind: "image",
    changeCount: 202,
    image: repoFile("icon.png"),
    imageSize: { width: 1024, height: 1024 },
    sourceApp: apps.figma,
  },
  {
    ...baseItem,
    kind: "image",
    changeCount: 203,
    // never created: shows the deleted-image state
    image: repoFile("deleted-screenshot.png"),
    imageSize: { width: 1440, height: 900 },
    sourceApp: apps.slack,
  },
  {
    ...baseItem,
    kind: "image",
    changeCount: 204,
    image: repoFile("src/assets/hero.png"),
    imageSize: { width: 343, height: 361 },
    sourceApp: apps.preview,
  },
  {
    ...baseItem,
    kind: "image",
    changeCount: 205,
    image: samplePicture("Animals/Parrot"),
    imageSize: { width: 512, height: 512 },
    sourceApp: apps.chrome,
    sourceURL: "https://unsplash.com/s/photos/parrot",
    html: `<meta charset="utf-8"><img src="https://images.unsplash.com/macaw-parrot.jpg?w=1200" alt="parrot">`,
  },
  {
    ...baseItem,
    kind: "image",
    changeCount: 206,
    image: samplePicture("Flowers/Dahlia"),
    imageSize: { width: 512, height: 512 },
    sourceApp: apps.photos,
  },
  {
    ...baseItem,
    kind: "image",
    changeCount: 207,
    image: samplePicture("Nature/Earth"),
    imageSize: { width: 512, height: 512 },
    sourceApp: apps.chrome,
    sourceURL: "https://unsplash.com/s/photos/earth",
    html: `<meta charset="utf-8"><img src="https://images.unsplash.com/earth-from-space.png?w=1200" alt="earth">`,
  },
  {
    ...baseItem,
    kind: "image",
    changeCount: 208,
    image: samplePicture("Nature/Leaf"),
    imageSize: { width: 512, height: 512 },
    sourceApp: apps.photos,
  },
  {
    ...baseItem,
    kind: "image",
    changeCount: 209,
    image: samplePicture("Nature/Snowflake"),
    imageSize: { width: 512, height: 512 },
    sourceApp: apps.preview,
  },
  {
    ...baseItem,
    kind: "image",
    changeCount: 210,
    image: samplePicture("Nature/Cactus"),
    imageSize: { width: 512, height: 512 },
    sourceApp: apps.figma,
  },
];

export const mockColorItems: TinyClipboardData[] = [
  {
    ...baseItem,
    kind: "color",
    changeCount: 301,
    color: "#3b82f6",
    sourceApp: apps.figma,
  },
  {
    ...baseItem,
    kind: "color",
    changeCount: 302,
    color: "#ef4444",
    sourceApp: apps.figma,
  },
  {
    ...baseItem,
    kind: "color",
    changeCount: 303,
    color: "#10b981",
    sourceApp: apps.colorMeter,
  },
  {
    ...baseItem,
    kind: "color",
    changeCount: 304,
    color: "#f59e0b",
    sourceApp: apps.chrome,
  },
  {
    ...baseItem,
    kind: "color",
    changeCount: 305,
    color: "#8b5cf6",
    sourceApp: apps.vscode,
  },
  {
    ...baseItem,
    kind: "color",
    changeCount: 306,
    color: "#0f172a",
    sourceApp: apps.figma,
  },
  {
    ...baseItem,
    kind: "color",
    changeCount: 307,
    color: "#f8fafc80", // with alpha
    sourceApp: apps.figma,
  },
  {
    ...baseItem,
    kind: "color",
    changeCount: 308,
    color: "#ec4899",
    sourceApp: apps.colorMeter,
  },
  {
    ...baseItem,
    kind: "color",
    changeCount: 309,
    color: "#14b8a6cc", // with alpha
    sourceApp: apps.vscode,
  },
  {
    ...baseItem,
    kind: "color",
    changeCount: 310,
    color: "#78716c",
    sourceApp: apps.chrome,
  },
];

export const mockFileItems: TinyClipboardData[] = [
  {
    ...baseItem,
    kind: "files",
    changeCount: 401,
    paths: [repoFile("icon.png")],
    sourceApp: apps.finder,
  },
  {
    ...baseItem,
    kind: "files",
    changeCount: 402,
    paths: [repoFile("README.md")],
    sourceApp: apps.finder,
  },
  {
    ...baseItem,
    kind: "files",
    changeCount: 403,
    // never created: shows the moved/deleted-file state
    paths: [repoFile("deleted-invoice.pdf")],
    sourceApp: apps.finder,
  },
  {
    ...baseItem,
    kind: "files",
    changeCount: 404,
    paths: [repoFile("src/App.vue"), repoFile("src/main.ts")],
    sourceApp: apps.finder,
  },
  {
    ...baseItem,
    kind: "files",
    changeCount: 405,
    paths: [repoFile("package.json")],
    sourceApp: apps.finder,
  },
  {
    ...baseItem,
    kind: "files",
    changeCount: 406,
    paths: [repoFile("src/assets/hero.png")],
    sourceApp: apps.finder,
  },
  {
    ...baseItem,
    kind: "files",
    changeCount: 407,
    paths: [repoFile("public/favicon.svg")],
    sourceApp: apps.finder,
  },
  {
    ...baseItem,
    kind: "files",
    changeCount: 408,
    paths: [repoFile("backend/main.ts")],
    sourceApp: apps.finder,
  },
  {
    ...baseItem,
    kind: "files",
    changeCount: 409,
    paths: [
      repoFile("public/icons.svg"),
      repoFile("src/assets/vue.svg"),
      repoFile("src/assets/vite.svg"),
    ],
    sourceApp: apps.finder,
  },
  {
    ...baseItem,
    kind: "files",
    changeCount: 410,
    paths: [repoFile("src/components")],
    sourceApp: apps.finder,
  },
];

// Fisher-Yates: walk backwards, swapping each item with a random one at or before it.
function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// 3 from each variant, mixed. The order changes on every page load.
export const mockAllItems: TinyClipboardData[] = shuffle([
  ...mockTextItems.slice(0, 3),
  ...mockImageItems.slice(0, 3),
  ...mockColorItems.slice(0, 3),
  ...mockFileItems.slice(0, 3),
]);
