import { readdir, readFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "package.json"));
const sdk = dirname(
  dirname(
    fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")),
  ),
);
const sdkPackage = JSON.parse(
  await readFile(join(sdk, "package.json"), "utf8"),
);
const output = resolve(process.argv[2] || join(root, "build/pi-fleet-agent"));
const target = process.env.PI_FLEET_COMPILE_TARGET as
  | Bun.Build.CompileTarget
  | undefined;
let bundleRoot = root;
while (relative(bundleRoot, sdk).startsWith(".."))
  bundleRoot = dirname(bundleRoot);
const worker = (name: string) => "./" + relative(bundleRoot, join(sdk, name));
async function patchJavaScript(path: string, before: string, after: string) {
  const source = await readFile(path, "utf8");
  if (!source.includes(before))
    throw new Error(`Binary adapter needs updating: ${path}`);
  return { loader: "js" as const, contents: source.replace(before, after) };
}
async function files(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) =>
        entry.isDirectory()
          ? files(join(dir, entry.name))
          : join(dir, entry.name),
      ),
    )
  ).flat();
}
const routeFiles = (await files(join(root, "app/api"))).filter((path) =>
  path.endsWith("/route.ts"),
);
const routeDefinitions = routeFiles
  .map((path) => {
    const parts = path
      .slice(join(root, "app").length, -"/route.ts".length)
      .split("/")
      .filter(Boolean);
    const params: { name: string; rest: boolean }[] = [];
    let specificity = 0;
    const pattern = parts
      .map((part) => {
        if (part.startsWith("[")) {
          const rest = part.startsWith("[...");
          params.push({ name: part.slice(rest ? 4 : 1, -1), rest });
          specificity += rest ? 0 : 1;
          return rest ? "(.+)" : "([^/]+)";
        }
        specificity += 10;
        return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      })
      .join("/");
    return {
      specificity,
      source: `{ pattern: new RegExp(${JSON.stringify(`^/${pattern}/?$`)}), params: ${JSON.stringify(params)}, load: () => import(${JSON.stringify(path)}) }`,
    };
  })
  .sort((a, b) => b.specificity - a.specificity);

const sdkModules = {
  runtime: join(sdk, "dist/extensions/mcp/runtime.js"),
  config: join(sdk, "dist/extensions/mcp/config.js"),
  oauth: join(sdk, "dist/extensions/mcp/oauth.js"),
  servers: join(sdk, "dist/core/mcp-servers.js"),
  values: join(sdk, "dist/core/resolve-config-value.js"),
  client: fileURLToPath(import.meta.resolve("@earendil-works/pi-mcp")),
};
const members = {
  runtime: ["McpServerConnection", "createDefaultTransport"],
  config: [
    "loadMcpConfig",
    "addMcpServerConfig",
    "updateMcpServerConfig",
    "removeMcpServerConfig",
  ],
  oauth: [
    "signInMcpServer",
    "McpOAuthCredentialStore",
    "McpSignInCancelledError",
  ],
  servers: ["validateMcpServerConfig", "getMcpToolExposure"],
  values: [
    "resolveConfigValueOrThrow",
    "resolveHeadersOrThrow",
    "getConfigValueEnvVarNames",
    "isCommandConfigValue",
  ],
  client: ["StdioTransport"],
};
const imports = Object.entries(sdkModules)
  .map(([name, path]) => `import * as ${name} from ${JSON.stringify(path)};`)
  .join("\n");
const sdkAdapter = `${imports}
import { runtimeDir } from "fleet-agent:runtime";
const internals = { packageDir: runtimeDir, ${Object.entries(members)
  .flatMap(([module, names]) =>
    names.map((name) => `${name}: ${module}.${name}`),
  )
  .join(", ")} };
export async function loadPiSdkInternals() {
  for (const [name, value] of Object.entries(internals)) {
    if (name !== "packageDir" && typeof value !== "function") return { ok: false, reason: "Compiled MCP adapter is missing " + name };
  }
  const probe = internals.createDefaultTransport({ name: "fleet-probe", config: { command: "fleet-probe" }, source: "pi-web" }, runtimeDir);
  if (!(probe instanceof internals.StdioTransport)) return { ok: false, reason: "Compiled MCP transport classes differ" };
  return { ok: true, ...internals };
}`;

const assetFiles = [join(sdk, "package.json")];
assetFiles.push(
  ...(await files(join(sdk, "dist/modes/interactive/theme"))).filter((path) =>
    path.endsWith(".json"),
  ),
);
assetFiles.push(
  ...(await files(join(sdk, "dist/core/export-html"))).filter((path) =>
    /\/(?:template\.[^/]+|vendor\/[^/]+\.js)$/.test(path),
  ),
);
const photon = require.resolve("@silvia-odwyer/photon-node/photon_rs_bg.wasm", {
  paths: [sdk],
});
assetFiles.push(photon);
const assets = assetFiles.map((path, index) => ({
  path,
  name:
    path === photon
      ? "photon_rs_bg.wasm"
      : path
          .slice(sdk.length + 1)
          .replace("dist/modes/interactive/theme/", "theme/")
          .replace("dist/core/export-html/", "export-html/"),
  index,
}));
const digest = createHash("sha256");
for (const asset of assets) digest.update(await readFile(asset.path));
const assetId = digest.digest("hex").slice(0, 16);
const runtimeSource = `
import { mkdirSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import ${JSON.stringify(join(sdk, "dist/bun/runtime-setup.js"))};
${assets.map((asset) => `import asset${asset.index} from ${JSON.stringify(asset.path)} with { type: "file" };`).join("\n")}
export const runtimeDir = join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "pi-fleet-agent", ${JSON.stringify(assetId + "-" + (target || process.platform + "-" + process.arch))});
export async function initializeRuntime() {
  mkdirSync(runtimeDir, { recursive: true, mode: 0o700 });
  for (const [name, source] of [${assets.map((asset) => `[${JSON.stringify(asset.name)}, asset${asset.index}]`).join(",")}]) {
    const dest = join(runtimeDir, name);
    if (existsSync(dest)) continue;
    mkdirSync(dirname(dest), { recursive: true, mode: 0o700 });
    const temporary = dest + "." + process.pid + ".tmp";
    writeFileSync(temporary, await Bun.file(source).arrayBuffer(), { mode: 0o600 });
    renameSync(temporary, dest);
  }
  for (const file of ["dist/cli.js", "dist/bundle/cli.js"]) {
    const dest = join(runtimeDir,file);
    mkdirSync(dirname(dest),{recursive:true,mode:0o700});
    if (!existsSync(dest)) writeFileSync(dest,'throw new Error("Run this entry through pi-fleet-agent");\\n',{mode:0o600});
  }
  process.env.PI_SUBAGENT_PI_BINARY ??= process.execPath;
  process.env.PI_FLEET_PACKAGE_DIR = runtimeDir;
  process.env.PI_FLEET_PHOTON_WASM = join(runtimeDir, "photon_rs_bg.wasm");
}
`;
await mkdir(dirname(output), { recursive: true });
const previousDirectory = process.cwd();
const buildDirectory = await mkdtemp(join(tmpdir(), "fleet-agent-build-"));
let result;
try {
  process.chdir(buildDirectory);
  result = await Bun.build({
    entrypoints: [
      join(root, "agent/main.mts"),
      join(sdk, "dist/utils/image-resize-worker.js"),
      join(sdk, "dist/extensions/codemode/worker.js"),
    ],
    compile: {
      outfile: output,
      ...(target ? { target } : {}),
      autoloadDotenv: false,
      autoloadBunfig: false,
      autoloadPackageJson: true,
    },
    target: "bun",
    root: bundleRoot,
    minify: true,
    sourcemap: "none",
    define: {
      "process.env.NODE_ENV": '"production"',
      "process.env.NEXT_PUBLIC_APP_VERSION": JSON.stringify(
        JSON.parse(await readFile(join(root, "package.json"), "utf8")).version,
      ),
    },
    plugins: [
      {
        name: "fleet-api",
        setup(build) {
          build.onResolve({ filter: /^fleet-agent:/ }, (args) => ({
            path: args.path,
            namespace: "fleet-api",
          }));
          build.onResolve(
            { filter: /(?:^|\/)pi-sdk-internals(?:\.ts)?$/ },
            () => ({ path: "fleet-agent:sdk", namespace: "fleet-api" }),
          );
          build.onResolve({ filter: /(?:^|\/)node-cli(?:\.ts)?$/ }, () => ({
            path: join(root, "agent/node-cli.mts"),
          }));
          build.onResolve({ filter: /^node-pty$/ }, () => ({
            path: join(root, "agent/pty.mts"),
          }));
          build.onLoad(
            { filter: /\/web-push\/src\/web-push-error\.js$/ },
            async (args) => {
              const source = await readFile(args.path, "utf8");
              if (
                !source.includes(
                  "require('util').inherits(WebPushError, Error)",
                )
              )
                throw new Error("Web Push error adapter needs updating");
              return {
                loader: "js",
                contents: `module.exports = class WebPushError extends Error {
                  constructor(message, statusCode, headers, body, endpoint) {
                    super(message);
                    this.name = "WebPushError";
                    Object.assign(this, {statusCode, headers, body, endpoint});
                  }
                };`,
              };
            },
          );
          build.onLoad({ filter: /\/dist\/config\.js$/ }, async (args) => {
            if (args.path !== join(sdk, "dist/config.js")) return;
            const adapted = await patchJavaScript(
              args.path,
              'return "./src/extensions/codemode/worker.ts";',
              `return ${JSON.stringify(worker("dist/extensions/codemode/worker.js"))};`,
            );
            const metadata =
              'pkg = JSON.parse(stripBom(readFileSync(packageJsonPath, "utf-8")));';
            if (!adapted.contents.includes(metadata))
              throw new Error("SDK package metadata adapter needs updating");
            adapted.contents = adapted.contents.replace(
              metadata,
              `pkg = ${JSON.stringify(sdkPackage)};`,
            );
            const packageDir = "return dirname(process.execPath);";
            if (!adapted.contents.includes(packageDir))
              throw new Error("SDK resource directory adapter needs updating");
            adapted.contents = adapted.contents.replace(
              packageDir,
              "return process.env.PI_FLEET_PACKAGE_DIR || dirname(process.execPath);",
            );
            return adapted;
          });
          build.onLoad({ filter: /\/dist\/utils\/image-resize\.js$/ }, (args) =>
            patchJavaScript(
              args.path,
              '"./src/utils/image-resize-worker.ts"',
              JSON.stringify(worker("dist/utils/image-resize-worker.js")),
            ),
          );
          build.onLoad({ filter: /\/dist\/utils\/photon\.js$/ }, (args) =>
            patchJavaScript(
              args.path,
              "path.join(execDir, WASM_FILENAME)",
              "process.env.PI_FLEET_PHOTON_WASM || path.join(execDir, WASM_FILENAME)",
            ),
          );
          const virtualModules: Record<string, string> = {
            "fleet-agent:backend": `export {proxy} from ${JSON.stringify(join(root, "proxy.ts"))}; export {registerNodeInstrumentation} from ${JSON.stringify(join(root, "instrumentation-node.ts"))}; export {closeAllAgentEventStreams} from ${JSON.stringify(join(root, "lib/agent-event-stream.ts"))}; export {getRpcSession,getRpcSessionInfos} from ${JSON.stringify(join(root, "lib/rpc-manager.ts"))};`,
            "fleet-agent:routes": `export const routes = [${routeDefinitions.map((route) => route.source).join(",\n")}];`,
            "fleet-agent:cli": `import ${JSON.stringify(join(sdk, "dist/bun/cli.js"))};`,
            "fleet-agent:runtime": runtimeSource,
            "fleet-agent:sdk": sdkAdapter,
          };
          build.onLoad({ filter: /.*/, namespace: "fleet-api" }, (args) => ({
            loader: "js",
            contents: virtualModules[args.path],
          }));
        },
      },
    ],
  });
} finally {
  process.chdir(previousDirectory);
  await rm(buildDirectory, { recursive: true, force: true });
}
if (!result.success)
  throw new AggregateError(result.logs, "API binary build failed");
console.log(`Built ${output} with ${routeFiles.length} API routes`);
