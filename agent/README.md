# Fleet API agent

Build a standalone API executable from the existing Pi Web route handlers. The
Fleet frontend, gateway, Next.js development server, npm package, and container
build keep their existing entry points. No frontend assets are bundled into the
agent, and it does not open a browser.

## Build and test

From the repository root, with its locked dependencies installed and Bun 1.4.4:

```sh
npm run build:agent
npm run test:agent
```

The output is `build/pi-fleet-agent`. An optional output path can be passed to
`bun scripts/build-agent.mts /path/to/pi-fleet-agent`. Release CI builds and tests macOS arm64 and Linux x64 baseline binaries. It embeds
the Pi SDK version pinned by this repository, independently of a global Pi CLI.

Run it manually:

```sh
PI_CODING_AGENT_DIR="$HOME/.pi/agent" ./build/pi-fleet-agent --port 30142
```

It binds to `127.0.0.1` by default. To connect a Fleet gateway from another host,
select a reachable `--hostname`, set `PI_WEB_PASSWORD`, and configure the machine's
`api.url` and Basic Auth header as for an existing Pi Web backend. It shares the
existing host/origin validation and authentication middleware. `/` returns 404;
the HTTP API and SSE streams retain their existing paths and response formats.
Service installation and machine lists are managed separately by the deployment role.

For isolated testing, override `HOME`, `PI_CODING_AGENT_DIR`, `XDG_CACHE_HOME`,
`XDG_CONFIG_HOME`, `XDG_DATA_HOME`, and `MAGIC_CONTEXT_LOG_PATH`. Do not point test
writes at a live agent directory or resume a session concurrently with another
Pi process.

## Packaging details

- All `app/api/**/route.ts` files are discovered at build time. Their handlers and
  the existing security middleware are reused. NextRequest/NextResponse helpers
  remain bundled; a Next.js web server is not started.
- The binary uses Bun's PTY support through a small node-pty adapter. The adapter
  also covers dynamically loaded extensions that require node-pty. Existing
  Node.js and Next.js builds continue to use the original node-pty package.
- A build-only Web Push error adapter preserves subscription error handling under Bun.
- The compiled MCP adapter imports SDK internals from the same build graph and
  checks that its stdio transport classes agree.
- Build-only adapters preserve the pinned SDK package metadata and resolve
  embedded Code mode/image workers, Photon WASM,
  and HTML export code. Expected source patterns are checked so incompatible SDK
  changes fail the build. They do not rewrite files in node_modules.
- Required templates, themes, and Photon WASM are embedded and extracted
  atomically into a content-addressed `pi-fleet-agent` cache on first use.
- The SDK's CLI entry is embedded for extension subprocesses (`--print` or
  `--mode`), including Magic Context's historian and Pi subagents. This does not
  attach to or manage an existing TUI process.
- Settings, sessions, skills, extension packages, language servers, Git, shells,
  npm/npx, and external MCP programs remain host resources. A single service
  executable does not make those tools or user-installed plugins self-contained.
- `/api/app-update` still describes the upstream Pi Web release. Tagged Fleet
  releases attach native binaries and SHA-256 files through the API binaries CI.
- Source files use `.mts` (TypeScript ES modules). The dedicated agent tsconfig
  keeps Bun types out of the existing Next.js typecheck.
- Original API source files are reused without rewriting. SDK CLI file entries
  are dispatched by the new entrypoint, and npm/npx use the host commands.

## Validation

`npm run test:agent` starts the compiled executable with fresh temporary agent,
HOME and XDG directories and a loopback model fixture. The service embeds its
runtime; host commands remain available for tools and external MCP servers.
It checks authentication, cross-site refusal, API-only routing, read-only debug snapshots, models, TypeScript
extensions, prompts and SSE, a Bash tool loop, extension UI notifications, image
resizing through the embedded Worker/Photon WASM path, native
compaction, history, file reads and access boundaries, PTY input/resize/close,
MCP stdio discovery, expired push-subscription pruning, Code mode's sandbox self-test, host npm/npx dispatch beside the executable, and
HTML export. The MCP test
program uses the test runner's explicit Node path as an external MCP fixture.

Additional Mac checks used an isolated copy of the installed plugin configuration:
background PTY task ordering completed, a real Maxx/DeepSeek V4.1 request returned,
and Magic Context's real historian published a compartment. An unmodified copy
of the deployed Fleet frontend also created a conversation and used the Mac
terminal through a temporary local gateway. These checks do not certify every
provider, external tool, or all 68 API routes on other platforms.
