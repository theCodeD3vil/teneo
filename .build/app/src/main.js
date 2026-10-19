// ../../../../../../../Users/michaelnji/Projects/desktop-apps/teneo/backend/files.ts
async function fileExists(path) {
  try {
    await tjs.stat(path);
    return true;
  } catch {
    return false;
  }
}
async function dataFolder(app, name) {
  const folder = `${app.paths.data}/${name}`;
  await tjs.makeDir(folder, { recursive: true });
  return folder;
}
async function pngDataUrl(path) {
  const png = await tjs.readFile(path);
  return `data:image/png;base64,${png.toBase64()}`;
}
function logError(message, error) {
  console.error(message, error);
}

// ../../../../../../../Users/michaelnji/Projects/desktop-apps/teneo/backend/run-command.ts
async function runCommand(command) {
  try {
    const child = tjs.spawn(command, { stdout: "pipe", stderr: "ignore" });
    const reader = child.stdout.getReader();
    const textDecoder = new TextDecoder();
    let output = "";
    for (; ; ) {
      const { value, done } = await reader.read();
      if (done) break;
      output += textDecoder.decode(value, { stream: true });
    }
    output += textDecoder.decode();
    const exit = await child.wait();
    return exit.exit_status === 0 ? output.trim() : "";
  } catch (error) {
    logError(`${command[0]} failed to run:`, error);
    return "";
  }
}

// ../../../../../../../Users/michaelnji/Projects/desktop-apps/teneo/backend/find-app.ts
var APP_FOLDERS = [
  "/Applications",
  "/System/Applications",
  "/System/Library/CoreServices",
  `${tjs.env.HOME}/Applications`
];
var BUNDLE_ID_PATTERN = /^[\w.-]+$/;
var installedApps;
function isValidBundleId(bundleId) {
  return BUNDLE_ID_PATTERN.test(bundleId);
}
async function findAppPath(bundleId) {
  return await findAppWithSpotlight(bundleId) ?? (await getInstalledApps()).get(bundleId);
}
async function findAppWithSpotlight(bundleId) {
  const results = await runCommand([
    "/usr/bin/mdfind",
    `kMDItemCFBundleIdentifier == '${bundleId}'`
  ]);
  const appPath = results.split("\n").find((path) => path.endsWith(".app"));
  return appPath && await fileExists(appPath) ? appPath : void 0;
}
function getInstalledApps() {
  installedApps ??= scanAllFolders().catch((error) => {
    installedApps = void 0;
    throw error;
  });
  return installedApps;
}
async function scanAllFolders() {
  const apps = /* @__PURE__ */ new Map();
  for (const folder of APP_FOLDERS) await scanFolderForApps(folder, apps, 1);
  return apps;
}
async function scanFolderForApps(folder, apps, subfolderDepth) {
  let entries;
  try {
    entries = await tjs.readDir(folder);
  } catch {
    return;
  }
  for await (const entry of entries) {
    const path = `${folder}/${entry.name}`;
    if (entry.name.endsWith(".app")) {
      const bundleId = await readBundleId(path);
      if (bundleId && !apps.has(bundleId)) apps.set(bundleId, path);
    } else if (entry.isDirectory && subfolderDepth > 0) {
      await scanFolderForApps(path, apps, subfolderDepth - 1);
    }
  }
}
function readBundleId(appPath) {
  return runCommand([
    "/usr/bin/plutil",
    "-extract",
    "CFBundleIdentifier",
    "raw",
    `${appPath}/Contents/Info.plist`
  ]);
}

// ../../../../../../../Users/michaelnji/Projects/desktop-apps/teneo/backend/app-icons.ts
var ICON_SIZE = 32;
var iconUrls = /* @__PURE__ */ new Map();
async function saveAppIcon(bundleId, app) {
  if (!isValidBundleId(bundleId)) return null;
  const iconPath = `${await dataFolder(app, "icons")}/${bundleId}.png`;
  if (await fileExists(iconPath)) return iconPath;
  const appPath = await findAppPath(bundleId);
  if (!appPath) return null;
  const thumbnail = await app.thumbnail(appPath, ICON_SIZE);
  await tjs.copyFile(thumbnail.path, iconPath);
  return iconPath;
}
function getAppIconUrl(bundleId, app) {
  if (typeof bundleId !== "string") return Promise.resolve(null);
  let iconUrl = iconUrls.get(bundleId);
  if (!iconUrl) {
    iconUrl = loadAppIconUrl(bundleId, app);
    iconUrls.set(bundleId, iconUrl);
  }
  return iconUrl;
}
async function loadAppIconUrl(bundleId, app) {
  try {
    const iconPath = await saveAppIcon(bundleId, app);
    return iconPath ? await pngDataUrl(iconPath) : null;
  } catch (error) {
    logError(`appIcon failed for ${bundleId}:`, error);
    return null;
  }
}

// ../../../../../../../Users/michaelnji/Projects/desktop-apps/teneo/node_modules/magic-regexp/dist/flags-DwxxNkZb.mjs
var ESCAPE_REPLACE_RE = /[.*+?^${}()|[\]\\/]/g;
function escapeString(value) {
  return value.replace(ESCAPE_REPLACE_RE, "\\$&");
}
function joinSources(inputs) {
  return inputs.map((input) => typeof input === "string" ? escapeString(input) : `${input}`).join("");
}
var SINGLE_CHAR_RE = /^\\?.$/s;
function isSingleChar(value) {
  return SINGLE_CHAR_RE.test(value);
}
function wrap(value, kind) {
  return kind === "atom" ? value : `(?:${value})`;
}
var GROUPED_AS_REPLACE_RE = /^(?:\(\?:(.+)\)|(.+))$/;
var GROUPED_REPLACE_RE = /^(?:\(\?:(.+)\)([?+*]|\{[\d,]+\})?|(.+))$/;
var KIND = /* @__PURE__ */ Symbol("magic-regexp.kind");
function kindOf(input) {
  return input[KIND];
}
function createInput(s, kind = "other") {
  const rewritable = kind !== "other";
  const groupedAsFn = (key) => createInput(`(?<${key}>${rewritable ? `${s}`.replace(GROUPED_AS_REPLACE_RE, "$1$2") : s})`, "atom");
  const quantified = (quantifier) => createInput(`${wrap(`${s}`, kind)}${quantifier}`, "quantified");
  return {
    [KIND]: kind,
    toString: () => s.toString(),
    and: Object.assign((...inputs) => createInput(`${s}${joinSources(inputs)}`), { referenceTo: (groupName) => createInput(`${s}\\k<${groupName}>`) }),
    or: (...inputs) => createInput(`(?:${s}|${inputs.map((v) => joinSources([v])).join("|")})`, "atom"),
    after: (...input) => createInput(`(?<=${joinSources(input)})${s}`),
    before: (...input) => createInput(`${s}(?=${joinSources(input)})`),
    notAfter: (...input) => createInput(`(?<!${joinSources(input)})${s}`),
    notBefore: (...input) => createInput(`${s}(?!${joinSources(input)})`),
    times: Object.assign((number) => quantified(`{${number}}`), {
      any: () => quantified("*"),
      atLeast: (min) => quantified(`{${min},}`),
      atMost: (max) => quantified(`{0,${max}}`),
      between: (min, max) => quantified(`{${min},${max}}`)
    }),
    optionally: () => quantified("?"),
    as: groupedAsFn,
    groupedAs: groupedAsFn,
    grouped: () => {
      return createInput(rewritable ? `${s}`.replace(GROUPED_REPLACE_RE, "($1$3)$2") : `(${s})`, kind === "quantified" ? "quantified" : "atom");
    },
    at: {
      lineStart: () => createInput(`^${s}`),
      lineEnd: () => createInput(`${s}$`)
    }
  };
}
function quantify(inputs, quantifier) {
  const joined = exactly(...inputs);
  return `${wrap(`${joined}`, kindOf(joined))}${quantifier}`;
}
function createCharInput(raw) {
  const input = createInput(`[${raw}]`, "atom");
  const from = (charFrom, charTo) => createCharInput(`${raw}${escapeCharInput(charFrom)}-${escapeCharInput(charTo)}`);
  const orChar = Object.assign((chars) => createCharInput(`${raw}${escapeCharInput(chars)}`), { from });
  return Object.assign(input, {
    orChar,
    from
  });
}
function escapeCharInput(raw) {
  return raw.replace(/[-\\^\]]/g, "\\$&");
}
var charIn = Object.assign((chars) => {
  return createCharInput(escapeCharInput(chars));
}, createCharInput(""));
var charNotIn = Object.assign((chars) => {
  return createCharInput(`^${escapeCharInput(chars)}`);
}, createCharInput("^"));
function anyOf(...inputs) {
  return createInput(`(?:${inputs.map((a) => exactly(a)).join("|")})`, "atom");
}
var char = createInput(".", "atom");
var word = createInput("\\b\\w+\\b");
var wordChar = createInput("\\w", "atom");
var wordBoundary = createInput("\\b");
var digit = createInput("\\d", "atom");
var whitespace = createInput("\\s", "atom");
var letter = Object.assign(createInput("[a-zA-Z]", "atom"), {
  lowercase: createInput("[a-z]", "atom"),
  uppercase: createInput("[A-Z]", "atom")
});
var tab = createInput("\\t", "atom");
var linefeed = createInput("\\n", "atom");
var carriageReturn = createInput("\\r", "atom");
var not = {
  word: createInput("\\W+"),
  wordChar: createInput("\\W", "atom"),
  wordBoundary: createInput("\\B"),
  digit: createInput("\\D", "atom"),
  whitespace: createInput("\\S", "atom"),
  letter: Object.assign(createInput("[^a-zA-Z]", "atom"), {
    lowercase: createInput("[^a-z]", "atom"),
    uppercase: createInput("[^A-Z]", "atom")
  }),
  tab: createInput("[^\\t]", "atom"),
  linefeed: createInput("[^\\n]", "atom"),
  carriageReturn: createInput("[^\\r]", "atom")
};
function maybe(...inputs) {
  return createInput(quantify(inputs, "?"), "quantified");
}
function exactly(...inputs) {
  const value = joinSources(inputs);
  const [only] = inputs;
  return createInput(value, inputs.length === 1 && typeof only !== "string" ? kindOf(only) : isSingleChar(value) ? "atom" : "other");
}
function oneOrMore(...inputs) {
  return createInput(quantify(inputs, "+"), "quantified");
}
var caseInsensitive = "i";

// ../../../../../../../Users/michaelnji/Projects/desktop-apps/teneo/node_modules/magic-regexp/dist/index.mjs
var createRegExp = (...inputs) => {
  const flags = inputs.length > 1 && (Array.isArray(inputs[inputs.length - 1]) || inputs[inputs.length - 1] instanceof Set) ? inputs.pop() : void 0;
  return new RegExp(exactly(...inputs).toString(), [...flags || ""].join(""));
};

// ../../../../../../../Users/michaelnji/Projects/desktop-apps/teneo/backend/color.ts
var hexadecimalDigit = charIn("0123456789abcdef");
var cssNumber = exactly(
  maybe(anyOf("+", "-")),
  anyOf(
    exactly(digit.times.atLeast(1), maybe(".", digit.times.any())),
    exactly(".", digit.times.atLeast(1))
  ),
  maybe(anyOf("e", "E"), maybe(anyOf("+", "-")), digit.times.atLeast(1))
);
var cssPercentage = exactly(cssNumber, "%");
var CSS_NUMBER_PATTERN = createRegExp(cssNumber.at.lineStart().at.lineEnd());
var CSS_PERCENTAGE_PATTERN = createRegExp(
  cssPercentage.at.lineStart().at.lineEnd()
);
var CSS_HEX_COLOR_PATTERN = createRegExp(
  exactly(
    "#",
    anyOf(
      hexadecimalDigit.times(3),
      hexadecimalDigit.times(4),
      hexadecimalDigit.times(6),
      hexadecimalDigit.times(8)
    )
  ).at.lineStart().at.lineEnd(),
  [caseInsensitive]
);
var CSS_COLOR_FUNCTION_PATTERN = createRegExp(
  exactly(
    anyOf(
      "rgb",
      "rgba",
      "hsl",
      "hsla",
      "hwb",
      "lab",
      "lch",
      "oklab",
      "oklch",
      "color",
      "device-cmyk"
    ),
    "(",
    charNotIn(")").times.atLeast(1),
    ")"
  ).at.lineStart().at.lineEnd(),
  [caseInsensitive]
);
var CSS_COMPOSITE_COLOR_FUNCTION_PATTERN = createRegExp(
  exactly(anyOf("color-mix", "light-dark"), "(", char.times.atLeast(1), ")").at.lineStart().at.lineEnd(),
  [caseInsensitive]
);
var CSS_IDENTIFIER_PATTERN = createRegExp(
  oneOrMore(letter).at.lineStart().at.lineEnd(),
  [caseInsensitive]
);
var CSS_NAMED_COLORS = new Set(
  "aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen transparent".split(
    " "
  )
);
var CSS_SYSTEM_COLORS = new Set(
  "accentcolor accentcolortext activetext buttonborder buttonface buttontext canvas canvastext field fieldtext graytext highlight highlighttext linktext mark marktext selecteditem selecteditemtext visitedtext".split(
    " "
  )
);
var CSS_COLOR_SPACES = new Set(
  "srgb srgb-linear display-p3 a98-rgb prophoto-rgb rec2020 xyz xyz-d50 xyz-d65".split(
    " "
  )
);
var CSS_COLOR_MIX_SPACES = /* @__PURE__ */ new Set([
  "srgb",
  "srgb-linear",
  "display-p3",
  "a98-rgb",
  "prophoto-rgb",
  "rec2020",
  "lab",
  "oklab",
  "xyz",
  "xyz-d50",
  "xyz-d65",
  "hsl",
  "hwb",
  "lch",
  "oklch"
]);
function getCssColor(value) {
  const color = value?.trim();
  if (!color) return null;
  if (CSS_HEX_COLOR_PATTERN.test(color)) return color;
  if (CSS_IDENTIFIER_PATTERN.test(color)) {
    const keyword = color.toLowerCase();
    return CSS_NAMED_COLORS.has(keyword) || CSS_SYSTEM_COLORS.has(keyword) ? color : null;
  }
  if (CSS_COLOR_FUNCTION_PATTERN.test(color)) {
    return isCssColorFunction(color) ? color : null;
  }
  if (CSS_COMPOSITE_COLOR_FUNCTION_PATTERN.test(color)) {
    return isCompositeCssColorFunction(color) ? color : null;
  }
  return null;
}
function normalizeClipboardColor(item) {
  if (item.kind !== "text") return item;
  const color = getCssColor(item.text);
  if (!color) return item;
  return {
    ...item,
    kind: "color",
    text: null,
    html: null,
    paths: [],
    image: null,
    imageSize: null,
    color
  };
}
function isCssColorFunction(color) {
  const openingParenthesis = color.indexOf("(");
  const name = color.slice(0, openingParenthesis).toLowerCase();
  const body = color.slice(openingParenthesis + 1, -1);
  const arguments_ = parseColorFunctionArguments(body);
  if (!arguments_) return false;
  switch (name) {
    case "rgb":
    case "rgba":
      return hasColorComponents(arguments_, 3, isNumberOrPercentage);
    case "hsl":
    case "hsla":
      return hasColorComponents(
        arguments_,
        3,
        (value, index) => index === 0 ? isHue(value) : isPercentage(value)
      );
    case "hwb":
      return !arguments_.usesCommas && hasColorComponents(
        arguments_,
        3,
        (value, index) => index === 0 ? isHue(value) : isPercentage(value)
      );
    case "lab":
    case "oklab":
      return !arguments_.usesCommas && hasColorComponents(arguments_, 3, isNumberOrPercentage);
    case "lch":
    case "oklch":
      return !arguments_.usesCommas && hasColorComponents(
        arguments_,
        3,
        (value, index) => index === 2 ? isHue(value) : isNumberOrPercentage(value)
      );
    case "color":
      return !arguments_.usesCommas && hasColorSpaceComponents(arguments_);
    case "device-cmyk":
      return !arguments_.usesCommas && hasColorComponents(arguments_, 4, isNumberOrPercentage);
    default:
      return false;
  }
}
function isCompositeCssColorFunction(color) {
  const openingParenthesis = color.indexOf("(");
  const name = color.slice(0, openingParenthesis).toLowerCase();
  const body = color.slice(openingParenthesis + 1, -1);
  if (name === "light-dark") {
    const colors = splitTopLevelCommas(body);
    return colors.length === 2 && colors.every((value) => getCssColor(value) != null);
  }
  const [interpolation, ...stops] = splitTopLevelCommas(body);
  if (stops.length !== 2 || !interpolation) return false;
  const interpolationParts = splitWhitespace(interpolation);
  if (interpolationParts[0]?.toLowerCase() !== "in" || !CSS_COLOR_MIX_SPACES.has(interpolationParts[1]?.toLowerCase()) || !isHueInterpolationMethod(interpolationParts.slice(2))) {
    return false;
  }
  return stops.every(isColorStop);
}
function parseColorFunctionArguments(value) {
  const slashParts = value.split("/");
  if (slashParts.length > 2) return null;
  const mainValue = slashParts[0].trim();
  const alpha = slashParts[1]?.trim() || null;
  const usesCommas = mainValue.includes(",");
  if (usesCommas && slashParts.length > 1) return null;
  const values = usesCommas ? mainValue.split(",").map((component) => component.trim()) : splitWhitespace(mainValue);
  if (!values.length || values.some((component) => !component)) return null;
  return { values, alpha, usesCommas };
}
function hasColorComponents(arguments_, count, validateComponent) {
  const { values, usesCommas } = arguments_;
  const hasLegacyAlpha = usesCommas && values.length === count + 1;
  if (values.length !== count && !hasLegacyAlpha) return false;
  const components = values.slice(0, count);
  const alpha = hasLegacyAlpha ? values[count] : arguments_.alpha;
  return components.every(validateComponent) && (alpha == null || isAlpha(alpha));
}
function hasColorSpaceComponents(arguments_) {
  const [colorSpace, ...components] = arguments_.values;
  return CSS_COLOR_SPACES.has(colorSpace.toLowerCase()) && components.length === 3 && components.every(isNumberOrPercentage) && (arguments_.alpha == null || isAlpha(arguments_.alpha));
}
function isNumberOrPercentage(value) {
  return value === "none" || isCssNumber(value) || isPercentage(value);
}
function isPercentage(value) {
  return value === "none" || CSS_PERCENTAGE_PATTERN.test(value);
}
function isHue(value) {
  if (value === "none" || isCssNumber(value)) return true;
  for (const unit of ["deg", "grad", "rad", "turn"]) {
    if (value.endsWith(unit) && isCssNumber(value.slice(0, -unit.length))) {
      return true;
    }
  }
  return false;
}
function isAlpha(value) {
  return isNumberOrPercentage(value);
}
function isCssNumber(value) {
  return CSS_NUMBER_PATTERN.test(value);
}
function isHueInterpolationMethod(parts) {
  if (!parts.length) return true;
  if (parts.length !== 2 || parts[1]?.toLowerCase() !== "hue") return false;
  return ["shorter", "longer", "increasing", "decreasing"].includes(
    parts[0]?.toLowerCase()
  );
}
function isColorStop(value) {
  if (getCssColor(value)) return true;
  const parts = splitWhitespace(value);
  const percentage = parts.at(-1);
  if (!percentage || !CSS_PERCENTAGE_PATTERN.test(percentage)) return false;
  const color = value.slice(0, value.lastIndexOf(percentage)).trim();
  return getCssColor(color) != null;
}
function splitTopLevelCommas(value) {
  const values = [];
  let currentValue = "";
  let parenthesisDepth = 0;
  for (const character of value) {
    if (character === "(") parenthesisDepth += 1;
    if (character === ")") parenthesisDepth -= 1;
    if (character === "," && parenthesisDepth === 0) {
      values.push(currentValue.trim());
      currentValue = "";
    } else {
      currentValue += character;
    }
  }
  if (parenthesisDepth !== 0) return [];
  values.push(currentValue.trim());
  return values;
}
function splitWhitespace(value) {
  const values = [];
  let currentValue = "";
  for (const character of value.trim()) {
    if (character.trim()) {
      currentValue += character;
    } else if (currentValue) {
      values.push(currentValue);
      currentValue = "";
    }
  }
  if (currentValue) values.push(currentValue);
  return values;
}

// ../../../../../../../Users/michaelnji/Projects/desktop-apps/teneo/shared/types/settings.ts
var defaultSettings = {
  pasteOnEnter: false,
  ignorePasswords: true,
  excludedApps: [],
  openPanelShortcut: "",
  historyDuration: "forever",
  maximumItems: 0,
  maximumStorage: 0
};
var openPanelHotkeyId = "open-panel";
var settingsChangedEvent = "settings-changed";
function pickSettings(value) {
  if (typeof value !== "object" || value === null) return {};
  const settings = {};
  for (const key of Object.keys(defaultSettings)) {
    const setting = value[key];
    const defaultSetting = defaultSettings[key];
    const isValid = Array.isArray(defaultSetting) ? Array.isArray(setting) && setting.every((entry) => typeof entry === "string") : typeof setting === typeof defaultSetting;
    if (isValid) settings[key] = setting;
  }
  return settings;
}

// ../../../../../../../Users/michaelnji/Projects/desktop-apps/teneo/backend/settings.ts
var settingsStoreKey = "settings";
var currentSettings = { ...defaultSettings };
async function loadSettings(app) {
  const storedSettings = await app.store.get(settingsStoreKey);
  currentSettings = { ...defaultSettings, ...pickSettings(storedSettings) };
}
function getSettings() {
  return currentSettings;
}
async function updateSettings(changes, app) {
  currentSettings = { ...currentSettings, ...pickSettings(changes) };
  await app.store.set(settingsStoreKey, currentSettings);
  app.push(settingsChangedEvent, currentSettings);
  return currentSettings;
}

// ../../../../../../../Users/michaelnji/Projects/desktop-apps/teneo/backend/excluded-apps.ts
var passwordManagerBundleIds = [
  "me.proton.pass.electron",
  // Proton Pass
  "com.apple.Passwords",
  "com.apple.keychainaccess",
  "com.1password.1password",
  "com.agilebits.onepassword7",
  "com.bitwarden.desktop",
  "org.keepassxc.keepassxc"
];
function isExcludedApp(bundleId) {
  return passwordManagerBundleIds.includes(bundleId) || getSettings().excludedApps.includes(bundleId);
}
async function listExcludedApps(requestedBundleIds, app) {
  const addedBundleIds = Array.isArray(requestedBundleIds) ? requestedBundleIds.filter(
    (bundleId) => typeof bundleId === "string" && isValidBundleId(bundleId)
  ) : [];
  const candidates = [
    ...passwordManagerBundleIds.map((bundleId) => ({
      bundleId,
      addedByUser: false
    })),
    ...addedBundleIds.map((bundleId) => ({ bundleId, addedByUser: true }))
  ];
  const excludedApps = await Promise.all(
    candidates.map(async ({ bundleId, addedByUser }) => {
      const appPath = await findAppPath(bundleId);
      if (!appPath && !addedByUser) return null;
      return {
        bundleId,
        addedByUser,
        name: appPath ? getAppName(appPath) : bundleId,
        iconUrl: await getAppIconUrl(bundleId, app)
      };
    })
  );
  return excludedApps.filter((excludedApp) => excludedApp !== null);
}
var chooseAppScript = [
  "activate",
  'POSIX path of (choose file with prompt "Choose an app to ignore" of type {"com.apple.application-bundle"} default location (path to applications folder))'
];
async function chooseAppToExclude(app) {
  const appPath = await runCommand([
    "/usr/bin/osascript",
    ...chooseAppScript.flatMap((line) => ["-e", line])
  ]);
  if (appPath) await excludeApp(appPath, app);
}
async function excludeApp(appPath, app) {
  appPath = appPath.replace(/\/$/, "");
  if (!appPath.endsWith(".app")) throw new Error("Choose an app to ignore");
  const bundleId = await readBundleId(appPath);
  if (!isValidBundleId(bundleId)) {
    throw new Error(`Couldn't read the app id of ${getAppName(appPath)}`);
  }
  if (isExcludedApp(bundleId)) return;
  await updateSettings(
    { excludedApps: [...getSettings().excludedApps, bundleId] },
    app
  );
}
function getAppName(appPath) {
  return (appPath.split("/").pop() ?? appPath).replace(/\.app$/, "");
}

// ../../../../../../../Users/michaelnji/Projects/desktop-apps/teneo/backend/utils/uuid-generator.ts
function generateUUID() {
  return crypto.randomUUID();
}

// ../../../../../../../Users/michaelnji/Projects/desktop-apps/teneo/backend/clipboard-history.ts
var imageFilePattern = /\.(png|jpe?g|gif|heic|webp|tiff?|bmp)$/i;
function isFromPasswordManager(item) {
  if (item.concealed) return true;
  const bundleId = item.sourceApp?.bundleId;
  return bundleId != null && isExcludedApp(bundleId);
}
async function readClipboardItem(app) {
  const item = await app.clipboard.read();
  if (item.kind === "empty") return null;
  if (getSettings().ignorePasswords && isFromPasswordManager(item)) return null;
  const bundleId = item.sourceApp?.bundleId;
  if (bundleId) {
    await saveAppIcon(bundleId, app).catch(
      (error) => logError(`saving icon for ${bundleId} failed:`, error)
    );
  }
  return saveClipboardImage(
    tempImageFileAsImage(normalizeClipboardColor(item), app),
    app
  );
}
function tempImageFileAsImage(item, app) {
  const [path] = item.paths;
  const isTempImageFile = item.kind === "files" && item.paths.length === 1 && item.image !== null && // the picture is on the clipboard too
  imageFilePattern.test(path) && isInTempFolder(path, app);
  if (!isTempImageFile) return item;
  return { ...item, kind: "image", image: path, paths: [], pasteAsFile: true };
}
function isInTempFolder(path, app) {
  const tempFolder = app.paths.temp.replace(/\/$/, "");
  return path.startsWith(`${tempFolder}/`) || path.startsWith(`/private${tempFolder}/`);
}
async function saveClipboardImage(item, app) {
  if (item.kind !== "image" || !item.image) return item;
  const fileName = item.pasteAsFile ? item.image.split("/").pop() : `${item.changeCount}.png`;
  const savedPath = `${await dataFolder(app, "images")}/${generateUUID()}-${fileName}`;
  await tjs.copyFile(item.image, savedPath);
  return { ...item, image: savedPath };
}

// ../../../../../../../Users/michaelnji/Projects/desktop-apps/teneo/backend/database.ts
import { Database } from "tjs:sqlite";

// ../../../../../../../Users/michaelnji/Projects/desktop-apps/teneo/shared/types/clipboard.ts
var clipboardHistoryChangedEvent = "clipboard-history-changed";

// ../../../../../../../Users/michaelnji/Projects/desktop-apps/teneo/backend/database.ts
var databasePromise = null;
function initializeDatabase(app) {
  databasePromise ??= openDatabase(app);
  return databasePromise;
}
async function openDatabase(app) {
  await tjs.makeDir(app.paths.data, { recursive: true });
  const database = new Database(`${app.paths.data}/teneo.sqlite`);
  run(
    database,
    `
      CREATE TABLE IF NOT EXISTS "CLIPBOARD_ITEMS" (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK(kind IN ('text', 'image', 'files', 'color')),
        imageSize TEXT,
        path TEXT,
        value TEXT,
        dateCopied INTEGER NOT NULL,
        sourceAppName TEXT,
        sourceAppBundleId TEXT,
        deletedAt INTEGER,
        pinnedAt INTEGER,
        pasteAsFile INTEGER
      )
    `
  );
  addMissingColumns(database);
  run(
    database,
    `
      CREATE INDEX IF NOT EXISTS clipboard_items_date_copied_index
      ON "CLIPBOARD_ITEMS" (dateCopied DESC)
    `
  );
  return database;
}
async function saveClipboardItem(item, app) {
  if (item.kind === "empty") {
    throw new Error("Cannot save an empty clipboard item");
  }
  const dateCopied = Date.now();
  const savedItem = {
    ...item,
    id: generateUUID(),
    dateCopied,
    pinned: false,
    pasteAsFile: item.pasteAsFile === true
  };
  run(
    await initializeDatabase(app),
    `
      INSERT INTO "CLIPBOARD_ITEMS" (
        id, kind, imageSize, path, value, dateCopied, sourceAppName, sourceAppBundleId, pasteAsFile
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    savedItem.id,
    savedItem.kind,
    serializeImageSize(savedItem),
    serializePath(savedItem, app),
    serializeValue(savedItem),
    savedItem.dateCopied,
    savedItem.sourceApp?.name ?? null,
    savedItem.sourceApp?.bundleId ?? null,
    savedItem.pasteAsFile ? 1 : null
  );
  notifyClipboardHistoryChanged(app);
  return savedItem;
}
var deletionCondition = `
  pinnedAt IS NULL AND (dateCopied < ? OR id NOT IN (
    SELECT id FROM "CLIPBOARD_ITEMS" WHERE pinnedAt IS NULL
    ORDER BY dateCopied DESC LIMIT ?
  ))
`;
async function countClipboardItemsToDelete(app, copiedBefore, keepNewest) {
  const [result] = all(
    await initializeDatabase(app),
    `
      SELECT COUNT(*) AS count FROM "CLIPBOARD_ITEMS"
      WHERE deletedAt IS NULL AND (${deletionCondition})
    `,
    copiedBefore,
    keepNewest
  );
  return result?.count ?? 0;
}
async function deleteClipboardItems(app, copiedBefore, keepNewest) {
  const database = await initializeDatabase(app);
  const deletedRows = all(
    database,
    `SELECT kind, path FROM "CLIPBOARD_ITEMS" WHERE ${deletionCondition}`,
    copiedBefore,
    keepNewest
  );
  if (deletedRows.length === 0) return;
  run(
    database,
    `DELETE FROM "CLIPBOARD_ITEMS" WHERE ${deletionCondition}`,
    copiedBefore,
    keepNewest
  );
  notifyClipboardHistoryChanged(app);
  for (const row of deletedRows) {
    const imagePath = row.kind === "image" ? restoreImagePath(row.path, app) : null;
    if (imagePath) {
      await tjs.remove(imagePath).catch(
        (error) => logError(`deleting ${imagePath} failed:`, error)
      );
    }
  }
}
async function softDeleteClipboardItem(id, app) {
  run(
    await initializeDatabase(app),
    `
      UPDATE "CLIPBOARD_ITEMS" SET deletedAt = ?, pinnedAt = NULL
      WHERE id = ? AND deletedAt IS NULL
    `,
    Date.now(),
    id
  );
  notifyClipboardHistoryChanged(app);
}
async function setClipboardItemPinned(id, pinned, app) {
  run(
    await initializeDatabase(app),
    `UPDATE "CLIPBOARD_ITEMS" SET pinnedAt = ? WHERE id = ? AND deletedAt IS NULL`,
    pinned ? Date.now() : null,
    id
  );
  notifyClipboardHistoryChanged(app);
}
async function listClipboardItemSizes(app) {
  const rows = all(
    await initializeDatabase(app),
    `
      SELECT kind, path, pinnedAt,
        ifnull(length(CAST(value AS BLOB)), 0) +
        ifnull(length(CAST(path AS BLOB)), 0) AS rowBytes
      FROM "CLIPBOARD_ITEMS"
      ORDER BY dateCopied DESC
    `
  );
  return Promise.all(
    rows.map(async (row) => {
      const imagePath = row.kind === "image" ? restoreImagePath(row.path, app) : null;
      const imageBytes = imagePath ? await tjs.stat(imagePath).then(
        (stat) => stat.size,
        () => 0
      ) : 0;
      return {
        kind: row.kind,
        bytes: row.rowBytes + imageBytes,
        pinned: row.pinnedAt != null
      };
    })
  );
}
async function countClipboardMedia(app) {
  const [counts] = all(
    await initializeDatabase(app),
    `
      SELECT
        COUNT(*) FILTER (WHERE kind = 'image') AS imageCount,
        SUM(CASE WHEN kind = 'files' THEN json_array_length(path) END) AS fileCount
      FROM "CLIPBOARD_ITEMS"
    `
  );
  return {
    imageCount: counts?.imageCount ?? 0,
    fileCount: counts?.fileCount ?? 0
  };
}
function notifyClipboardHistoryChanged(app) {
  app.push(clipboardHistoryChangedEvent);
}
async function listClipboardItems(app) {
  const rows = all(
    await initializeDatabase(app),
    `
      SELECT id, kind, imageSize, path, value, dateCopied, sourceAppName, sourceAppBundleId, pinnedAt, pasteAsFile
      FROM "CLIPBOARD_ITEMS"
      WHERE deletedAt IS NULL
      ORDER BY pinnedAt IS NULL, pinnedAt DESC, dateCopied DESC
    `
  );
  return rows.flatMap((row) => {
    const item = rowToClipboardItem(row, app);
    return item ? [item] : [];
  });
}
function serializeImageSize(item) {
  return item.kind === "image" && item.imageSize ? JSON.stringify(item.imageSize) : null;
}
function serializePath(item, app) {
  if (item.kind === "image") {
    if (!item.image) return null;
    const dataDirectory = `${app.paths.data}/`;
    if (!item.image.startsWith(dataDirectory)) {
      throw new Error(
        "Clipboard image was not saved to the app data directory"
      );
    }
    return item.image.slice(dataDirectory.length);
  }
  return item.kind === "files" ? JSON.stringify(item.paths) : null;
}
function serializeValue(item) {
  if (item.kind === "text") return item.text;
  if (item.kind === "color") return item.color;
  return null;
}
var addedColumns = {
  sourceAppName: "TEXT",
  sourceAppBundleId: "TEXT",
  deletedAt: "INTEGER",
  pinnedAt: "INTEGER",
  pasteAsFile: "INTEGER"
};
function addMissingColumns(database) {
  const columnNames = new Set(
    all(
      database,
      `PRAGMA table_info("CLIPBOARD_ITEMS")`
    ).map((column) => column.name)
  );
  for (const [name, type] of Object.entries(addedColumns)) {
    if (!columnNames.has(name)) {
      run(database, `ALTER TABLE "CLIPBOARD_ITEMS" ADD COLUMN ${name} ${type}`);
    }
  }
}
function rowToClipboardItem(row, app) {
  if (!isClipboardItemKind(row.kind) || !isValidDate(row.dateCopied)) {
    return null;
  }
  return {
    id: row.id,
    dateCopied: row.dateCopied,
    kind: row.kind,
    changeCount: row.dateCopied,
    text: row.kind === "text" ? row.value : null,
    html: null,
    paths: row.kind === "files" ? parsePaths(row.path) : [],
    image: row.kind === "image" ? restoreImagePath(row.path, app) : null,
    imageSize: row.kind === "image" ? parseImageSize(row.imageSize) : null,
    color: row.kind === "color" ? row.value : null,
    concealed: false,
    sourceApp: sourceAppFromRow(row),
    sourceURL: null,
    pinned: row.pinnedAt != null,
    pasteAsFile: row.kind === "image" && row.pasteAsFile === 1
  };
}
function sourceAppFromRow(row) {
  if (row.sourceAppName == null && row.sourceAppBundleId == null) return null;
  return {
    name: row.sourceAppName,
    bundleId: row.sourceAppBundleId
  };
}
function isClipboardItemKind(value) {
  return value === "text" || value === "image" || value === "files" || value === "color";
}
function isValidDate(value) {
  return Number.isFinite(value) && value > 0;
}
function restoreImagePath(path, app) {
  if (!path || path.startsWith("/") || path.includes("..")) return null;
  return `${app.paths.data}/${path}`;
}
function parsePaths(path) {
  if (!path) return [];
  try {
    const paths = JSON.parse(path);
    return Array.isArray(paths) && paths.every((item) => typeof item === "string") ? paths : [];
  } catch {
    return [];
  }
}
function parseImageSize(imageSize) {
  if (!imageSize) return null;
  try {
    const parsed = JSON.parse(imageSize);
    if (!parsed || typeof parsed !== "object") return null;
    const { width, height } = parsed;
    return typeof width === "number" && typeof height === "number" ? { width, height } : null;
  } catch {
    return null;
  }
}
function run(database, query, ...values) {
  const statement = database.prepare(query);
  try {
    statement.run(...values);
  } finally {
    statement.finalize();
  }
}
function all(database, query, ...values) {
  const statement = database.prepare(query);
  try {
    return statement.all(...values);
  } finally {
    statement.finalize();
  }
}

// ../../../../../../../Users/michaelnji/Projects/desktop-apps/teneo/backend/data-usage.ts
async function getDataFolderUsage(app) {
  const [size, itemSizes, counts] = await Promise.all([
    getFolderSize(app.paths.data),
    listClipboardItemSizes(app),
    countClipboardMedia(app)
  ]);
  const clipboardSizeByKind = { text: 0, image: 0, files: 0, color: 0 };
  for (const { kind, bytes, pinned } of itemSizes) {
    if (!pinned && kind in clipboardSizeByKind) {
      clipboardSizeByKind[kind] += bytes;
    }
  }
  return { size, clipboardSizeByKind, ...counts };
}
async function getFolderSize(folder) {
  let size = 0;
  let entries;
  try {
    entries = await tjs.readDir(folder);
  } catch {
    return 0;
  }
  for await (const entry of entries) {
    const path = `${folder}/${entry.name}`;
    size += entry.isDirectory ? await getFolderSize(path) : (
      // a file deleted mid-walk (e.g. by history trimming) counts as 0
      await tjs.stat(path).then(
        (stat) => stat.size,
        () => 0
      )
    );
  }
  return size;
}

// ../../../../../../../Users/michaelnji/Projects/desktop-apps/teneo/backend/file-previews.ts
var PREVIEW_SIZE = 64;
async function getFilePreview(path, app) {
  if (typeof path !== "string" || !path.startsWith("/")) return null;
  const stats = await tjs.stat(path).catch(() => null);
  if (!stats) return null;
  try {
    const thumbnail = await app.thumbnail(path, PREVIEW_SIZE);
    return {
      url: await pngDataUrl(thumbnail.path),
      size: stats.isDirectory ? null : stats.size
    };
  } catch (error) {
    logError(`filePreview failed for ${path}:`, error);
    return null;
  }
}

// ../../../../../../../Users/michaelnji/Projects/desktop-apps/teneo/backend/global-shortcut.ts
var SHORTCUT_PATTERN = /^[a-z0-9+]+$/;
var registeredShortcut = "";
var isPaused = false;
function syncOpenPanelShortcut(app) {
  const shortcut = isPaused ? "" : getSettings().openPanelShortcut;
  const validShortcut = SHORTCUT_PATTERN.test(shortcut) ? shortcut : "";
  if (validShortcut === registeredShortcut) return;
  if (registeredShortcut) app.hotkey.unregister(openPanelHotkeyId);
  if (validShortcut) app.hotkey.register(openPanelHotkeyId, validShortcut);
  registeredShortcut = validShortcut;
}
function pauseOpenPanelShortcut(paused, app) {
  isPaused = paused === true;
  syncOpenPanelShortcut(app);
}

// ../../../../../../../Users/michaelnji/Projects/desktop-apps/teneo/backend/history-limits.ts
var day = 24 * 60 * 60 * 1e3;
var historyDurations = {
  day,
  week: 7 * day,
  month: 30 * day,
  year: 365 * day,
  forever: null
};
var trimInterval = 60 * 60 * 1e3;
async function trimClipboardHistory(app) {
  const { copiedBefore, keepNewest } = await getTrimLimits(app, getSettings());
  await deleteClipboardItems(app, copiedBefore, keepNewest);
}
async function countItemsDeletedBy(changes, app) {
  const settings = { ...getSettings(), ...pickSettings(changes) };
  const { copiedBefore, keepNewest } = await getTrimLimits(app, settings);
  return countClipboardItemsToDelete(app, copiedBefore, keepNewest);
}
async function getTrimLimits(app, { historyDuration, maximumItems, maximumStorage }) {
  const keepFor = historyDurations[historyDuration] ?? null;
  const keepNewest = Math.min(
    maximumItems > 0 ? Math.floor(maximumItems) : Infinity,
    maximumStorage > 0 ? await countItemsWithinStorage(app, maximumStorage) : Infinity
  );
  return {
    copiedBefore: keepFor === null ? 0 : Date.now() - keepFor,
    keepNewest: Number.isFinite(keepNewest) ? keepNewest : -1
  };
}
async function countItemsWithinStorage(app, maximumStorage) {
  const itemSizes = await listClipboardItemSizes(app);
  let usedBytes = 0;
  let count = 0;
  for (const { bytes, pinned } of itemSizes) {
    if (pinned) continue;
    usedBytes += bytes;
    if (usedBytes > maximumStorage) break;
    count += 1;
  }
  return Math.max(count, 1);
}
function clearClipboardHistory(app) {
  return deleteClipboardItems(app, 0, 0);
}
function startTrimmingClipboardHistory(app) {
  const trim = () => trimClipboardHistory(app).catch(
    (error) => logError("trimming clipboard history failed:", error)
  );
  void trim();
  setInterval(trim, trimInterval);
}

// ../../../../../../../Users/michaelnji/Projects/desktop-apps/teneo/shared/types/windows.ts
var showPanelEvent = "show-panel";
var updateProgressEvent = "update-progress";

// ../../../../../../../Users/michaelnji/Projects/desktop-apps/teneo/backend/windows.ts
var settingsWindowId = "settings";
var setupWindowId = "setup";
var updateWindowId = "update";
var dockWindowIds = [settingsWindowId, setupWindowId];
var windowChrome = {
  frame: false,
  windowControls: true,
  transparent: true,
  vibrancy: "popover"
};
async function isWindowOpen(app, windowId) {
  return (await app.windows()).includes(windowId);
}
async function isWindowOnScreen(app, windowId) {
  if (!await isWindowOpen(app, windowId)) return false;
  const state = await app.window(windowId).getState();
  return Boolean(state?.visible && !state.minimized);
}
async function waitForFocusToLeave(app, teneoProcessId) {
  const deadline = Date.now() + 500;
  while (Date.now() < deadline && (await app.frontmostApp())?.pid === teneoProcessId) {
    await new Promise((resolve) => setTimeout(resolve, 16));
  }
}
async function hidePanel(app) {
  const panel = app.window("main");
  const isOnScreen = await Promise.all(
    dockWindowIds.map((windowId) => isWindowOnScreen(app, windowId))
  );
  const windowIdsToKeep = dockWindowIds.filter((_, index) => isOnScreen[index]);
  const teneoProcessId = windowIdsToKeep.length ? (await app.frontmostApp())?.pid : void 0;
  panel.hide({ app: false });
  panel.hide();
  if (!windowIdsToKeep.length) return;
  await waitForFocusToLeave(app, teneoProcessId);
  for (const windowId of windowIdsToKeep) {
    app.window(windowId).show({ activate: false });
  }
}
function showInDock(app) {
  app.presence("normal");
  if (tjs.env.TINYJS_ICON) app.icon(tjs.env.TINYJS_ICON);
}
async function leaveDockUnlessWindowOpen(app, closedWindowId) {
  const openWindowIds = await app.windows();
  const isOtherWindowOpen = dockWindowIds.some(
    (windowId) => windowId !== closedWindowId && openWindowIds.includes(windowId)
  );
  if (isOtherWindowOpen) return false;
  app.presence("menubar");
  return true;
}
async function openSettingsWindow(app) {
  app.window("main").hide({ app: false });
  showInDock(app);
  if (await isWindowOpen(app, settingsWindowId)) {
    app.window(settingsWindowId).show();
    return;
  }
  app.openWindow(settingsWindowId, {
    page: "settings.html",
    title: "Settings",
    size: "820x520",
    chrome: windowChrome
  });
}
async function openSetupWindow(app) {
  showInDock(app);
  if (!await isWindowOpen(app, setupWindowId)) {
    app.openWindow(setupWindowId, {
      page: "setup.html",
      title: "Welcome to Teneo",
      size: "560x560",
      chrome: windowChrome
    });
  }
  app.window(setupWindowId).show();
}
var availableUpdate = null;
function getAvailableUpdate() {
  return availableUpdate;
}
async function openUpdateWindow(update, app) {
  availableUpdate = update;
  if (!await isWindowOpen(app, updateWindowId)) {
    app.openWindow(updateWindowId, {
      page: "update.html",
      title: `Teneo ${update.latest} is available`,
      size: "480x460",
      chrome: { ...windowChrome, windowControls: false }
    });
    app.window(updateWindowId).setLevel("floating");
    app.window(updateWindowId).setAllSpaces(true);
  }
  app.window(updateWindowId).show();
}
async function closeUpdateWindow(app) {
  app.window(updateWindowId).close();
  const isOnScreen = await Promise.all(
    dockWindowIds.map((windowId) => isWindowOnScreen(app, windowId))
  );
  if (!isOnScreen.includes(true)) app.window("main").hide();
}
async function closeSetupWindow(app) {
  const teneoProcessId = (await app.frontmostApp())?.pid;
  app.window(setupWindowId).close();
  if (await leaveDockUnlessWindowOpen(app, setupWindowId)) {
    await waitForFocusToLeave(app, teneoProcessId);
  }
}
function isSameRect(rect, other) {
  return rect?.x === other?.x && rect?.y === other?.y && rect?.width === other?.width && rect?.height === other?.height;
}
async function waitForTrayToSettle(app) {
  const deadline = Date.now() + 2e3;
  let previousRect = null;
  while (Date.now() < deadline) {
    const rect = await app.tray.position();
    if (rect && rect.height > 0 && isSameRect(rect, previousRect)) return true;
    previousRect = rect;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}
async function showPanel(app) {
  if (!await waitForTrayToSettle(app)) return;
  app.window("main").push(showPanelEvent);
}
async function handleWindowClosed(windowId, app) {
  if (dockWindowIds.includes(windowId)) {
    await leaveDockUnlessWindowOpen(app, windowId);
  }
}

// ../../../../../../../Users/michaelnji/Projects/desktop-apps/teneo/backend/setup.ts
var setupCompleteStoreKey = "setupComplete";
async function isSetupComplete(app) {
  return Boolean(await app.store.get(setupCompleteStoreKey));
}
function showInMenuBar(app) {
  app.tray.set({ icon: `${app.paths.resources}/tray.png` });
  syncOpenPanelShortcut(app);
}
async function showMenuBarOrSetup(app) {
  if (await isSetupComplete(app)) showInMenuBar(app);
  else await openSetupWindow(app);
}
async function finishSetup(app) {
  const isInMenuBar = await isSetupComplete(app);
  await app.store.set(setupCompleteStoreKey, true);
  await closeSetupWindow(app);
  if (!isInMenuBar) showInMenuBar(app);
  await showPanel(app);
}
async function quitIfSetupClosedEarly(windowId, app) {
  if (windowId === setupWindowId && !await isSetupComplete(app)) app.quit();
}

// ../../../../../../../Users/michaelnji/Projects/desktop-apps/teneo/backend/updates.ts
var progressIntervalMs = 100;
function sendProgress(progress, app) {
  app.window(updateWindowId).push(updateProgressEvent, progress);
}
function trackDownload(response, app) {
  const total = Number(response.headers.get("content-length")) || null;
  let received = 0;
  let lastSentAt = 0;
  const countedBody = response.body.pipeThrough(
    new TransformStream({
      transform(chunk, controller) {
        received += chunk.byteLength;
        if (Date.now() - lastSentAt >= progressIntervalMs) {
          lastSentAt = Date.now();
          sendProgress({ received, total }, app);
        }
        controller.enqueue(chunk);
      },
      // Everything has arrived, so the size is known even without a header
      flush() {
        sendProgress({ received, total: received }, app);
      }
    })
  );
  response.arrayBuffer = () => new Response(countedBody).arrayBuffer();
}
async function installUpdate(app) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init2) => {
    const response = await originalFetch(input, init2);
    if (String(input).endsWith(".zip") && response.body) {
      trackDownload(response, app);
    }
    return response;
  };
  try {
    await app.update.install();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

// ../../../../../../../Users/michaelnji/Projects/desktop-apps/teneo/backend/main.ts
var api = {
  appIcon: ({ bundleId }, app) => getAppIconUrl(bundleId, app),
  clipboardItems: (_parameters, app) => listClipboardItems(app),
  deleteClipboardItem: ({ id }, app) => softDeleteClipboardItem(id, app),
  pinClipboardItem: ({ id, pinned }, app) => setClipboardItemPinned(id, pinned === true, app),
  chooseAppToExclude: (_parameters, app) => chooseAppToExclude(app),
  excludedApps: ({ addedBundleIds }, app) => listExcludedApps(addedBundleIds, app),
  filePreview: ({ path }, app) => getFilePreview(path, app),
  hidePanel: (_parameters, app) => hidePanel(app),
  openSettings: (_parameters, app) => openSettingsWindow(app),
  finishSetup: (_parameters, app) => finishSetup(app),
  openSetup: (_parameters, app) => openSetupWindow(app),
  openUpdate: (update, app) => openUpdateWindow(update, app),
  availableUpdate: () => getAvailableUpdate(),
  closeUpdate: (_parameters, app) => closeUpdateWindow(app),
  installUpdate: (_parameters, app) => installUpdate(app),
  pauseOpenPanelShortcut: ({ paused }, app) => pauseOpenPanelShortcut(paused, app),
  settings: () => getSettings(),
  updateSettings: async (changes, app) => {
    const settings = await updateSettings(changes, app);
    syncOpenPanelShortcut(app);
    await trimClipboardHistory(app);
    return settings;
  },
  clearHistory: (_parameters, app) => clearClipboardHistory(app),
  countItemsDeletedBy: ({ changes }, app) => countItemsDeletedBy(changes, app),
  dataFolderUsage: (_parameters, app) => getDataFolderUsage(app)
};
async function onClipboardChange({ self }, app) {
  if (self) return;
  const item = await readClipboardItem(app);
  if (!item) return;
  await saveClipboardItem(item, app);
  await trimClipboardHistory(app);
}
function onWindowClosed(windowId, app) {
  void handleWindowClosed(windowId, app);
  void quitIfSetupClosedEarly(windowId, app);
  pauseOpenPanelShortcut(false, app);
}
async function init(app) {
  await loadSettings(app);
  await initializeDatabase(app);
  startTrimmingClipboardHistory(app);
  app.setHideOnClose(true);
  app.setAllSpaces(true);
  await showMenuBarOrSetup(app);
  await previewUpdateWindow(app);
}
async function previewUpdateWindow(app) {
  const notesPath = tjs.env.TENEO_PREVIEW_UPDATE;
  if (!notesPath) return;
  const notes = new TextDecoder().decode(await tjs.readFile(notesPath));
  await openUpdateWindow(
    { current: app.info.version, latest: "9.9.9", notes },
    app
  );
}
export {
  api,
  init,
  onClipboardChange,
  onWindowClosed
};
