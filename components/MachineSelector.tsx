"use client";

import { useEffect, useRef, useState } from "react";
import { useFleet } from "@/hooks/useFleet";
import { useI18n } from "@/hooks/useI18n";

export function MachineSelector() {
  const { machines, selectedMachine, selectMachine } = useFleet();
  const { locale } = useI18n();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const enabledMachines = machines.filter((machine) => machine.enabled);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);

  return (
    <div ref={rootRef} style={{ position: "relative", display: "flex", marginBottom: 6 }}>
      <button
        onClick={() => setOpen((value) => !value)}
        title={selectedMachine?.name}
        style={{
          minWidth: 0, flex: 1, height: 29, display: "flex", alignItems: "center", gap: 7,
          padding: "0 9px", background: "var(--bg-panel)", border: "1px solid var(--border)",
          borderRadius: 7, color: "var(--text)", cursor: "pointer", textAlign: "left", fontSize: 11,
        }}
      >
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#4ade80", boxShadow: "0 0 0 2px rgba(74,222,128,.12)", flexShrink: 0 }} />
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "var(--font-mono)" }}>
          {selectedMachine?.name ?? (locale.startsWith("zh") ? "选择机器…" : "Select machine…")}
        </span>
        <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--text-dim)", flexShrink: 0 }}><polyline points="2 3.5 5 6.5 8 3.5" /></svg>
      </button>
      {open && (
        <div style={{ position: "absolute", top: 33, left: 0, right: 0, zIndex: 120, padding: 4, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,.18)" }}>
          {enabledMachines.map((machine) => (
            <button key={machine.id} onClick={() => { selectMachine(machine.id); setOpen(false); }} style={{ width: "100%", display: "flex", alignItems: "center", gap: 7, padding: "7px 8px", border: "none", borderRadius: 5, background: machine.id === selectedMachine?.id ? "var(--bg-selected)" : "none", color: "var(--text)", cursor: "pointer", textAlign: "left", fontSize: 11 }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: machine.id === selectedMachine?.id ? "#4ade80" : "var(--text-dim)", flexShrink: 0 }} />
              <span style={{ minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "var(--font-mono)" }}>{machine.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
