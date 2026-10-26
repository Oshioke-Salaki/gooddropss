import { describe, it, expect } from "vitest";
import { buildBoard, boardToJson, boardFromJson } from "./board";
import { DROP_STATUS, type Drop } from "@/types";

const ZERO = "0x0000000000000000000000000000000000000000" as const;
const A = "0x00000000000000000000000000000000000000aa" as const;
const A2 = "0x00000000000000000000000000000000000000a2" as const; // A's second wallet
const B = "0x00000000000000000000000000000000000000bb" as const;
const G = 10n ** 18n;

let nextId = 1n;
function drop(p: Partial<Drop>): Drop {
  return {
    id: nextId++, dropper: A, amount: 10n * G, claimer: ZERO, expiry: 0, claimedAt: 0, createdAt: 100,
    status: DROP_STATUS.Active, lat: 0, lng: 0, hint: "", ...p,
  };
}

describe("buildBoard", () => {
  it("ranks droppers and hunters by G$ and totals everything", () => {
    const drops = [
      drop({ dropper: A, amount: 10n * G }),
      drop({ dropper: B, amount: 50n * G, claimer: A, status: DROP_STATUS.Claimed, claimedAt: 200 }),
      drop({ dropper: B, amount: 5n * G }),
    ];
    const b = buildBoard(drops, new Map());
    expect(b.droppers.map((r) => r.address)).toEqual([B, A]);
    expect(b.droppers[0]).toMatchObject({ totalWei: 55n * G, count: 2 });
    expect(b.hunters).toEqual([{ address: A, totalWei: 50n * G, count: 1 }]);
    expect(b.droppedWei).toBe(65n * G);
    expect(b.claimedWei).toBe(50n * G);
    expect(b.totalDrops).toBe(3);
    expect(b.totalClaims).toBe(1);
  });

  it("merges wallets that share an identity root and shows the latest wallet", () => {
    const roots = new Map([[A, A], [A2, A]]);
    const drops = [
      drop({ dropper: A, amount: 10n * G, createdAt: 100 }),
      drop({ dropper: A2, amount: 10n * G, createdAt: 300 }),
    ];
    const b = buildBoard(drops, roots);
    expect(b.droppers).toHaveLength(1);
    expect(b.droppers[0]).toEqual({ address: A2, totalWei: 20n * G, count: 2 });
  });

  it("ignores claimed drops with a zero claimer and breaks ties deterministically", () => {
    const drops = [
      drop({ status: DROP_STATUS.Claimed, claimer: ZERO }),
      drop({ dropper: B, amount: 10n * G }),
    ];
    const b = buildBoard(drops, new Map());
    expect(b.hunters).toEqual([]);
    expect(b.totalClaims).toBe(0);
    // A and B both dropped 10 G$ once — address order decides.
    expect(b.droppers.map((r) => r.address)).toEqual([A, B]);
  });

  it("round-trips through the wire format without losing precision", () => {
    const big = 123456789012345678901234567890n;
    const b = buildBoard([drop({ amount: big })], new Map());
    const back = boardFromJson(JSON.parse(JSON.stringify(boardToJson(b, 1))));
    expect(back).toEqual(b);
  });
});
