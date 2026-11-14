// Windows are transparent vibrancy panels, so the OS decides light/dark;
// mirror it onto shadcn's opt-in `.dark` class.
export function syncThemeWithSystem(): void {
  const prefersDark = matchMedia("(prefers-color-scheme: dark)");
  const syncTheme = () =>
    document.documentElement.classList.toggle("dark", prefersDark.matches);
  syncTheme();
  prefersDark.addEventListener("change", syncTheme);
}
