"use client";

import { createContext, Fragment, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { installFleetTransport } from "@/lib/fleet-client";
import type { FleetMachine } from "@/lib/fleet-types";

const STORAGE_KEY = "pi-fleet:selected-machine";

interface FleetContextValue {
  machines: FleetMachine[];
  selectedMachine: FleetMachine | null;
  selectMachine: (id: string) => void;
}

const FleetContext = createContext<FleetContextValue | null>(null);

export function useFleet(): FleetContextValue {
  const value = useContext(FleetContext);
  if (!value) throw new Error("useFleet must be used inside FleetProvider");
  return value;
}

function storedMachineId(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function FleetProvider({ children }: { children: ReactNode }) {
  const [machines, setMachines] = useState<FleetMachine[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [transportMachineId, setTransportMachineId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshMachines = useCallback(async () => {
    const response = await fetch("/api/fleet/machines", { cache: "no-store" });
    const data = await response.json() as { machines?: FleetMachine[]; error?: string };
    if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
    const next = data.machines ?? [];
    setMachines(next);
    setSelectedId((current) => {
      const candidate = current ?? storedMachineId();
      if (candidate && next.some((machine) => machine.id === candidate && machine.enabled)) return candidate;
      return next.find((machine) => machine.enabled)?.id ?? null;
    });
  }, []);

  useEffect(() => {
    refreshMachines()
      .catch((nextError) => setError(nextError instanceof Error ? nextError.message : String(nextError)))
      .finally(() => setLoading(false));
  }, [refreshMachines]);

  useLayoutEffect(() => {
    if (!selectedId) {
      setTransportMachineId(null);
      return;
    }
    const restore = installFleetTransport(selectedId);
    setTransportMachineId(selectedId);
    return restore;
  }, [selectedId]);

  const selectMachine = useCallback((id: string) => {
    if (!machines.some((machine) => machine.id === id && machine.enabled)) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // A private browsing mode may disable storage; selection still works for this page.
    }
    setSelectedId(id);
  }, [machines]);

  const selectedMachine = machines.find((machine) => machine.id === selectedId) ?? null;
  const value = useMemo<FleetContextValue>(() => ({
    machines,
    selectedMachine,
    selectMachine,
  }), [machines, selectMachine, selectedMachine]);

  if (loading) {
    return <div style={{ minHeight: "100dvh", background: "var(--bg)", color: "var(--text-dim)", display: "grid", placeItems: "center", fontSize: 12 }}>Loading machines…</div>;
  }

  return (
    <FleetContext.Provider value={value}>
      {error && <div style={{ position: "fixed", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 1200, padding: "7px 12px", border: "1px solid rgba(248,113,113,.35)", borderRadius: 7, background: "var(--bg)", color: "#f87171", fontSize: 12 }}>{error}</div>}
      {selectedMachine && transportMachineId === selectedMachine.id ? (
        <Fragment key={selectedMachine.id}>{children}</Fragment>
      ) : (
        <div style={{ minHeight: "100dvh", background: "var(--bg)", color: "var(--text-muted)", display: "grid", placeItems: "center" }}>
          <span style={{ fontSize: 12 }}>{error ?? "No enabled machines configured"}</span>
        </div>
      )}
    </FleetContext.Provider>
  );
}
