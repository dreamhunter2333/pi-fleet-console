declare module "fleet-agent:routes" {
  import type { NextRequest } from "next/server";
  export type Params = Record<string, string | string[]>;
  export type Handler = (
    request: NextRequest,
    context: { params: Promise<Params> },
  ) => Response | Promise<Response>;
  export const routes: {
    pattern: RegExp;
    params: { name: string; rest: boolean }[];
    load(): Promise<Record<string, unknown>>;
  }[];
}
declare module "fleet-agent:runtime" {
  export const runtimeDir: string;
  export function initializeRuntime(): Promise<void>;
}
declare module "fleet-agent:cli" {}

declare module "fleet-agent:backend" {
  import type { NextRequest } from "next/server";
  export function proxy(request: NextRequest): Response;
  export function registerNodeInstrumentation(): void;
  export function closeAllAgentEventStreams(): void;
  export function getRpcSessionInfos(options?: {
    includeTransient?: boolean;
  }): { id: string }[];
  export function getRpcSession(
    id: string,
  ): { shutdown(): Promise<void> } | undefined;
}
