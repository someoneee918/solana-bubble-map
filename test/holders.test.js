import test from "node:test";
import assert from "node:assert/strict";

process.env.SOLANA_RPC_GAP_MS = "0";

let mockRugCheckReport = null;
let mockRpcHandler = null;

globalThis.fetch = async (url, options = {}) => {
  const urlStr = String(url);
  if (urlStr.includes("rugcheck.xyz")) {
    const report = typeof mockRugCheckReport === "function" ? mockRugCheckReport(urlStr, options) : mockRugCheckReport;
    return {
      status: 200,
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => report,
      text: async () => JSON.stringify(report),
    };
  }
  if (mockRpcHandler) {
    const body = options.body ? JSON.parse(options.body) : {};
    return mockRpcHandler(body, urlStr, options);
  }
  throw new Error(`Unexpected fetch to ${urlStr}`);
};

const { fetchHolders } = await import("../lib/holders.js");

const defaultRpc = (mint, accountsInfo, supplyStr = "1000") => (body) => {
  if (body.method === "getMultipleAccounts") {
    return {
      status: 200,
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      text: async () =>
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: { value: accountsInfo },
        }),
    };
  }
  if (body.method === "getTokenSupply") {
    return {
      status: 200,
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      text: async () =>
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: { value: { uiAmountString: supplyStr } },
        }),
    };
  }
  throw new Error(`Unhandled RPC method ${body.method}`);
};

test("throws when the report has no holders", async () => {
  mockRugCheckReport = { topHolders: [] };
  mockRpcHandler = defaultRpc("MINT_A", []);
  await assert.rejects(
    () => fetchHolders("MINT_A"),
    /No holder data for this mint. Check the address is a Solana token mint./,
  );
});

test("an account that is closed or holds another mint is dropped", async () => {
  const mint = "MINT_VALID";
  mockRugCheckReport = {
    tokenMeta: { name: "Test Token", symbol: "TEST" },
    topHolders: [
      { address: "ACCT_1", owner: "OWNER_1", uiAmount: 100, pct: 10 },
      { address: "ACCT_CLOSED", owner: "OWNER_2", uiAmount: 50, pct: 5 },
      { address: "ACCT_DIFF_MINT", owner: "OWNER_3", uiAmount: 50, pct: 5 },
    ],
  };

  mockRpcHandler = defaultRpc(mint, [
    { data: { parsed: { info: { mint, owner: "OWNER_1", tokenAmount: { uiAmountString: "100" } } } } },
    null, // closed account
    { data: { parsed: { info: { mint: "MINT_OTHER", owner: "OWNER_3", tokenAmount: { uiAmountString: "50" } } } } }, // wrong mint
  ]);

  const res = await fetchHolders(mint);
  assert.equal(res.holders.length, 1);
  assert.equal(res.holders[0].owner, "OWNER_1");
  assert.equal(res.holders[0].account, "ACCT_1");
});

test("an account with a zero balance is dropped", async () => {
  const mint = "MINT_VALID";
  mockRugCheckReport = {
    tokenMeta: { name: "Test Token", symbol: "TEST" },
    topHolders: [
      { address: "ACCT_ACTIVE", owner: "OWNER_ACTIVE", uiAmount: 100, pct: 10 },
      { address: "ACCT_ZERO", owner: "OWNER_ZERO", uiAmount: 0, pct: 0 },
    ],
  };

  mockRpcHandler = defaultRpc(mint, [
    { data: { parsed: { info: { mint, owner: "OWNER_ACTIVE", tokenAmount: { uiAmountString: "100" } } } } },
    { data: { parsed: { info: { mint, owner: "OWNER_ZERO", tokenAmount: { uiAmountString: "0" } } } } },
  ]);

  const res = await fetchHolders(mint);
  assert.equal(res.holders.length, 1);
  assert.equal(res.holders[0].owner, "OWNER_ACTIVE");
  assert.equal(res.holders[0].amount, 100);
});

test("pct is recomputed from live supply", async () => {
  const mint = "MINT_VALID";
  mockRugCheckReport = {
    token: { supply: "1000", decimals: 0 },
    tokenMeta: { name: "Test Token", symbol: "TEST" },
    topHolders: [
      { address: "ACCT_1", owner: "OWNER_1", uiAmount: 50, pct: 5 },
    ],
  };

  // Live supply is 200, so 50 tokens is 25% of supply
  mockRpcHandler = defaultRpc(mint, [
    { data: { parsed: { info: { mint, owner: "OWNER_1", tokenAmount: { uiAmountString: "50" } } } } },
  ], "200");

  const res = await fetchHolders(mint);
  assert.equal(res.holders.length, 1);
  assert.equal(res.holders[0].pct, 25);
});

test("when the RPC fails, the code falls back to the report and drops System Program placeholder owners", async () => {
  const mint = "MINT_VALID";
  mockRugCheckReport = {
    tokenMeta: { name: "Test Token", symbol: "TEST" },
    topHolders: [
      { address: "ACCT_1", owner: "OWNER_REAL", uiAmount: 100, pct: 50 },
      { address: "ACCT_SYS", owner: "11111111111111111111111111111111", uiAmount: 100, pct: 50 },
    ],
  };

  // RPC returns error
  mockRpcHandler = (body) => ({
    status: 200,
    ok: true,
    headers: new Headers({ "content-type": "application/json" }),
    text: async () =>
      JSON.stringify({
        jsonrpc: "2.0",
        id: body.id,
        error: { code: -32600, message: "RPC endpoint temporarily unavailable" },
      }),
  });

  const res = await fetchHolders(mint);
  assert.equal(res.holders.length, 1);
  assert.equal(res.holders[0].owner, "OWNER_REAL");
  assert.equal(res.holders[0].pct, 50);
});

test("labels and kind come from knownAccounts by owner or by token account", async () => {
  const mint = "MINT_VALID";
  mockRugCheckReport = {
    tokenMeta: { name: "Test Token", symbol: "TEST" },
    knownAccounts: {
      OWNER_RAYDIUM: { name: "Raydium AMM", type: "AMM" },
      ACCT_CREATOR: { name: "Deployer", type: "CREATOR" },
    },
    topHolders: [
      { address: "ACCT_1", owner: "OWNER_RAYDIUM", uiAmount: 60, pct: 60 },
      { address: "ACCT_CREATOR", owner: "OWNER_DEV", uiAmount: 40, pct: 40 },
    ],
  };

  mockRpcHandler = defaultRpc(mint, [
    { data: { parsed: { info: { mint, owner: "OWNER_RAYDIUM", tokenAmount: { uiAmountString: "60" } } } } },
    { data: { parsed: { info: { mint, owner: "OWNER_DEV", tokenAmount: { uiAmountString: "40" } } } } },
  ], "100");

  const res = await fetchHolders(mint);
  assert.equal(res.holders.length, 2);
  assert.equal(res.holders[0].label, "Raydium AMM");
  assert.equal(res.holders[0].kind, "AMM");
  assert.equal(res.holders[1].label, "Deployer");
  assert.equal(res.holders[1].kind, "CREATOR");
});

test("throws when no live holders remain", async () => {
  const mint = "MINT_VALID";
  mockRugCheckReport = {
    tokenMeta: { name: "Test Token", symbol: "TEST" },
    topHolders: [
      { address: "ACCT_CLOSED", owner: "OWNER_1", uiAmount: 100, pct: 10 },
    ],
  };

  // RPC returns all accounts closed
  mockRpcHandler = defaultRpc(mint, [null]);

  await assert.rejects(
    () => fetchHolders(mint),
    /No live holder accounts found for this mint./,
  );
});
