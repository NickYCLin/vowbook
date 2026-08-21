import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { update } = vi.hoisted(() => ({ update: vi.fn() }));

vi.mock("next-auth/react", () => ({
  useSession: () => ({ update }),
}));

import { InvitationAcceptedNotice } from "./invitation-accepted-notice";

describe("InvitationAcceptedNotice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    update.mockResolvedValue({
      expires: "2099-01-01T00:00:00.000Z",
      user: {},
    });
  });

  it("shows only a concise accepted notice and dismisses the exact server notice", async () => {
    render(<InvitationAcceptedNotice notice={{ id: "notice_1", count: 1 }} />);

    expect(screen.getByRole("status")).toHaveTextContent(
      "協作邀請已接受，婚宴已加入下方清單。",
    );
    expect(screen.queryByText(/重新選擇/u)).not.toBeInTheDocument();
    expect(screen.queryByText(/完全相同/u)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "知道了" }));

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith({
        dismissedInvitationNoticeId: "notice_1",
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("status")).not.toBeInTheDocument(),
    );
  });

  it.each<[string, unknown]>([
    ["null", null],
    ["undefined", undefined],
    [
      "the same notice",
      {
        expires: "2099-01-01T00:00:00.000Z",
        invitationNotice: { id: "notice_2", count: 2 },
        user: {},
      },
    ],
  ])(
    "keeps the notice retryable when clearing returns %s",
    async (_label, result) => {
      update.mockResolvedValueOnce(result);
      render(
        <InvitationAcceptedNotice notice={{ id: "notice_2", count: 2 }} />,
      );

      fireEvent.click(screen.getByRole("button", { name: "知道了" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "暫時無法關閉通知，請再試一次。",
      );
      expect(screen.getByRole("status")).toBeInTheDocument();
    },
  );

  it("keeps the notice retryable when clearing the session rejects", async () => {
    update.mockRejectedValueOnce(new Error("private session failure"));
    render(<InvitationAcceptedNotice notice={{ id: "notice_2", count: 2 }} />);

    fireEvent.click(screen.getByRole("button", { name: "知道了" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "暫時無法關閉通知，請再試一次。",
    );
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByText(/private session failure/u)).not.toBeInTheDocument();
  });
});
