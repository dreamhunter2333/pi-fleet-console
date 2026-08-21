import type { NextRequest } from "next/server";
import { forwardFleetRequest } from "@/lib/fleet-proxy";

interface RouteContext {
  params: Promise<{ path: string[] }>;
}

async function handle(request: NextRequest, context: RouteContext) {
  return forwardFleetRequest(request, (await context.params).path);
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const OPTIONS = handle;
