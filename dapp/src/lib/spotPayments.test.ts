import { describe, it, expect } from "vitest";
import { encodeAbiParameters, encodeEventTopics, parseAbi, type Hex } from "viem";
import { milliToWei, sumTokenTransfersTo, weiToMilli, type ReceiptLog } from "./spotPayments";

const ABI = parseAbi(["event Transfer(address indexed from, address indexed to, uint256 value)"]);
const TOKEN = "0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A";
const SHOP = "0x1111111111111111111111111111111111111111";
const ALICE = "0x2222222222222222222222222222222222222222";
const BOB = "0x3333333333333333333333333333333333333333";
const G = 10n ** 18n;

function transfer(from: string, to: string, value: bigint, token = TOKEN): ReceiptLog {
  return {
    address: token,
    topics: encodeEventTopics({ abi: ABI, eventName: "Transfer", args: { from: from as Hex, to: to as Hex } }) as Hex[],
    data: encodeAbiParameters([{ type: "uint256" }], [value]),
  };
}

describe("sumTokenTransfersTo", () => {
  it("reads the payer and amount of a G$ payment to the shop", () => {
    expect(sumTokenTransfersTo([transfer(ALICE, SHOP, 25n * G)], TOKEN, SHOP)).toEqual({ payer: ALICE, amount: 25n * G });
  });

  it("matches addresses case-insensitively", () => {
    expect(sumTokenTransfersTo([transfer(ALICE, SHOP, 5n * G)], TOKEN.toLowerCase(), SHOP.toUpperCase().replace("0X", "0x"))?.amount).toBe(5n * G);
  });

  it("ignores other tokens and other recipients", () => {
    const logs = [transfer(ALICE, SHOP, 9n * G, "0x4444444444444444444444444444444444444444"), transfer(ALICE, BOB, 3n * G)];
    expect(sumTokenTransfersTo(logs, TOKEN, SHOP)).toBeNull();
  });

  it("adds up several transfers from the same payer", () => {
    expect(sumTokenTransfersTo([transfer(ALICE, SHOP, 2n * G), transfer(ALICE, SHOP, 3n * G)], TOKEN, SHOP)?.amount).toBe(5n * G);
  });

  it("refuses a receipt that pays the shop from two different wallets", () => {
    expect(sumTokenTransfersTo([transfer(ALICE, SHOP, 2n * G), transfer(BOB, SHOP, 3n * G)], TOKEN, SHOP)).toBeNull();
  });

  it("skips logs that aren't Transfer events", () => {
    const junk: ReceiptLog = { address: TOKEN, topics: ["0x" + "ab".repeat(32) as Hex], data: "0x" };
    expect(sumTokenTransfersTo([junk, transfer(ALICE, SHOP, 1n * G)], TOKEN, SHOP)?.amount).toBe(1n * G);
  });
});

describe("milli conversions", () => {
  it("round-trips to the nearest 0.001 G$", () => {
    expect(weiToMilli(1234n * 10n ** 15n)).toBe(1234);
    expect(milliToWei(1234)).toBe(1234n * 10n ** 15n);
    expect(milliToWei("1234")).toBe(1234n * 10n ** 15n);
    expect(weiToMilli(999n)).toBe(0);
    expect(milliToWei(0)).toBe(0n);
  });
});
