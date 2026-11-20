import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";

import { curlArguments, parseHeaders } from "./pinned-fetch";

const options = {
  accept: "text/html",
  userAgent: "Teneo test",
  timeoutMs: 5000,
};

describe("curlArguments", () => {
  test("pins the name to the checked address and follows no redirect", () => {
    const args = curlArguments(
      new URL("https://user:pass@example.com/a?b=c"),
      "93.184.216.34",
      options,
    );
    expect(args).toContain("--resolve");
    expect(args[args.indexOf("--resolve") + 1]).toBe(
      "example.com:443:93.184.216.34",
    );
    expect(args[args.indexOf("--max-redirs") + 1]).toBe("0");
    expect(args[args.indexOf("--noproxy") + 1]).toBe("*");
    expect(args[args.indexOf("--proto") + 1]).toBe("=http,https");
    // credentials in a link are never sent
    expect(args.at(-1)).toBe("https://example.com/a?b=c");
  });

  test("brackets an IPv6 address, and pins nothing for an address", () => {
    const args = curlArguments(
      new URL("http://example.com:8080/"),
      "2606:2800:220:1::1",
      options,
    );
    expect(args[args.indexOf("--resolve") + 1]).toBe(
      "example.com:8080:[2606:2800:220:1::1]",
    );
    expect(
      curlArguments(new URL("http://93.184.216.34/"), "93.184.216.34", options),
    ).not.toContain("--resolve");
  });
});

test("parseHeaders reads the last response's status and fields", () => {
  const { status, headers } = parseHeaders(
    "HTTP/1.1 100 Continue\r\n\r\nHTTP/2 301\r\nLocation: https://x.example/\r\ncontent-type: text/html\r\n\r\ncurl: (28) whatever",
  );
  expect(status).toBe(301);
  expect(headers.get("location")).toBe("https://x.example/");
  expect(headers.get("content-type")).toBe("text/html");
});

// The arguments as macOS's curl takes them: a name no DNS knows reaches the
// pinned address, which is the whole point
describe.skipIf(!existsSync("/usr/bin/curl"))("with the real curl", () => {
  let server: ReturnType<typeof Bun.serve>;
  beforeAll(() => {
    server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request) =>
        new URL(request.url).pathname === "/away"
          ? Response.redirect("http://elsewhere.invalid/", 302)
          : new Response(`<title>${request.headers.get("host")}</title>`, {
              headers: { "content-type": "text/html" },
            }),
    });
  });
  afterAll(() => server.stop(true));

  const run = async (path: string) => {
    const args = curlArguments(
      new URL(`http://rebind.invalid:${server.port}${path}`),
      "127.0.0.1",
      options,
    );
    const child = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
    const [body, dump] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    await child.exited;
    return { body, ...parseHeaders(dump) };
  };

  test("connects to the pinned address, sending the site's own name", async () => {
    const { status, headers, body } = await run("/");
    expect(status).toBe(200);
    expect(headers.get("content-type")).toBe("text/html");
    expect(body).toBe(`<title>rebind.invalid:${server.port}</title>`);
  });

  test("hands a redirect back instead of following it", async () => {
    const { status, headers } = await run("/away");
    expect(status).toBe(302);
    expect(headers.get("location")).toBe("http://elsewhere.invalid/");
  });
});
