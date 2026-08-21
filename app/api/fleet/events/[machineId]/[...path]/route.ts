import type { NextRequest } from "next/server";
import { forwardFleetRequest } from "@/lib/fleet-proxy";

interface RouteContext {
  params: Promise<{ machineId: string; path: string[] }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { machineId, path } = await context.params;
  return forwardFleetRequest(request, path, machineId);
}
