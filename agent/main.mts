import { join } from "node:path";
import { initializeRuntime, runtimeDir } from "fleet-agent:runtime";
import { installPtyAdapter } from "./pty.mts";

const args = process.argv.slice(2);
const sdkEntry =
  args[0] === join(runtimeDir, "dist/cli.js") ||
  args[0] === join(runtimeDir, "dist/bundle/cli.js");
if (
  args[0] === "pi" ||
  sdkEntry ||
  args.includes("--print") ||
  args.includes("--mode") ||
  args.includes("--export")
) {
  if (args[0] === "pi" || sdkEntry) process.argv.splice(2, 1);
  await initializeRuntime();
  installPtyAdapter();
  await import("fleet-agent:cli");
} else {
  await import("./server.mts");
}
