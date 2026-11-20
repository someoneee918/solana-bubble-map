import test from "node:test";
import assert from "node:assert/strict";
import { holderCell } from "../lib/format.js";

test("labelled insider gets marker", () => {
  const h = { owner: "4Nd1mBQtrMJVYVfKf2PJyoxFxR5Ti3VCcasC3A28pm69", label: "Creator", insider: true };
  assert.equal(holderCell(h), "Creator *");
});

test("unlabelled insider gets shortened address with marker", () => {
  const h = { owner: "4Nd1mBQtrMJVYVfKf2PJyoxFxR5Ti3VCcasC3A28pm69", label: null, insider: true };
  assert.equal(holderCell(h), "4Nd1m…8pm69 *");
});

test("plain holder without label gets shortened address without marker", () => {
  const h = { owner: "4Nd1mBQtrMJVYVfKf2PJyoxFxR5Ti3VCcasC3A28pm69", label: null, insider: false };
  assert.equal(holderCell(h), "4Nd1m…8pm69");
});

test("plain holder with label gets label without marker", () => {
  const h = { owner: "4Nd1mBQtrMJVYVfKf2PJyoxFxR5Ti3VCcasC3A28pm69", label: "Raydium AMM", insider: false };
  assert.equal(holderCell(h), "Raydium AMM");
});
