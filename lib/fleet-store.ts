import "server-only";

import { readFile } from "node:fs/promises";
import type { FleetMachine } from "./fleet-types";

export interface StoredFleetMachine extends FleetMachine {
  api: {
    url: string;
    headers: Record<string, string>;
  };
}

const FORBIDDEN_HEADERS = new Set([
  "connection", "content-length", "keep-alive", "proxy-authenticate",
  "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade",
  "x-pi-machine",
]);

function configFile(): string {
  return process.env.PI_FLEET_CONFIG_FILE?.trim() || "/config/machines.json";
}

function parseMachine(value: unknown, index: number): StoredFleetMachine {
  if (!value || typeof value !== "object") throw new Error(`Machine #${index + 1} is invalid`);
  const input = value as Record<string, unknown>;
  const id = typeof input.id === "string" ? input.id.trim() : "";
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(id)) throw new Error(`Machine #${index + 1} has an invalid id`);
  if (!name || name.length > 80) throw new Error(`Machine ${id} has an invalid name`);
  if (input.enabled !== undefined && typeof input.enabled !== "boolean") throw new Error(`Machine ${id} has an invalid enabled value`);

  const api = input.api && typeof input.api === "object" ? input.api as Record<string, unknown> : {};
  let url: URL;
  try {
    url = new URL(String(api.url ?? ""));
  } catch {
    throw new Error(`Machine ${id} has an invalid API URL`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`Machine ${id} API URL must use HTTP or HTTPS`);
  if (url.username || url.password || url.search || url.hash) throw new Error(`Machine ${id} API URL contains unsupported parts`);

  const rawHeaders = api.headers ?? {};
  if (!rawHeaders || typeof rawHeaders !== "object" || Array.isArray(rawHeaders)) {
    throw new Error(`Machine ${id} has invalid API headers`);
  }
  const headers: Record<string, string> = {};
  const headerNames = new Set<string>();
  for (const [rawName, rawValue] of Object.entries(rawHeaders)) {
    const name = rawName;
    const normalizedName = name.toLowerCase();
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) throw new Error(`Machine ${id} has an invalid API header name`);
    if (headerNames.has(normalizedName)) throw new Error(`Machine ${id} has a duplicate API header: ${name}`);
    if (FORBIDDEN_HEADERS.has(normalizedName)) throw new Error(`Machine ${id} uses a forbidden API header: ${name}`);
    if (typeof rawValue !== "string" || rawValue.includes("\n") || rawValue.includes("\r")) {
      throw new Error(`Machine ${id} has an invalid API header value: ${name}`);
    }
    headerNames.add(normalizedName);
    headers[name] = rawValue;
  }

  return {
    id,
    name,
    enabled: input.enabled !== false,
    api: {
      url: url.toString().replace(/\/$/, ""),
      headers,
    },
  };
}

async function readStored(): Promise<StoredFleetMachine[]> {
  const inlineConfig = process.env.PI_FLEET_CONFIG_JSON?.trim();
  const raw = JSON.parse(inlineConfig || await readFile(configFile(), "utf8")) as unknown;
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as { machines?: unknown }).machines)) {
    throw new Error("Fleet config must contain a machines array");
  }
  const machines = (raw as { machines: unknown[] }).machines.map(parseMachine);
  const ids = new Set<string>();
  for (const machine of machines) {
    if (ids.has(machine.id)) throw new Error(`Duplicate machine id: ${machine.id}`);
    ids.add(machine.id);
  }
  return machines;
}

export async function listFleetMachines(): Promise<FleetMachine[]> {
  return (await readStored()).map((machine) => ({
    id: machine.id,
    name: machine.name,
    enabled: machine.enabled,
  }));
}

export async function getStoredFleetMachine(id: string): Promise<StoredFleetMachine | null> {
  return (await readStored()).find((machine) => machine.id === id) ?? null;
}
