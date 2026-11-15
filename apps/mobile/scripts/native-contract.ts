// Runs the client contract (src/client/client-contract.ts) against the
// phone's native history: in the app's web view, through Chrome's debugging
// protocol over adb. The app has to be a debug build loading the Vite dev
// server, as `bun run mobile:android:dev` installs it, with `bun run mobile`
// serving. Tests use a throwaway database, never the app's history.
//
//   bun apps/mobile/scripts/native-contract.ts
/* oxlint-disable no-console -- a command-line script reports on the console */
import { $ } from "bun";

const appId = "com.michael.teneo";
const port = 9333;

const pid = (await $`adb shell pidof ${appId}`.nothrow().text()).trim();
if (!pid) {
  console.error(`${appId} isn't running: start it first`);
  process.exit(1);
}
await $`adb forward tcp:${port} localabstract:webview_devtools_remote_${pid}`.quiet();

try {
  const pages = (await (
    await fetch(`http://127.0.0.1:${port}/json`)
  ).json()) as { type: string; url: string; webSocketDebuggerUrl: string }[];
  const page = pages.find(
    (p) => p.type === "page" && p.url.startsWith("http://localhost:5175"),
  );
  if (!page) {
    throw new Error(
      `No web view loads the dev server; found ${pages.map((p) => p.url).join(", ") || "none"}`,
    );
  }

  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  const answer = new Promise<string>((resolve, reject) => {
    socket.onmessage = (message) => {
      const reply = JSON.parse(String(message.data)) as {
        id?: number;
        result?: {
          result?: { value?: string };
          exceptionDetails?: { text: string };
        };
      };
      if (reply.id !== 1) return;
      const value = reply.result?.result?.value;
      if (typeof value === "string") resolve(value);
      else
        reject(
          new Error(
            reply.result?.exceptionDetails?.text ?? JSON.stringify(reply),
          ),
        );
    };
  });
  socket.send(
    JSON.stringify({
      id: 1,
      method: "Runtime.evaluate",
      params: {
        expression: `import("/src/client/run-native-contract.ts").then((m) => m.runNativeContract()).then(JSON.stringify)`,
        awaitPromise: true,
        returnByValue: true,
      },
    }),
  );
  const outcomes = JSON.parse(await answer) as {
    name: string;
    error?: string;
  }[];
  socket.close();

  for (const { name, error } of outcomes) {
    console.log(error ? `(fail) ${name}\n       ${error}` : `(pass) ${name}`);
  }
  const failed = outcomes.filter((outcome) => outcome.error).length;
  console.log(`\n${outcomes.length - failed} pass, ${failed} fail`);
  process.exitCode = failed > 0 ? 1 : 0;
} finally {
  await $`adb forward --remove tcp:${port}`.quiet().nothrow();
}
