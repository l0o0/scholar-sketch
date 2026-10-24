import { spawn } from "node:child_process";
import console from "node:console";
import process from "node:process";
import { collectTests, resolveTestSuites, testSuites } from "./test-suites.mjs";

try {
  const [name, ...extra] = process.argv.slice(2);
  if (extra.length || testSuites[name]?.runtime !== "node") {
    throw new Error("Usage: node scripts/test-runner.mjs <unit|fake>");
  }
  if (name === "unit") {
    let database;
    try {
      const { DatabaseSync } = await import("node:sqlite");
      database = new DatabaseSync(":memory:");
      database.prepare("SELECT 1").columns();
      database.exec(
        "CREATE VIRTUAL TABLE probe USING fts5(body, tokenize='trigram case_sensitive 1')",
      );
    } catch (error) {
      throw new Error(
        `Unit tests require Node.js >=22.16.0 with SQLite columns() and FTS5/trigram support; current ${process.version}: ${error.message}`,
        { cause: error },
      );
    } finally {
      database?.close();
    }
  }
  const files = resolveTestSuites(collectTests())[name];
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "--test", "--test-concurrency=4", ...files],
    { stdio: "inherit" },
  );
  let interrupted;
  const handlers = new Map(
    ["SIGINT", "SIGTERM"].map((signal) => [
      signal,
      () => {
        interrupted = signal;
        child.kill(signal);
      },
    ]),
  );
  for (const [signal, handler] of handlers) process.on(signal, handler);
  try {
    const result = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({ code, signal }));
    });
    // Node's test runner may report exit 0 after an interrupt. Cancellation is
    // still a failed local check, so `verify` must not continue to fake/build.
    if (interrupted || result.signal) {
      const signal = interrupted ?? result.signal;
      console.error(`Test run interrupted by ${signal}`);
      process.exitCode = signal === "SIGINT" ? 130 : 143;
    } else process.exitCode = result.code ?? 1;
  } finally {
    for (const [signal, handler] of handlers) process.off(signal, handler);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
