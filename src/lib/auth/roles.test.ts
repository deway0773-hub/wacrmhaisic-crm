import { describe, expect, it } from "vitest";
import {
  ACCOUNT_ROLES,
  CREATABLE_ROLES,
  type AccountRole,
  canDeleteAccount,
  canEditSettings,
  canManageMembers,
  canSendMessages,
  canTransferOwnership,
  hasMinRole,
  isAccountRole,
  roleRank,
} from "./roles";

describe("roleRank", () => {
  it("orders owner > operator > agent", () => {
    expect(roleRank("owner")).toBeGreaterThan(roleRank("operator"));
    expect(roleRank("operator")).toBeGreaterThan(roleRank("agent"));
  });

  it("matches the SQL helper's numeric mapping", () => {
    // Keep these in lockstep with `is_account_member`'s CASE expression
    // in supabase/migrations — any change here means the SQL helper
    // needs the same change.
    expect(roleRank("owner")).toBe(3);
    expect(roleRank("operator")).toBe(2);
    expect(roleRank("agent")).toBe(1);
  });
});

describe("hasMinRole", () => {
  it("returns true when role meets the threshold", () => {
    expect(hasMinRole("owner", "agent")).toBe(true);
    expect(hasMinRole("operator", "agent")).toBe(true);
    expect(hasMinRole("agent", "agent")).toBe(true);
  });

  it("returns false when role is below the threshold", () => {
    expect(hasMinRole("agent", "operator")).toBe(false);
    expect(hasMinRole("agent", "owner")).toBe(false);
    expect(hasMinRole("operator", "owner")).toBe(false);
  });

  // The full matrix — useful as a regression net if anyone reshuffles
  // the rank table.
  it.each<[AccountRole, AccountRole, boolean]>([
    ["owner", "owner", true],
    ["owner", "operator", true],
    ["owner", "agent", true],
    ["operator", "owner", false],
    ["operator", "operator", true],
    ["operator", "agent", true],
    ["agent", "owner", false],
    ["agent", "operator", false],
    ["agent", "agent", true],
  ])("%s vs min %s → %s", (role, min, expected) => {
    expect(hasMinRole(role, min)).toBe(expected);
  });
});

describe("isAccountRole", () => {
  it("accepts every value in ACCOUNT_ROLES", () => {
    for (const role of ACCOUNT_ROLES) {
      expect(isAccountRole(role)).toBe(true);
    }
  });

  it("rejects garbage / case mismatch / non-strings", () => {
    expect(isAccountRole("Owner")).toBe(false);
    expect(isAccountRole("")).toBe(false);
    expect(isAccountRole(null)).toBe(false);
    expect(isAccountRole(undefined)).toBe(false);
    expect(isAccountRole(123)).toBe(false);
    expect(isAccountRole("superuser")).toBe(false);
    expect(isAccountRole("viewer")).toBe(false);
  });

  it("rejects the retired admin role", () => {
    expect(isAccountRole("admin")).toBe(false);
  });
});

describe("CREATABLE_ROLES", () => {
  it("is exactly operator + agent", () => {
    expect([...CREATABLE_ROLES]).toEqual(["operator", "agent"]);
  });

  it("never includes owner", () => {
    expect(CREATABLE_ROLES).not.toContain("owner");
  });
});

describe("capability predicates", () => {
  it("canManageMembers: owner only", () => {
    expect(canManageMembers("owner")).toBe(true);
    expect(canManageMembers("operator")).toBe(false);
    expect(canManageMembers("agent")).toBe(false);
  });

  it("canEditSettings: owner only", () => {
    expect(canEditSettings("owner")).toBe(true);
    expect(canEditSettings("operator")).toBe(false);
    expect(canEditSettings("agent")).toBe(false);
  });

  it("canSendMessages: agent+ only", () => {
    expect(canSendMessages("owner")).toBe(true);
    expect(canSendMessages("operator")).toBe(true);
    expect(canSendMessages("agent")).toBe(true);
  });

  it("canDeleteAccount: owner only", () => {
    expect(canDeleteAccount("owner")).toBe(true);
    expect(canDeleteAccount("operator")).toBe(false);
    expect(canDeleteAccount("agent")).toBe(false);
  });

  it("canTransferOwnership: owner only", () => {
    expect(canTransferOwnership("owner")).toBe(true);
    expect(canTransferOwnership("operator")).toBe(false);
    expect(canTransferOwnership("agent")).toBe(false);
  });
});
