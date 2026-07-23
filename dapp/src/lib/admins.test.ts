import { describe, it, expect } from "vitest";
import { isAdminAddress } from "@/lib/admins";

// Built-in admin allowlist (see lib/admins.ts). NEXT_PUBLIC_ADMIN_ADDRESSES is
// unset under test, so only these should pass.
const BUILTIN = "0xb2914810724fe2fb871960eb200dea427854b1c7";

describe("isAdminAddress", () => {
  it("accepts a built-in admin regardless of case", () => {
    expect(isAdminAddress(BUILTIN)).toBe(true);
    expect(isAdminAddress(BUILTIN.toUpperCase().replace("0X", "0x"))).toBe(true);
    expect(isAdminAddress("0xB2914810724FE2FB871960EB200DEA427854B1C7")).toBe(true);
  });

  it("rejects a non-admin address", () => {
    expect(isAdminAddress("0x000000000000000000000000000000000000dead")).toBe(false);
  });

  it("rejects null / undefined / empty without throwing", () => {
    expect(isAdminAddress(null)).toBe(false);
    expect(isAdminAddress(undefined)).toBe(false);
    expect(isAdminAddress("")).toBe(false);
  });
});
