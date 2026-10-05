import assert from "node:assert/strict";
import { writeFile, mkdir, mkdtemp, rm, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { appendFileSync, readFileSync, constants } from "node:fs";
import { createServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { createECDH, randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
test(
  "compiled API preserves Pi Web commands, events and local services",
  { timeout: 60000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), "pi-fleet-agent-test-"));
    for (const dir of ["agent", "home", "cache", "data", "config", "project"])
      await mkdir(join(root, dir));
    const certificate = spawnSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-days",
        "1",
        "-subj",
        "/CN=localhost",
        "-keyout",
        root + "/key.pem",
        "-out",
        root + "/cert.pem",
      ],
      { encoding: "utf8" },
    );
    assert.equal(certificate.status, 0, certificate.stderr);
    let pushRequests = 0;
    const pushServer = createHttpsServer(
      {
        key: readFileSync(root + "/key.pem"),
        cert: readFileSync(root + "/cert.pem"),
      },
      (req, res) => {
        req.resume();
        pushRequests++;
        res.writeHead(410);
        res.end("Expired subscription");
      },
    );
    await new Promise<void>((r) => pushServer.listen(0, "127.0.0.1", r));
    await writeFile(root + "/agent/models.json", "{}");
    await writeFile(root + "/agent/settings.json", "{}");
    const binarySource = resolve(
      process.env.PI_FLEET_AGENT_BIN || "build/pi-fleet-agent",
    );
    const binary = join(root, "install/bin/pi-fleet-agent");
    await mkdir(join(root, "install/bin"), { recursive: true });
    await copyFile(binarySource, binary, constants.COPYFILE_FICLONE);
    await mkdir(join(root, "install/lib/node_modules/npm/bin"), {
      recursive: true,
    });
    await writeFile(
      join(root, "install/lib/node_modules/npm/bin/npx-cli.js"),
      'throw new Error("API binary is not a Node interpreter");',
    );
    const fakeNpx = join(root, "install/bin/npx");
    await writeFile(
      fakeNpx,
      `#!/bin/sh
printf '%s\\n' "$@" > "$0.args"
printf '%s' "\${PI_PACKAGE_DIR:-unset}" > "$0.env"
printf 'test-owner/test-repo@bridge 1K installs\\nhttps://example.invalid/skill\\n'
`,
      { mode: 0o755 },
    );
    let requests = 0;
    await writeFile(
      root + "/mcp-fixture.mjs",
      `import {createInterface} from 'node:readline';
const input=createInterface({input:process.stdin});
input.on('line',line=>{const q=JSON.parse(line);if(q.id===undefined)return;let result={};if(q.method==='initialize')result={protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}};if(q.method==='tools/list')result={tools:[{name:'bridge_echo',description:'Fixture echo',inputSchema:{type:'object',properties:{}}}]};process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:q.id,result})+'\\n');});`,
    );
    await writeFile(
      root + "/agent/mcp.json",
      JSON.stringify({
        mcpServers: {
          fixture: {
            command: process.execPath,
            args: [root + "/mcp-fixture.mjs"],
          },
        },
      }),
    );
    const mock = createServer(async (req, res) => {
      if (req.method === "GET") {
        res.writeHead(503);
        res.end();
        return;
      }
      let data = "";
      for await (const c of req) data += c;
      const body: {
        messages: { role: string; content?: unknown }[];
        tools?: { function?: { name?: string } }[];
      } = JSON.parse(data);
      requests++;
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      const chunk = (
        delta: Record<string, unknown>,
        finish: string | null = null,
      ) =>
        res.write(
          "data: " +
            JSON.stringify({
              id: "bridge",
              object: "chat.completion.chunk",
              created: 1,
              model: "bridge-test",
              choices: [{ index: 0, delta, finish_reason: finish }],
              ...(finish
                ? {
                    usage: {
                      prompt_tokens: 100,
                      completion_tokens: 10,
                      total_tokens: 110,
                    },
                  }
                : {}),
            }) +
            "\n\n",
        );
      const last = body.messages.at(-1);
      if (
        last?.role === "user" &&
        JSON.stringify(last).includes("RUN_TOOL") &&
        body.tools?.some((t) => t.function?.name === "bash")
      ) {
        chunk({
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id: "call_bridge",
              type: "function",
              function: {
                name: "bash",
                arguments: JSON.stringify({ command: "printf FLEET_TOOL_OK" }),
              },
            },
          ],
        });
        chunk({}, "tool_calls");
      } else {
        chunk({
          role: "assistant",
          content:
            last?.role === "tool"
              ? String(last.content).trim() === "FLEET_TOOL_OK"
                ? "TOOL_COMPLETED"
                : "TOOL_FAILED"
              : "SDK_BRIDGE_OK",
        });
        chunk({}, "stop");
      }
      res.end("data: [DONE]\n\n");
    });
    await new Promise<void>((r) => mock.listen(0, "127.0.0.1", r));
    const provider = {
      baseUrl: `http://127.0.0.1:${(mock.address() as import("node:net").AddressInfo).port}`,
      api: "openai-completions",
      apiKey: "fixture",
      models: [
        {
          id: "bridge-test",
          name: "Bridge Test",
          reasoning: false,
          input: ["text", "image"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 128000,
          maxTokens: 4096,
        },
      ],
    };
    const priorModels = JSON.parse(
      readFileSync(root + "/agent/models.json", "utf8"),
    );
    await writeFile(
      root + "/agent/models.json",
      JSON.stringify({
        ...priorModels,
        providers: { ...priorModels.providers, bridge: provider },
      }),
    );
    await writeFile(
      root + "/agent/settings.json",
      JSON.stringify({
        ...JSON.parse(readFileSync(root + "/agent/settings.json", "utf8")),
        enabledModels: ["bridge/bridge-test"],
        defaultProvider: "bridge",
        defaultModel: "bridge-test",
        defaultThinkingLevel: "off",
        enableInstallTelemetry: false,
        defaultProjectTrust: "trusted",
        compaction: {
          enabled: false,
          keepRecentTokens: 10,
          reserveTokens: 512,
        },
      }),
    );
    await mkdir(root + "/agent/extensions", { recursive: true });
    await writeFile(
      root + "/agent/extensions/bridge-check.ts",
      `import {resizeImage} from '@earendil-works/pi-coding-agent';
export default function(pi) {
 pi.registerCommand('bridge-check', {description:'Binary extension check', handler:async(_,ctx)=>ctx.ui.notify('BRIDGE_PLUGIN_OK','info')});
 pi.registerCommand('image-check', {description:'Image worker check', handler:async(_,ctx)=>{const image=await resizeImage(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAC0lEQVR4nGNgQAYAAA4AAamRc7EAAAAASUVORK5CYII=','base64'),'image/png',{maxWidth:1,maxHeight:1});if(!image || image.width!==1 || image.height!==1)throw new Error('Image resize failed');ctx.ui.notify('IMAGE_RESIZE_OK','info');}});
}`,
    );
    const controllers: AbortController[] = [];
    const streamErrors: unknown[] = [];
    const child = spawn(binary, ["--port", "0"], {
      cwd: root + "/project",
      env: {
        ...process.env,
        SHELL: "/bin/sh",
        PI_PACKAGE_DIR: "",
        NODE_TLS_REJECT_UNAUTHORIZED: "0",
        HOME: root + "/home",
        XDG_CACHE_HOME: root + "/cache",
        XDG_DATA_HOME: root + "/data",
        XDG_CONFIG_HOME: root + "/config",
        PI_CODING_AGENT_DIR: root + "/agent",
        MAGIC_CONTEXT_LOG_PATH: root + "/magic-context.log",
        PI_WEB_SKIP_VERSION_CHECK: "1",
        PI_WEB_PASSWORD: "fixture-password",
        SKILLS_API_URL: `http://127.0.0.1:${(mock.address() as import("node:net").AddressInfo).port}`,
        PATH: root + "/install/bin:/usr/bin:/bin:/usr/sbin:/sbin",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let log = "";
    const record = (d: Buffer) => {
      log += d;
      appendFileSync(root + "/live-core.log", d);
    };
    child.stdout.on("data", record);
    child.stderr.on("data", record);
    child.on("error", (error) => {
      log += error.message;
    });
    t.after(async () => {
      for (const controller of controllers) controller.abort();
      if (child.pid && child.exitCode === null) {
        child.kill("SIGTERM");
        await new Promise<void>((r) => {
          child.once("exit", r);
          setTimeout(() => {
            child.kill("SIGKILL");
            r();
          }, 10000).unref();
        });
      }
      mock.closeAllConnections();
      await new Promise((r) => mock.close(r));
      pushServer.closeAllConnections();
      await new Promise((r) => pushServer.close(r));

      await rm(root, { recursive: true, force: true });
      assert.equal(child.exitCode, 0, log);
    });
    let base = "";
    for (let i = 0; i < 150; i++) {
      const m = log.match(/http:\/\/127.0.0.1:(\d+)/);
      if (m) {
        base = m[0];
        break;
      }
      if (child.exitCode !== null) throw new Error(log);
      await new Promise((r) => setTimeout(r, 100));
    }
    assert(base, log);
    const auth =
      "Basic " + Buffer.from("pi:fixture-password").toString("base64");
    async function raw(path: string, body?: unknown, method?: string) {
      return fetch(base + path, {
        method: method ?? (body === undefined ? "GET" : "POST"),
        headers: {
          Authorization: auth,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    }
    async function api(path: string, body?: unknown, method?: string) {
      const r = await raw(path, body, method);
      const b = await r.json();
      assert(r.ok, `${path}: ${r.status} ${JSON.stringify(b)}`);
      return b;
    }
    async function collect(
      response: Response,
      consume: (chunk: string) => void,
    ) {
      assert(response.body);
      const reader = response.body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) return;
          consume(Buffer.from(value).toString());
        }
      } finally {
        reader.releaseLock();
      }
    }
    const checks = [];
    const version = spawnSync(binary, ["pi", "--version"], {
      env: {
        NODE_ENV: "test",
        HOME: root + "/home",
        PI_CODING_AGENT_DIR: root + "/agent",
        XDG_CACHE_HOME: root + "/cache",
        XDG_CONFIG_HOME: root + "/config",
        XDG_DATA_HOME: root + "/data",
        PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
      },
      encoding: "utf8",
      timeout: 10000,
    });
    assert.equal(version.status, 0, version.stderr);
    const expectedVersion = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ).dependencies["@earendil-works/pi-coding-agent"];
    assert.equal(version.stdout.trim(), expectedVersion);
    checks.push("embedded Pi CLI/version");

    assert.equal((await fetch(base + "/api/home")).status, 401);
    assert.equal(
      (
        await fetch(base + "/api/home", {
          headers: { Authorization: auth, "Sec-Fetch-Site": "cross-site" },
        })
      ).status,
      403,
    );
    assert.equal((await fetch(base + "/")).status, 404);
    const head = await raw("/api/home", undefined, "HEAD");
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
    const options = await raw("/api/home", undefined, "OPTIONS");
    assert.equal(options.status, 204);
    assert(options.headers.get("allow")?.includes("HEAD"));
    assert.equal((await raw("/api/home", {}, "PUT")).status, 405);
    checks.push("auth/origin/API-only");
    const debug = await api("/api/agent/debug");
    assert.equal(debug.server.wrappers.alive, 0);
    assert.deepEqual(debug.sessions, []);
    checks.push("read-only debug route");
    const query = "literal $(touch marker); &";
    const found = await api("/api/skills/search", { query });
    assert.equal(found.results[0]?.package, "test-owner/test-repo@bridge");
    assert(readFileSync(fakeNpx + ".args", "utf8").includes(query));
    assert.equal(readFileSync(fakeNpx + ".env", "utf8"), "unset");
    checks.push("host npx beside an embedded runtime");
    await api("/api/cwd/validate", { cwd: root + "/project" });
    const models = await api("/api/models?cwd=" + root + "/project");
    assert(
      models.modelList.some((m: { id: string }) => m.id === "bridge-test"),
    );
    checks.push("model/config");
    const opened = await api("/api/agent/new", {
      cwd: root + "/project",
      type: "ensure_session",
      provider: "bridge",
      modelId: "bridge-test",
      toolNames: ["bash", "read"],
    });
    const id = opened.sessionId;
    assert(id);
    const commands = await api("/api/agent/" + id, { type: "get_commands" });
    assert(JSON.stringify(commands).includes("bridge-check"));
    checks.push("TypeScript plugin");
    const ctl = new AbortController();
    controllers.push(ctl);
    let events = "";
    const streaming = fetch(base + "/api/agent/" + id + "/events", {
      headers: { Authorization: auth },
      signal: ctl.signal,
    })
      .then(async (r) => {
        assert.equal(r.status, 200);
        await collect(r, (chunk) => {
          events += chunk;
        });
      })
      .catch((e) => {
        if (e.name !== "AbortError") streamErrors.push(e);
      });
    async function turn(message: string) {
      const prior = events.length;
      await api("/api/agent/" + id, { type: "prompt", message });
      for (let i = 0; i < 200; i++) {
        if (events.slice(prior).includes('"type":"agent_end"')) return;
        await new Promise((r) => setTimeout(r, 50));
      }
      throw new Error("No agent_end: " + events.slice(-600));
    }
    const pushKey = createECDH("prime256v1");
    pushKey.generateKeys();
    await api("/api/push/subscribe", {
      subscription: {
        endpoint: `https://127.0.0.1:${(pushServer.address() as import("node:net").AddressInfo).port}/expired`,
        keys: {
          p256dh: pushKey.getPublicKey().toString("base64url"),
          auth: randomBytes(16).toString("base64url"),
        },
      },
    });
    await turn("Hello");
    assert(events.includes("SDK_BRIDGE_OK"));
    checks.push("SDK prompt/SSE");
    for (let i = 0; i < 100; i++) {
      if (
        pushRequests > 0 &&
        JSON.parse(readFileSync(root + "/agent/web-push.json", "utf8"))
          .subscriptions.length === 0
      )
        break;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert(pushRequests > 0);
    assert.equal(
      JSON.parse(readFileSync(root + "/agent/web-push.json", "utf8"))
        .subscriptions.length,
      0,
    );
    await api("/api/home");
    checks.push("expired push subscription preserves server");
    await turn("RUN_TOOL");
    assert(events.includes("FLEET_TOOL_OK"));
    assert(events.includes("TOOL_COMPLETED"));
    checks.push("bash tool loop");
    await api("/api/agent/" + id, {
      type: "prompt",
      message: "/bridge-check",
    });
    await new Promise((r) => setTimeout(r, 100));
    assert(events.includes("BRIDGE_PLUGIN_OK"));
    checks.push("extension UI event");
    await api("/api/agent/" + id, { type: "prompt", message: "/image-check" });
    for (let i = 0; i < 100 && !events.includes("IMAGE_RESIZE_OK"); i++)
      await new Promise((r) => setTimeout(r, 50));
    assert(events.includes("IMAGE_RESIZE_OK"), events.slice(-2500));
    checks.push("image resize worker/WASM");

    await api("/api/agent/" + id, { type: "compact" });
    checks.push("native compaction");
    const sessions = await api("/api/sessions");
    assert(sessions.sessions.some((s: { id: string }) => s.id === id));
    const history = await api("/api/sessions/" + id);
    assert(JSON.stringify(history).includes("SDK_BRIDGE_OK"));
    checks.push("history");
    const file = root + "/project/fixture.txt";
    await writeFile(file, "FILE_BRIDGE_OK");
    const fileRes = await raw(
      "/api/files/" +
        file.split("/").map(encodeURIComponent).join("/") +
        "?type=read",
    );
    const fileBody = await fileRes.text();
    assert(fileRes.ok, fileBody);
    assert(fileBody.includes("FILE_BRIDGE_OK"));
    checks.push("file read");
    assert.equal((await raw("/api/files/etc/passwd?type=read")).status, 403);
    checks.push("file boundary");
    const terminal = await api("/api/terminal", { cwd: root + "/project" });
    let output = "";
    let terminalBuffer = "";
    const tc = new AbortController();
    controllers.push(tc);
    const ts = fetch(base + "/api/terminal/" + terminal.id + "/events", {
      headers: { Authorization: auth },
      signal: tc.signal,
    })
      .then(async (r) => {
        await collect(r, (chunk) => {
          terminalBuffer += chunk;
          const lines = terminalBuffer.split("\n");
          terminalBuffer = lines.pop() || "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const event = JSON.parse(line.slice(6)) as {
              type: string;
              data?: string;
            };
            if (event.type === "output") output += event.data || "";
          }
        });
      })
      .catch((e) => {
        if (e.name !== "AbortError") streamErrors.push(e);
      });
    await api("/api/terminal/" + terminal.id, {
      type: "input",
      data: "printf PTY_; printf BINARY_OK\n",
    });
    for (let i = 0; i < 50 && !output.includes("PTY_BINARY_OK"); i++)
      await new Promise((r) => setTimeout(r, 50));
    assert(output.includes("PTY_BINARY_OK"), output);
    await api("/api/terminal/" + terminal.id, {
      type: "resize",
      cols: 100,
      rows: 30,
    });
    await api("/api/terminal/" + terminal.id, undefined, "DELETE");
    tc.abort();
    await ts;
    checks.push("PTY input/resize/close");
    const mcp = await api("/api/mcp");
    assert(mcp.mcp.available);
    checks.push("MCP internals");
    const connected = await api("/api/mcp/test", {
      scope: "global",
      name: "fixture",
    });
    assert.equal(
      connected.result.state,
      "connected",
      JSON.stringify(connected),
    );
    assert(
      connected.result.tools.some(
        (t: { name: string }) => t.name === "bridge_echo",
      ),
    );
    checks.push("MCP stdio");
    const exported = await raw("/api/sessions/" + id + "/export");
    const html = await exported.text();
    assert(exported.ok, html);
    await writeFile(root + "/export.html", html);
    assert(
      html.includes("<!DOCTYPE html>") || html.includes("<!doctype html>"),
    );
    const encoded = html.match(/id="session-data"[^>]*>([^<]+)/)?.[1];
    assert(encoded);
    assert(Buffer.from(encoded, "base64").toString().includes("SDK_BRIDGE_OK"));
    checks.push("HTML export");
    ctl.abort();
    await streaming;
    assert.equal(checks.length, 19);
    assert.deepEqual(streamErrors, []);
    assert(requests >= 4);
    assert(!log.includes("Code mode is off"), log);
    assert(!log.includes("[pi-fleet-agent] extension:"), log);
  },
);
