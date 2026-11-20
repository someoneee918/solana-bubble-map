#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { c, footer, isAddress, main, pad, parseArgs, short, table } from "../lib/core.js";
import { buildClusters, fetchHolders, sharedBusyFunders, summarize, traceFunders } from "../lib/holders.js";
import { renderHtml } from "../lib/render.js";
import { holderCell } from "../lib/format.js";

const HELP = `solana-bubble-map: holder bubble map for any Solana token

Usage:
  bubble-map <mint> [options]

Options:
  --top <n>      Holders to map, 5 to 20 (default 20)
  --out <file>   Where to write the HTML page (default bubble-map-<SYMBOL>.html)
  --no-links     Skip funder tracing: instant, but no wallet links
  --depth <n>    Pages of 1,000 transactions to read per wallet when looking
                 for its first funder, 1 to 10 (default 2)
  --group-busy   Also group wallets whose shared funder is a high-activity
                 wallet (an exchange, an app or a distributor)
  --open         Open the page in your browser when done
  --json         Print the data as JSON instead of writing a page
  --help         Show this help

Environment:
  SOLANA_RPC_URL   Your own RPC endpoint (faster tracing than the public one)
`;

main(async () => {
  const args = parseArgs(process.argv.slice(2), { booleans: ["open", "json", "help", "group-busy"] });
  const mint = args._[0];
  if (args.help || !mint) { console.log(HELP); process.exit(mint || args.help ? 0 : 1); }
  if (!isAddress(mint)) throw new Error(`"${mint}" is not a Solana address.`);
  const top = Math.max(5, Math.min(20, Number(args.top) || 20));
  const log = args.json ? () => {} : (s) => console.error(s);

  log(c.dim(`Loading top ${top} holders…`));
  const data = await fetchHolders(mint, top);

  let busy = new Set();
  if (args.links !== false) {
    const pages = Math.max(1, Math.min(10, Number(args.depth) || 2));
    busy = await traceFunders(data.holders, (i, n) => {
      if (!args.json && process.stderr.isTTY) process.stderr.write(`\r${c.dim(`Tracing who funded each wallet ${i}/${n}…`)}`);
    }, { pages });
    if (!args.json && process.stderr.isTTY) process.stderr.write("\r" + " ".repeat(60) + "\r");
  }
  const { links, clusters } = buildClusters(data.holders, busy, { includeBusy: Boolean(args["group-busy"]) });
  const summary = summarize(data.holders, clusters);
  const sharedBusy = args["group-busy"] ? [] : sharedBusyFunders(data.holders, busy);
  const result = { ...data, links, clusters, summary, sharedBusy, generatedAt: new Date().toISOString() };

  if (args.json) { console.log(JSON.stringify(result, null, 2)); return; }

  console.log(`\n${c.bold(`${data.name} (${data.symbol})`)}  ${c.dim(mint)}`);
  console.log(
    `Top 10 wallets ${c.bold(summary.top10Pct.toFixed(1) + "%")}  ·  largest wallet ${summary.largestWalletPct.toFixed(1)}%  ·  in pools ${summary.poolPct.toFixed(1)}%` +
    (data.totalHolders != null ? `  ·  ${Number(data.totalHolders).toLocaleString()} holders` : "") + "\n",
  );
  table(
    [{ title: "#", width: 3, right: true }, { title: "Holder", width: 24 }, { title: "Share", width: 7, right: true }, { title: "Group", width: 8 }, { title: "Funded by", width: 30 }],
    data.holders.map((h) => [
      h.rank,
      holderCell(h),
      h.pct.toFixed(2) + "%",
      h.kind === "AMM" ? c.dim("pool") : h.cluster ? c.yellow("group " + h.cluster) : "",
      h.funder ? short(h.funder, 5) + (busy.has(h.funder) ? c.dim(" (busy)") : "") : c.dim(h.funderNote || ""),
    ]),
  );
  if (data.holders.some((h) => h.insider)) console.log(c.dim("* flagged as an insider by RugCheck"));

  console.log("");
  if (!clusters.length) {
    console.log(args.links === false ? c.dim("Funder tracing skipped (--no-links).") : c.green("No linked wallet groups found among the top holders."));
  } else {
    for (const cl of clusters) {
      const line = `Group ${cl.id}: ${cl.wallets.length} linked wallets hold ${cl.pct.toFixed(2)}%`;
      console.log((cl.pct >= 10 ? c.red : c.yellow)(pad(line, 60)) + c.dim(cl.wallets.map((w) => short(w)).join(", ")));
    }
  }

  for (const f of sharedBusy) {
    console.log(c.yellow(`${f.wallets} of these wallets (${f.pct.toFixed(2)}% of supply) were first funded by the same high-activity wallet ${short(f.funder, 5)}.`));
    console.log(c.dim("  That wallet may be an exchange, a trading app or a distributor, so they are not grouped. Use --group-busy to group them."));
  }

  const file = resolve(String(args.out || `bubble-map-${String(data.symbol).replace(/[^\w-]/g, "") || "token"}.html`));
  writeFileSync(file, renderHtml(result));
  console.log(`\nBubble map written to ${c.cyan(file)}`);
  if (args.open) {
    const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
    const cmdArgs = process.platform === "win32" ? ["/c", "start", "", file] : [file];
    spawn(cmd, cmdArgs, { stdio: "ignore", detached: true }).on("error", () => {}).unref();
  }
  footer("/memecoin-analytics", "Live holder ledgers, bundle and sniper tags");
});
