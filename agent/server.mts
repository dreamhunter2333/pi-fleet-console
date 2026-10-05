import { NextRequest } from "next/server";
import {
  proxy,
  registerNodeInstrumentation,
  closeAllAgentEventStreams,
  getRpcSession,
  getRpcSessionInfos,
} from "fleet-agent:backend";
import { routes } from "fleet-agent:routes";
import { initializeRuntime } from "fleet-agent:runtime";
import { parseArgs } from "node:util";
import { installPtyAdapter } from "./pty.mts";
import type { Handler } from "fleet-agent:routes";

const { values } = parseArgs({
  options: {
    hostname: {
      type: "string",
      default: process.env.PI_WEB_HOSTNAME || "127.0.0.1",
    },
    port: { type: "string", default: process.env.PORT || "30142" },
    help: { type: "boolean" },
  },
});
if (values.help) {
  console.log(
    "pi-fleet-agent [--hostname 127.0.0.1] [--port 30142]\nUses PI_CODING_AGENT_DIR, PI_WEB_PASSWORD and PI_WEB_ALLOWED_HOSTS.",
  );
  process.exit(0);
}
if (!/^\d+$/.test(values.port ?? "") || Number(values.port) > 65535)
  throw new Error("Invalid port");
process.env.PI_WEB_HOSTNAME = values.hostname;
installPtyAdapter();
await initializeRuntime();
registerNodeInstrumentation();

let stopping = false;
const pending = new Set<Promise<Response>>();
async function dispatch(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/"))
    return new Response("Not found", { status: 404 });
  const req = new NextRequest(request);
  const authorized = proxy(req);
  if (authorized.headers.get("x-middleware-next") !== "1") return authorized;
  for (const route of routes) {
    const match = route.pattern.exec(url.pathname);
    if (!match) continue;
    let params;
    try {
      params = Object.fromEntries(
        route.params.map((param, i) => [
          param.name,
          param.rest
            ? match[i + 1].split("/").map(decodeURIComponent)
            : decodeURIComponent(match[i + 1]),
        ]),
      );
    } catch {
      return Response.json({ error: "Invalid path encoding" }, { status: 400 });
    }
    const handlers = await route.load();
    const method = request.method === "HEAD" ? "GET" : request.method;
    const methods = Object.keys(handlers).filter((key) => /^[A-Z]+$/.test(key));
    if (handlers.GET) methods.push("HEAD");
    methods.push("OPTIONS");
    const allow = methods.join(", ");
    if (method === "OPTIONS")
      return new Response(null, {
        status: 204,
        headers: { Allow: allow },
      });
    if (typeof handlers[method] !== "function")
      return new Response(null, { status: 405, headers: { Allow: allow } });
    const handler = handlers[method] as Handler;
    const result = await handler(req, {
      params: Promise.resolve(params),
    });
    if (request.method !== "HEAD") return result;
    await result.body?.cancel();
    return new Response(null, {
      status: result.status,
      headers: result.headers,
    });
  }
  return Response.json({ error: "Not found" }, { status: 404 });
}

const server = Bun.serve({
  hostname: values.hostname ?? "127.0.0.1",
  port: Number(values.port),
  idleTimeout: 0,
  maxRequestBodySize: 128 * 1024 * 1024,
  fetch(request) {
    if (stopping)
      return Response.json({ error: "Server shutting down" }, { status: 503 });
    const response = dispatch(request);
    pending.add(response);
    return response.finally(() => pending.delete(response));
  },
  error(error) {
    console.error(error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  },
});
console.log(
  `Pi Fleet API ready at http://${server.hostname}:${server.port} (${routes.length} routes)`,
);
async function stop() {
  if (stopping) return;
  stopping = true;
  const deadline = setTimeout(() => process.exit(1), 8000);
  deadline.unref();
  const stopped = server.stop();
  closeAllAgentEventStreams();
  await Promise.allSettled([...pending]);
  await Promise.allSettled(
    getRpcSessionInfos({ includeTransient: true }).map((info) =>
      getRpcSession(info.id)?.shutdown(),
    ),
  );
  await server.stop(true);
  await stopped;
  process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
