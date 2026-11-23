/** Never fall back to the interactive TinyJS getter on a background path. */
export function readKeychain(
  app: TinyApp,
  account: string,
  interactive: boolean,
): Promise<string | null> {
  const secrets = app.secrets as TinyApp["secrets"] & {
    getWithoutPrompt?(key: string): Promise<string | null>;
  };
  if (interactive) return secrets.get(account);
  if (!secrets.getWithoutPrompt)
    return Promise.reject(new Error("Noninteractive Keychain is unavailable"));
  return secrets.getWithoutPrompt(account);
}
