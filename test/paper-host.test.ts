import assert from "node:assert/strict";
import test from "node:test";
import { runPandoc } from "../src/modules/markdown/paper/host.ts";

// Gecko's real pipe API returns an empty string at EOF, not null (Node's convention).
test("Gecko Pandoc execution completes at empty-string EOF and uses exact argument vectors", async (t) => {
  const prior = Object.getOwnPropertyDescriptor(globalThis, "ChromeUtils");
  t.after(() =>
    prior
      ? Object.defineProperty(globalThis, "ChromeUtils", prior)
      : Reflect.deleteProperty(globalThis, "ChromeUtils"),
  );
  let received: unknown;
  let kills = 0;
  let waits = 0;
  const chunks = ["A diagnostic", ""];
  Object.defineProperty(globalThis, "ChromeUtils", {
    configurable: true,
    value: {
      importESModule: () => ({
        Subprocess: {
          call: async (options: unknown) => {
            received = options;
            return {
              stdin: { close() {} },
              stdout: { readString: async () => chunks.shift() ?? "" },
              kill() {
                kills++;
              },
              wait: async () => {
                waits++;
                return { exitCode: 0 };
              },
            };
          },
        },
      }),
    },
  });
  const controller = new AbortController();
  await runPandoc(
    "/Program Files/pandoc.exe",
    ["--output", "/drafts/$(echo untouched).docx"],
    "/temporary directory",
    controller.signal,
  );
  assert.deepEqual(received, {
    command: "/Program Files/pandoc.exe",
    arguments: ["--output", "/drafts/$(echo untouched).docx"],
    workdir: "/temporary directory",
    stderr: "stdout",
  });
  assert.equal(waits, 1);
  controller.abort();
  assert.equal(kills, 0, "completed jobs release their abort listener");
});

test("closing an active export kills and reaps its Pandoc process", async (t) => {
  const prior = Object.getOwnPropertyDescriptor(globalThis, "ChromeUtils");
  t.after(() =>
    prior
      ? Object.defineProperty(globalThis, "ChromeUtils", prior)
      : Reflect.deleteProperty(globalThis, "ChromeUtils"),
  );
  const reading = Promise.withResolvers<void>();
  const eof = Promise.withResolvers<string>();
  let kills = 0;
  let waits = 0;
  Object.defineProperty(globalThis, "ChromeUtils", {
    configurable: true,
    value: {
      importESModule: () => ({
        Subprocess: {
          call: async () => ({
            stdin: { close() {} },
            stdout: {
              readString: () => {
                reading.resolve();
                return eof.promise;
              },
            },
            kill() {
              kills++;
              eof.resolve("");
            },
            wait: async () => {
              waits++;
              return { exitCode: -9 };
            },
          }),
        },
      }),
    },
  });
  const controller = new AbortController();
  const result = runPandoc("/pandoc", [], "/job", controller.signal);
  await reading.promise;
  controller.abort();
  await assert.rejects(result, { name: "AbortError" });
  assert.equal(kills, 1);
  assert.equal(waits, 1);
});
