import { describe, expect, test } from "bun:test";

import { redactText, scrubBreadcrumb, scrubEvent } from "./sentry-scrub";

describe("redactText", () => {
  test("hides quoted text and URLs", () => {
    expect(
      redactText(`Unexpected token 'h', "hello secret" is not valid JSON`),
    ).toBe("Unexpected token [redacted], [redacted] is not valid JSON");
    expect(redactText("failed to fetch https://example.com/a?b=c")).toBe(
      "failed to fetch [redacted]",
    );
  });

  test("keeps plain messages", () => {
    expect(redactText("Cannot read properties of undefined")).toBe(
      "Cannot read properties of undefined",
    );
  });
});

describe("scrubEvent", () => {
  test("redacts messages, drops extras and network breadcrumbs", () => {
    const event = scrubEvent({
      message: 'copied "my password"',
      exception: { values: [{ value: "bad 'token'" }] },
      extra: { item: "secret" },
      request: { url: "app://x", query_string: "q=1", data: "body" },
      breadcrumbs: [
        { category: "console", message: "secret" },
        { category: "fetch", data: { url: "https://x" } },
        { category: "ui.click", message: "button 'copy'", data: { a: 1 } },
      ],
    });
    expect(event.message).toBe("copied [redacted]");
    expect(event.exception?.values?.[0]?.value).toBe("bad [redacted]");
    expect(event.extra).toBeUndefined();
    expect(event.request).toEqual({ url: "app://x", headers: {} });
    expect(event.breadcrumbs).toEqual([
      { category: "ui.click", message: "button [redacted]" },
    ]);
  });
});

describe("what the audit found reaching Sentry", () => {
  test("drops the props @sentry/vue attaches, keeping the device and trace", () => {
    const event = scrubEvent({
      contexts: {
        vue: {
          componentName: "ClipboardItemCard",
          propsData: { item: { text: "my copied password" } },
        },
        state: { clipboard: "x" },
        os: { name: "macOS" },
        trace: { trace_id: "a" },
      },
    });
    expect(event.contexts).toEqual({
      os: { name: "macOS" },
      trace: { trace_id: "a" },
    });
  });

  test("hides unquoted keys, paths and email addresses", () => {
    expect(
      redactText("Invalid token sk-proj-abcdefghijklmnopqrstuvwxyz123"),
    ).toBe("Invalid token sk-proj-[redacted]");
    expect(
      redactText("ENOENT: no such file, open /Users/alice/secret-project.pdf"),
    ).toBe("ENOENT: no such file, open [redacted]");
    expect(redactText("sent to alice@example.com")).toBe("sent to [redacted]");
  });

  test("cleans the page address, headers, frames' variables and home folders", () => {
    const event = scrubEvent({
      transaction: "/Users/alice/Applications/Teneo.app/index.html",
      request: {
        url: "file:///Users/alice/Applications/Teneo.app/index.html?x=1",
        headers: {
          "User-Agent": "Mozilla/5.0",
          Referer: "file:///Users/alice/x",
        },
      },
      exception: {
        values: [
          {
            value: "boom",
            stacktrace: {
              frames: [
                {
                  abs_path: "file:///Users/alice/Applications/Teneo.app/a.js",
                  vars: { text: "copied" },
                },
              ],
            },
          },
        ],
      },
    });
    expect(event.transaction).toBe(
      "/Users/~/Applications/Teneo.app/index.html",
    );
    expect(event.request).toEqual({
      url: "file:///Users/~/Applications/Teneo.app/index.html",
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    expect(event.exception?.values?.[0]?.stacktrace?.frames).toEqual([
      { abs_path: "file:///Users/~/Applications/Teneo.app/a.js" },
    ]);
  });

  test("redacts the links a transaction's spans fetched", () => {
    const event = scrubEvent({
      spans: [
        {
          description: "GET https://bank.example/reset?token=abc",
          data: {
            url: "https://bank.example/reset?token=abc",
            "http.method": "GET",
          },
        },
      ],
    });
    expect(event.spans).toEqual([
      {
        description: "GET [redacted]",
        data: { url: "[redacted]", "http.method": "GET" },
      },
    ]);
  });
});

test("scrubBreadcrumb drops console output", () => {
  expect(scrubBreadcrumb({ category: "console", message: "x" })).toBeNull();
});
