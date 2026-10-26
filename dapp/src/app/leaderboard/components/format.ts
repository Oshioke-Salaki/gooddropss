import { formatG$ } from "@/lib/utils";

/**
 * The board's G$ figure: "156.3K".
 *
 * Module-level and dependency-free on purpose — passing it down as a prop would
 * hand every row a new function identity on each render and defeat React.memo.
 */
export function amountG(wei: bigint): string {
  return formatG$(wei).replace("k", "K");
}

/** Full grouped number for the headline stat: 850127 → "850,127". */
export function fullG(wei: bigint): string {
  return (Number(wei) / 1e18).toLocaleString("en-US", { maximumFractionDigits: 0 });
}
