"use client";

const MACHINE_HEADER = "X-Pi-Machine";
let activeMachineId: string | null = null;

function shouldRouteThroughFleet(input: RequestInfo | URL): boolean {
  const raw = input instanceof Request ? input.url : String(input);
  const url = new URL(raw, window.location.href);
  return url.origin === window.location.origin
    && url.pathname.startsWith("/api/")
    && !url.pathname.startsWith("/api/fleet/");
}

function fleetApiUrl(input: RequestInfo | URL): URL {
  const raw = input instanceof Request ? input.url : String(input);
  const url = new URL(raw, window.location.href);
  url.pathname = `/api/fleet/proxy${url.pathname.slice(4)}`;
  return url;
}

function fleetEventSourceUrl(input: string | URL, machineId: string): URL {
  const url = new URL(input, window.location.href);
  url.pathname = `/api/fleet/events/${encodeURIComponent(machineId)}${url.pathname.slice(4)}`;
  return url;
}

export function fleetResourceUrl(input: string): string {
  if (!activeMachineId || !shouldRouteThroughFleet(input)) return input;
  return fleetEventSourceUrl(input, activeMachineId).toString();
}

export function installFleetTransport(machineId: string): () => void {
  activeMachineId = machineId;
  const originalFetch = window.fetch.bind(window);
  const originalEventSource = window.EventSource;
  const originalOpen = window.open.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (!shouldRouteThroughFleet(input)) return originalFetch(input, init);
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, name) => headers.set(name, value));
    headers.set(MACHINE_HEADER, machineId);
    const target = fleetApiUrl(input);
    const routedInput = input instanceof Request
      ? new Request(target, input as unknown as RequestInit)
      : target;
    return originalFetch(routedInput, { ...init, headers });
  };
  window.EventSource = class extends originalEventSource {
    constructor(url: string | URL, eventSourceInitDict?: EventSourceInit) {
      super(
        shouldRouteThroughFleet(url) ? fleetEventSourceUrl(url, machineId) : url,
        eventSourceInitDict,
      );
    }
  };
  window.open = ((url?: string | URL, target?: string, features?: string) => {
    if (url && shouldRouteThroughFleet(url)) {
      void openFleetResource(String(url));
      return null;
    }
    return originalOpen(url, target, features);
  }) as typeof window.open;

  const interceptApiDownload = (event: MouseEvent) => {
    const anchor = (event.target as Element | null)?.closest("a[download]");
    if (!(anchor instanceof HTMLAnchorElement) || !shouldRouteThroughFleet(anchor.href)) return;
    event.preventDefault();
    event.stopPropagation();
    void openFleetResource(anchor.href, anchor.download || undefined);
  };
  document.addEventListener("click", interceptApiDownload, true);

  return () => {
    activeMachineId = null;
    window.fetch = originalFetch;
    window.EventSource = originalEventSource;
    window.open = originalOpen;
    document.removeEventListener("click", interceptApiDownload, true);
  };
}

export async function openFleetResource(url: string, filename?: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const objectUrl = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  if (filename) anchor.download = filename;
  else anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}
