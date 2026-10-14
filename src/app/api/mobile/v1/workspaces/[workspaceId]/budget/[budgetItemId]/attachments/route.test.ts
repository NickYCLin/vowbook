import { beforeEach, describe, expect, it, vi } from "vitest";
import { MobileRequestError } from "@/lib/mobile/protocol";

const mocks = vi.hoisted(() => ({ user: vi.fn(), access: vi.fn(), create: vi.fn() }));
vi.mock("@/lib/mobile/session", () => ({ requireMobileUser: mocks.user }));
vi.mock("@/lib/budget-attachments", async (original) => ({
  ...(await original<typeof import("@/lib/budget-attachments")>()),
  assertBudgetAttachmentUploadAccess: mocks.access,
  createBudgetAttachment: mocks.create,
}));

import { POST } from "./route";

const context = { params: Promise.resolve({ workspaceId: "workspace_1", budgetItemId: "expense_1" }) };
function request() {
  const body = '--receipt-test\r\nContent-Disposition: form-data; name="file"; filename="receipt.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF-1.7\n\r\n--receipt-test\r\nContent-Disposition: form-data; name="userId"\r\n\r\nsomeone-else\r\n--receipt-test--\r\n';
  return new Request("https://example.test", { method: "POST", headers: {
    "Content-Type": "multipart/form-data; boundary=receipt-test", "Content-Length": String(Buffer.byteLength(body)),
  }, body });
}

describe("原生收據重試 API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user.mockResolvedValue({ id: "server-user" });
    mocks.access.mockResolvedValue(undefined);
    mocks.create.mockResolvedValue({ id: "receipt_1" });
  });

  it("只使用登入身分及路徑，啟用安全的相同收據重用", async () => {
    expect((await POST(request(), context)).status).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      currentUserId: "server-user", workspaceId: "workspace_1", budgetItemId: "expense_1",
      originalName: "receipt.pdf", mediaType: "application/pdf", reuseIdentical: true,
    }));
  });

  it("沒有成員存取權時不解析附件，也不寫入", async () => {
    mocks.access.mockRejectedValue(new MobileRequestError(403, "FORBIDDEN", "沒有權限"));
    const upload = request();
    const parse = vi.spyOn(upload, "formData");
    expect((await POST(upload, context)).status).toBe(403);
    expect(parse).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
