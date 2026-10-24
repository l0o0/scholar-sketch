import console from "node:console";
import process from "node:process";
import { collectTests, resolveTestSuites } from "./test-suites.mjs";

try {
  const suites = resolveTestSuites(collectTests());
  for (const [name, files] of Object.entries(suites)) {
    console.log(`${name}: ${files.length} test files`);
  }
  console.log("Every test belongs to exactly one suite.");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
