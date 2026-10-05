type Options = {
  cwd?: string;
  env?: Record<string, string>;
  cols?: number;
  rows?: number;
  name?: string;
};
type Exit = { exitCode: number };
export function installPtyAdapter() {
  Bun.plugin({
    name: "fleet-pty",
    setup(builder) {
      builder.module("node-pty", () => ({
        exports: { spawn },
        loader: "object",
      }));
    },
  });
}
export function spawn(file: string, args: string[], options: Options) {
  const dataListeners = new Set<(text: string) => void>();
  const exitListeners = new Set<(event: Exit) => void>();
  const decoder = new TextDecoder();
  const child = Bun.spawn([file, ...args], {
    cwd: options.cwd,
    env: options.env,
    terminal: {
      cols: options.cols,
      rows: options.rows,
      name: options.name,
      data(_terminal, data) {
        const text = decoder.decode(data, { stream: true });
        for (const listener of dataListeners) listener(text);
      },
    },
  });
  const terminal = child.terminal!;
  child.exited.then((exitCode) => {
    const tail = decoder.decode();
    if (tail) for (const listener of dataListeners) listener(tail);
    for (const listener of exitListeners) listener({ exitCode });
    terminal.close();
  });
  return {
    pid: child.pid,
    write: (data: string) => terminal.write(data),
    resize: (cols: number, rows: number) => terminal.resize(cols, rows),
    kill: (signal?: NodeJS.Signals) => child.kill(signal || "SIGHUP"),
    onData(listener: (text: string) => void) {
      dataListeners.add(listener);
      return { dispose: () => dataListeners.delete(listener) };
    },
    onExit(listener: (event: Exit) => void) {
      exitListeners.add(listener);
      return { dispose: () => exitListeners.delete(listener) };
    },
  };
}
