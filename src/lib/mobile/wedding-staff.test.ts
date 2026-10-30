import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceAccessDeniedError } from "@/domain/workspace";
import { weddingStaffTimelineAssignmentFingerprint } from "@/domain/wedding-staff-timeline-snapshot";

const mocks = vi.hoisted(() => ({ transaction: vi.fn(), access: vi.fn(), create: vi.fn(), find: vi.fn(), update: vi.fn(), remove: vi.fn(), query: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock("@/lib/workspace-mutation-access", () => ({ requireLockedWorkspaceAccess: mocks.access }));
import { mobileCreateStaff, mobileUpdateStaff, mobileDeleteStaff } from "./wedding-staff";

const details = { roleName: "招待", personName: "合成人員", contactPhone: null, notes: "合成備註", needsMeal: true,
  mealCount: "3", vegetarianMealCount: "1", redEnvelopeAmount: "2000" };
const tx = { weddingStaffAssignment: { create: mocks.create, findFirst: mocks.find, updateMany: mocks.update, deleteMany: mocks.remove }, $queryRaw: mocks.query };
const fingerprint = weddingStaffTimelineAssignmentFingerprint(["timeline-one"]);

describe("mobile staff editing", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.transaction.mockImplementation(async (operation) => operation(tx));
    mocks.create.mockResolvedValue({ id: "staff", version: 0 });
    mocks.find.mockResolvedValue({ version: 2, redEnvelopeSentAt: null });
    mocks.update.mockResolvedValue({ count: 1 });
    mocks.remove.mockResolvedValue({ count: 1 });
    mocks.query.mockResolvedValueOnce([{ id: "staff" }]).mockResolvedValueOnce([{ timelineItemId: "timeline-one" }]);
  });

  it("creates scoped staff only after locked editor authorization and shares web validation", async () => {
    expect(await mobileCreateStaff("workspace", "authenticated", details)).toEqual({ id: "staff", version: 0 });
    expect(mocks.access).toHaveBeenCalledWith("workspace", "authenticated", "edit", tx);
    expect(mocks.access.mock.invocationCallOrder[0]).toBeLessThan(mocks.create.mock.invocationCallOrder[0]);
    expect(mocks.create).toHaveBeenCalledWith({ data: { workspaceId: "workspace", roleName: "招待", personName: "合成人員",
      contactPhone: null, notes: "合成備註", mealCount: 3, vegetarianMealCount: 1, redEnvelopeAmount: 2000 }, select: { id: true, version: true } });
  });

  it.each(["userId", "workspaceId", "role", "redEnvelopeSentAt", "redEnvelopeSent"])("rejects forged %s", async (field) => {
    await expect(mobileCreateStaff("workspace", "authenticated", { ...details, [field]: "forged" })).rejects.toMatchObject({ status: 400 });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("does not let viewers or nonmembers write", async () => {
    mocks.access.mockRejectedValue(new WorkspaceAccessDeniedError());
    await expect(mobileCreateStaff("workspace", "viewer", details)).rejects.toBeInstanceOf(WorkspaceAccessDeniedError);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it.each([{ personName: "" }, { roleName: "" }, { mealCount: "0" }, { vegetarianMealCount: "4" }, { redEnvelopeAmount: "0" }, { notes: 42 }])("rejects invalid details: %s", async (invalid) => {
    await expect(mobileCreateStaff("workspace", "authenticated", { ...details, ...invalid })).rejects.toMatchObject({ status: 400 });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("updates with workspace, record and version CAS without changing handout time", async () => {
    await mobileUpdateStaff("workspace", "authenticated", "staff", { ...details, expectedVersion: 2 });
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: "staff", workspaceId: "workspace", version: 2 },
      data: expect.objectContaining({ version: { increment: 1 }, personName: details.personName }) });
    expect(mocks.update.mock.calls[0][0].data).not.toHaveProperty("redEnvelopeSentAt");
  });

  it("rejects clearing an already handed-out envelope", async () => {
    mocks.find.mockResolvedValue({ version: 2, redEnvelopeSentAt: new Date() });
    await expect(mobileUpdateStaff("workspace", "authenticated", "staff", { ...details, redEnvelopeAmount: "", expectedVersion: 2 }))
      .rejects.toMatchObject({ status: 400 });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("rejects concurrent updates instead of overwriting", async () => {
    mocks.update.mockResolvedValue({ count: 0 });
    await expect(mobileUpdateStaff("workspace", "authenticated", "staff", { ...details, expectedVersion: 2 })).rejects.toMatchObject({ status: 409 });
  });

  it("locks and checks the timeline assignment snapshot before deleting", async () => {
    await mobileDeleteStaff("workspace", "authenticated", "staff", { expectedVersion: 2, timelineAssignmentFingerprint: fingerprint });
    expect(mocks.query.mock.calls[0][0].values).toEqual(["staff", "workspace", 2]);
    expect(mocks.query.mock.calls[1][0].values).toEqual(["staff", "workspace"]);
    expect(mocks.remove).toHaveBeenCalledWith({ where: { id: "staff", workspaceId: "workspace", version: 2 } });
  });

  it("does not remove staff if timeline assignments changed after confirmation", async () => {
    await expect(mobileDeleteStaff("workspace", "authenticated", "staff", { expectedVersion: 2,
      timelineAssignmentFingerprint: weddingStaffTimelineAssignmentFingerprint([]) })).rejects.toMatchObject({ status: 409 });
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("requires valid version and snapshot, including on deletion", async () => {
    await expect(mobileDeleteStaff("workspace", "authenticated", "staff", { expectedVersion: 2 })).rejects.toMatchObject({ status: 400 });
    await expect(mobileUpdateStaff("workspace", "authenticated", "staff", { ...details, expectedVersion: -1 })).rejects.toMatchObject({ status: 400 });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
