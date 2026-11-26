import { describe, expect, it } from "vitest";
import { rewardGasStatus, rewardFundsStatus, TRANSFER_GAS, LOW_PAYOUTS, CRITICAL_PAYOUTS, LOW_G, CRITICAL_G } from "@/lib/rewardGas";

const gwei = (n: number) => BigInt(n) * 10n ** 9n;
const celo = (n: number) => BigInt(Math.round(n * 1e4)) * 10n ** 14n;

describe("reward wallet gas", () => {
  it("flags the Nov 2026 outage as critical (0.0436 CELO at 202.5 gwei)", () => {
    const s = rewardGasStatus(celo(0.0436), 2025n * 10n ** 8n);
    expect(s.level).toBe("critical");
    expect(s.payoutsLeft).toBe(0);
    expect(Number(s.topUpCelo)).toBeGreaterThan(4);
  });
  it("counts payouts left at today's price", () => {
    const per = gwei(200) * TRANSFER_GAS;
    expect(rewardGasStatus(per * 10n, gwei(200)).payoutsLeft).toBe(10);
    expect(rewardGasStatus(per * BigInt(CRITICAL_PAYOUTS), gwei(200)).level).toBe("low");
    expect(rewardGasStatus(per * BigInt(LOW_PAYOUTS), gwei(200)).level).toBe("ok");
  });
  it("cheap gas makes the same balance healthy", () => {
    expect(rewardGasStatus(celo(0.5), gwei(25)).level).toBe("ok");
    expect(rewardGasStatus(celo(0.5), gwei(25)).topUpCelo).toBe("0.0000");
  });
  it("formats CELO and gwei", () => {
    const s = rewardGasStatus(celo(5.0436), gwei(202));
    expect(s.celo).toBe("5.0436");
    expect(s.gwei).toBe(202);
  });
  it("flags the 26 Nov G$ outage (50 G$) as critical, and a full wallet as ok", () => {
    const G = (n: number) => BigInt(n) * 10n ** 18n;
    expect(rewardFundsStatus(G(50))).toEqual({ gLevel: "critical", g: 50, topUpG: 299_950 });
    expect(rewardFundsStatus(G(CRITICAL_G)).gLevel).toBe("low");
    expect(rewardFundsStatus(G(LOW_G)).gLevel).toBe("ok");
    expect(rewardFundsStatus(G(259_050))).toEqual({ gLevel: "ok", g: 259_050, topUpG: 0 });
  });
});
