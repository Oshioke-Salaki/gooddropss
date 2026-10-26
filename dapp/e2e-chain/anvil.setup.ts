import { spawn, type ChildProcess } from "node:child_process";

// Starts a throwaway anvil fork of Celo mainnet for the money-path suite and
// tears it down afterwards. The fork lives only in this process's memory.
export const FORK_PORT = Number(process.env.FORK_PORT ?? 8547);
const UPSTREAM = process.env.FORK_UPSTREAM ?? "https://forno.celo.org";

let anvil: ChildProcess | null = null;

async function ready(url: string, ms: number) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      });
      if (r.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`anvil did not start on ${url}`);
}

export default async function setup() {
  const bin = process.env.ANVIL_BIN ?? `${process.env.HOME}/.foundry/bin/anvil`;
  anvil = spawn(bin, ["--fork-url", UPSTREAM, "--port", String(FORK_PORT), "--chain-id", "42220", "--silent"], {
    stdio: "ignore",
  });
  anvil.on("error", (e) => { throw new Error(`could not start anvil (${bin}): ${e.message}`); });
  await ready(`http://127.0.0.1:${FORK_PORT}`, 60_000);
  return () => { anvil?.kill("SIGTERM"); };
}
