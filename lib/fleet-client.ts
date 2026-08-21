"use client";

const MACHINE_HEADER = "X-Pi-Machine";

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

export function installFleetTransport(machineId: string): () => void {
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
  window.EventSource = FleetEventSource as unknown as typeof window.EventSource;
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
    window.fetch = originalFetch;
    window.EventSource = originalEventSource;
    window.open = originalOpen;
    document.removeEventListener("click", interceptApiDownload, true);
  };
}

interface ParsedEvent {
  type: string;
  data: string;
  id: string;
}

function parseEventBlock(block: string): ParsedEvent | null {
  let type = "message";
  let id = "";
  const data: string[] = [];
  for (const line of block.split("\n")) {
    if (!line || line.startsWith(":")) continue;
    const separator = line.indexOf(":");
    const field = separator < 0 ? line : line.slice(0, separator);
    const value = separator < 0 ? "" : line.slice(separator + 1).replace(/^ /, "");
    if (field === "event") type = value || "message";
    else if (field === "data") data.push(value);
    else if (field === "id") id = value;
  }
  if (data.length === 0) return null;
  return { type, data: data.join("\n"), id };
}

export class FleetEventSource extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;

  readyState = FleetEventSource.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  private controller: AbortController | null = null;
  private closed = false;

  constructor(private readonly url: string) {
    super();
    void this.connect();
  }

  close(): void {
    this.closed = true;
    this.readyState = FleetEventSource.CLOSED;
    this.controller?.abort();
  }

  private emit(event: Event): void {
    this.dispatchEvent(event);
    if (event.type === "open") this.onopen?.(event);
    else if (event.type === "message") this.onmessage?.(event as MessageEvent<string>);
    else if (event.type === "error") this.onerror?.(event);
  }

  private async connect(): Promise<void> {
    while (!this.closed) {
      this.controller = new AbortController();
      this.readyState = FleetEventSource.CONNECTING;
      try {
        const response = await fetch(this.url, {
          headers: { Accept: "text/event-stream" },
          cache: "no-store",
          signal: this.controller.signal,
        });
        if (!response.ok || !response.body) throw new Error(`SSE request failed: HTTP ${response.status}`);
        this.readyState = FleetEventSource.OPEN;
        this.emit(new Event("open"));

        const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
        let buffer = "";
        while (!this.closed) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
          let boundary = buffer.indexOf("\n\n");
          while (boundary >= 0) {
            const parsed = parseEventBlock(buffer.slice(0, boundary));
            buffer = buffer.slice(boundary + 2);
            if (parsed) {
              const event = new MessageEvent(parsed.type, { data: parsed.data, lastEventId: parsed.id });
              this.dispatchEvent(event);
              if (parsed.type === "message") this.onmessage?.(event);
            }
            boundary = buffer.indexOf("\n\n");
          }
        }
      } catch (error) {
        if (this.closed || (error instanceof DOMException && error.name === "AbortError")) return;
      }
      if (this.closed) return;
      this.emit(new Event("error"));
      await new Promise((resolve) => window.setTimeout(resolve, 1_000));
    }
  }
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
