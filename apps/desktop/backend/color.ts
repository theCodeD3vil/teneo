const cssNumber = /[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.source;

const CSS_NUMBER_PATTERN = new RegExp(`^${cssNumber}$`);
const CSS_PERCENTAGE_PATTERN = new RegExp(`^${cssNumber}%$`);
const CSS_HEX_COLOR_PATTERN = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const CSS_COLOR_FUNCTION_PATTERN =
  /^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|device-cmyk)\([^)]+\)$/i;
const CSS_COMPOSITE_COLOR_FUNCTION_PATTERN =
  /^(?:color-mix|light-dark)\(.+\)$/i;
const CSS_IDENTIFIER_PATTERN = /^[a-z]+$/i;
const CSS_NAMED_COLORS = new Set(
  "aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen transparent".split(
    " ",
  ),
);
const CSS_SYSTEM_COLORS = new Set(
  "accentcolor accentcolortext activetext buttonborder buttonface buttontext canvas canvastext field fieldtext graytext highlight highlighttext linktext mark marktext selecteditem selecteditemtext visitedtext".split(
    " ",
  ),
);
const CSS_COLOR_SPACES = new Set(
  "srgb srgb-linear display-p3 a98-rgb prophoto-rgb rec2020 xyz xyz-d50 xyz-d65".split(
    " ",
  ),
);
const CSS_COLOR_MIX_SPACES = new Set([
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
  "oklch",
]);

interface ColorFunctionArguments {
  values: string[];
  alpha: string | null;
  usesCommas: boolean;
}

/** Returns a canonical CSS color when a clipboard text value is exactly one. */
export function getCssColor(value: string | null): string | null {
  const color = value?.trim();
  if (!color) return null;

  if (CSS_HEX_COLOR_PATTERN.test(color)) return color;

  if (CSS_IDENTIFIER_PATTERN.test(color)) {
    const keyword = color.toLowerCase();
    return CSS_NAMED_COLORS.has(keyword) || CSS_SYSTEM_COLORS.has(keyword)
      ? color
      : null;
  }

  if (CSS_COLOR_FUNCTION_PATTERN.test(color)) {
    return isCssColorFunction(color) ? color : null;
  }

  if (CSS_COMPOSITE_COLOR_FUNCTION_PATTERN.test(color)) {
    return isCompositeCssColorFunction(color) ? color : null;
  }

  return null;
}

/** Converts plain-text color clipboard data into TinyJS's existing color shape. */
export function normalizeClipboardColor(
  item: TinyClipboardData,
): TinyClipboardData {
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
    color,
  };
}

function isCssColorFunction(color: string): boolean {
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
      return hasColorComponents(arguments_, 3, (value, index) =>
        index === 0 ? isHue(value) : isPercentage(value),
      );
    case "hwb":
      return (
        !arguments_.usesCommas &&
        hasColorComponents(arguments_, 3, (value, index) =>
          index === 0 ? isHue(value) : isPercentage(value),
        )
      );
    case "lab":
    case "oklab":
      return (
        !arguments_.usesCommas &&
        hasColorComponents(arguments_, 3, isNumberOrPercentage)
      );
    case "lch":
    case "oklch":
      return (
        !arguments_.usesCommas &&
        hasColorComponents(arguments_, 3, (value, index) =>
          index === 2 ? isHue(value) : isNumberOrPercentage(value),
        )
      );
    case "color":
      return !arguments_.usesCommas && hasColorSpaceComponents(arguments_);
    case "device-cmyk":
      return (
        !arguments_.usesCommas &&
        hasColorComponents(arguments_, 4, isNumberOrPercentage)
      );
    default:
      return false;
  }
}

function isCompositeCssColorFunction(color: string): boolean {
  const openingParenthesis = color.indexOf("(");
  const name = color.slice(0, openingParenthesis).toLowerCase();
  const body = color.slice(openingParenthesis + 1, -1);

  if (name === "light-dark") {
    const colors = splitTopLevelCommas(body);
    return (
      colors.length === 2 && colors.every((value) => getCssColor(value) != null)
    );
  }

  const [interpolation, ...stops] = splitTopLevelCommas(body);
  if (stops.length !== 2 || !interpolation) return false;

  const interpolationParts = splitWhitespace(interpolation);
  if (
    interpolationParts[0]?.toLowerCase() !== "in" ||
    !CSS_COLOR_MIX_SPACES.has(interpolationParts[1]?.toLowerCase()) ||
    !isHueInterpolationMethod(interpolationParts.slice(2))
  ) {
    return false;
  }

  return stops.every(isColorStop);
}

function parseColorFunctionArguments(
  value: string,
): ColorFunctionArguments | null {
  const slashParts = value.split("/");
  if (slashParts.length > 2) return null;

  const mainValue = slashParts[0].trim();
  const alpha = slashParts[1]?.trim() || null;
  const usesCommas = mainValue.includes(",");
  if (usesCommas && slashParts.length > 1) return null;

  const values = usesCommas
    ? mainValue.split(",").map((component) => component.trim())
    : splitWhitespace(mainValue);
  if (!values.length || values.some((component) => !component)) return null;

  return { values, alpha, usesCommas };
}

function hasColorComponents(
  arguments_: ColorFunctionArguments,
  count: number,
  validateComponent: (value: string, index: number) => boolean,
): boolean {
  const { values, usesCommas } = arguments_;
  const hasLegacyAlpha = usesCommas && values.length === count + 1;
  if (values.length !== count && !hasLegacyAlpha) return false;

  const components = values.slice(0, count);
  const alpha = hasLegacyAlpha ? values[count] : arguments_.alpha;
  return (
    components.every(validateComponent) && (alpha == null || isAlpha(alpha))
  );
}

function hasColorSpaceComponents(arguments_: ColorFunctionArguments): boolean {
  const [colorSpace, ...components] = arguments_.values;
  return (
    CSS_COLOR_SPACES.has(colorSpace.toLowerCase()) &&
    components.length === 3 &&
    components.every(isNumberOrPercentage) &&
    (arguments_.alpha == null || isAlpha(arguments_.alpha))
  );
}

function isNumberOrPercentage(value: string): boolean {
  return value === "none" || isCssNumber(value) || isPercentage(value);
}

function isPercentage(value: string): boolean {
  return value === "none" || CSS_PERCENTAGE_PATTERN.test(value);
}

function isHue(value: string): boolean {
  if (value === "none" || isCssNumber(value)) return true;

  for (const unit of ["deg", "grad", "rad", "turn"]) {
    if (value.endsWith(unit) && isCssNumber(value.slice(0, -unit.length))) {
      return true;
    }
  }
  return false;
}

function isAlpha(value: string): boolean {
  return isNumberOrPercentage(value);
}

function isCssNumber(value: string): boolean {
  return CSS_NUMBER_PATTERN.test(value);
}

function isHueInterpolationMethod(parts: string[]): boolean {
  if (!parts.length) return true;
  if (parts.length !== 2 || parts[1]?.toLowerCase() !== "hue") return false;

  return ["shorter", "longer", "increasing", "decreasing"].includes(
    parts[0]?.toLowerCase(),
  );
}

function isColorStop(value: string): boolean {
  if (getCssColor(value)) return true;

  const parts = splitWhitespace(value);
  const percentage = parts.at(-1);
  if (!percentage || !CSS_PERCENTAGE_PATTERN.test(percentage)) return false;

  const color = value.slice(0, value.lastIndexOf(percentage)).trim();
  return getCssColor(color) != null;
}

function splitTopLevelCommas(value: string): string[] {
  const values: string[] = [];
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

function splitWhitespace(value: string): string[] {
  const values: string[] = [];
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
