"use client";

import { useEffect, useRef, useState } from "react";
import { useFleet } from "@/hooks/useFleet";
import { useI18n } from "@/hooks/useI18n";
import { checkFleetHealth, getFleetHealth, subscribeFleetHealth } from "@/lib/fleet-health.mjs";

function MachineStatus({ id, chinese }: { id: string; chinese: boolean }) {
  const health = getFleetHealth(id);
  const descriptions: Record<string, [string, string, string]> = {
    online: ["#4ade80", "连接正常", "Connected"],
    offline: ["#f87171", "无法连接", "Unreachable"],
    error: ["#fbbf24", "认证或响应异常", "Authentication or response error"],
    checking: ["#fbbf24", "检查中", "Checking"],
    unknown: ["var(--text-dim)", "尚未检查或状态已过期", "Not checked or status expired"],
  };
  const [color, zh, en] = descriptions[health.status];
  const detail = health.checkedAt ? ` · ${new Date(health.checkedAt).toLocaleTimeString()}` : "";
  const label = (chinese ? zh : en) + detail;
  return <span role="img" aria-label={label} title={label} data-fleet-status={health.status} style={{ width: 7, height: 7, borderRadius: "50%", background: color, flexShrink: 0 }} />;
}

export function MachineSelector() {
  const { machines, selectedMachine, selectMachine } = useFleet();
  const { locale } = useI18n();
  const [open, setOpen] = useState(false);
  const [, refreshHealth] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const enabledMachines = machines.filter((machine) => machine.enabled);

  useEffect(() => subscribeFleetHealth(() => refreshHealth((value) => value + 1)), []);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    for (const machine of machines) {
      if (machine.enabled) void checkFleetHealth(machine.id, controller.signal);
    }
    return () => controller.abort();
  }, [open, machines]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);

  if (!selectedMachine) return null;

  return (
    <div style={{ padding: "8px 10px 0", flexShrink: 0 }}>
    <div ref={rootRef} style={{ position: "relative", display: "flex", marginBottom: 6 }}>
      <button
        onClick={() => setOpen((value) => !value)}
        title={selectedMachine?.name}
        aria-label={selectedMachine.name}
        style={{
          minWidth: 0, flex: 1, height: 29, display: "flex", alignItems: "center", gap: 7,
          padding: "0 9px", background: "var(--bg-panel)", border: "1px solid var(--border)",
          borderRadius: 7, color: "var(--text)", cursor: "pointer", textAlign: "left", fontSize: 11,
        }}
      >
        <MachineStatus id={selectedMachine.id} chinese={locale.startsWith("zh")} />
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "var(--font-mono)" }}>
          {selectedMachine?.name ?? (locale.startsWith("zh") ? "选择机器…" : "Select machine…")}
        </span>
        <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--text-dim)", flexShrink: 0 }}><polyline points="2 3.5 5 6.5 8 3.5" /></svg>
      </button>
      {open && (
        <div style={{ position: "absolute", top: 33, left: 0, right: 0, zIndex: 120, padding: 4, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,.18)" }}>
          {enabledMachines.map((machine) => (
            <button key={machine.id} aria-label={machine.name} onClick={() => { selectMachine(machine.id); setOpen(false); }} style={{ width: "100%", display: "flex", alignItems: "center", gap: 7, padding: "7px 8px", border: "none", borderRadius: 5, background: machine.id === selectedMachine?.id ? "var(--bg-selected)" : "none", color: "var(--text)", cursor: "pointer", textAlign: "left", fontSize: 11 }}>
              <MachineStatus id={machine.id} chinese={locale.startsWith("zh")} />
              <span style={{ minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "var(--font-mono)" }}>{machine.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
    </div>
  );
}
