import { short } from "./core.js";

/**
 * Format the holder column in the terminal table.
 * Returns the label (or shortened address) with an " *" marker if flagged as an insider.
 */
export function holderCell(h) {
  if (!h) return "";
  return (h.label || short(h.owner, 5)) + (h.insider ? " *" : "");
}
