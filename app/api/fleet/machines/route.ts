import { listFleetMachines } from "@/lib/fleet-store";

export async function GET() {
  try {
    return Response.json({ machines: await listFleetMachines() });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
