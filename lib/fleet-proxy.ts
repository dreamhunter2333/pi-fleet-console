import "server-only";

import type { NextRequest } from "next/server";
import { getStoredFleetMachine } from "./fleet-store";

const HOP_BY_HOP_HEADERS = [
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
];

function upstreamHeaders(request: Request, configured: Record<string, string>): Headers {
  const headers = new Headers(request.headers);
  for (const name of HOP_BY_HOP_HEADERS) headers.delete(name);
  for (const name of ["authorization", "cookie", "origin", "referer", "x-pi-machine"]) headers.delete(name);
  for (const name of [...headers.keys()]) {
    if (name.startsWith("sec-fetch-")) headers.delete(name);
  }
  for (const [name, value] of Object.entries(configured)) headers.set(name, value);
  return headers;
}

export async function forwardFleetRequest(request: NextRequest, path: string[], selectedMachineId?: string): Promise<Response> {
  const machineId = selectedMachineId?.trim() || request.headers.get("x-pi-machine")?.trim();
  if (!machineId) return Response.json({ error: "Missing X-Pi-Machine header" }, { status: 400 });

  const machine = await getStoredFleetMachine(machineId);
  if (!machine || !machine.enabled) {
    return Response.json({ error: "Machine not found or disabled" }, { status: 404 });
  }

  const target = new URL(`${machine.api.url}/api/${path.map(encodeURIComponent).join("/")}`);
  target.search = request.nextUrl.search;
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const init: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers: upstreamHeaders(request, machine.api.headers),
    body: hasBody ? request.body : undefined,
    redirect: "manual",
    signal: request.signal,
  };
  if (hasBody && request.body) init.duplex = "half";

  try {
    const upstream = await fetch(target, init);
    const headers = new Headers(upstream.headers);
    for (const name of HOP_BY_HOP_HEADERS) headers.delete(name);
    headers.delete("set-cookie");
    headers.set("cache-control", "no-store");
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
  } catch (error) {
    return Response.json({
      error: "Machine is unreachable",
      detail: error instanceof Error ? error.message : String(error),
    }, { status: 502 });
  }
}
