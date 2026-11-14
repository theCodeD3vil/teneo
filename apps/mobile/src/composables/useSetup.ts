const setupDoneKey = "teneo.setupDone";

/** Whether first-run setup was finished or skipped on this phone. */
export function isSetupDone(): boolean {
  return localStorage.getItem(setupDoneKey) === "true";
}

export function markSetupDone(): void {
  localStorage.setItem(setupDoneKey, "true");
}
