export function nodeCliInvocation(name: "npm" | "npx", args: string[]) {
  return { command: name, args };
}
