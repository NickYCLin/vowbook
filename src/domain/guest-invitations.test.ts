import { describe, expect, it } from "vitest";
import { normalizeInvitationQuestions, normalizeInvitationReply, parseCheckInCode, type InvitationQuestion } from "./guest-invitations";

const questions: InvitationQuestion[] = [{ id: "transport", label: "是否需要接駁", type: "CHOICE", required: true, options: ["需要", "不需要"] }];
describe("受限賓客邀請契約", () => {
  it("保留穩定題目識別與選項，不接受重複或無效題目", () => {
    expect(normalizeInvitationQuestions(questions)).toEqual(questions);
    expect(() => normalizeInvitationQuestions([...questions, ...questions])).toThrow();
    expect(() => normalizeInvitationQuestions([{ ...questions[0], options: ["重複", "重複"] }])).toThrow();
    expect(() => normalizeInvitationQuestions([{ ...questions[0], type: "HTML" }])).toThrow();
    expect(() => normalizeInvitationQuestions(Array(9).fill(questions[0]))).toThrow();
  });
  it("檢查基本題、保留素食人數，僅接受表單上存在的自訂答案", () => {
    const reply = { attendance: "ATTENDING", partySize: 2, vegetarianCount: 1, phone: "0000000000", dietaryNotes: "合成需求", answers: { transport: "需要" } };
    expect(normalizeInvitationReply(reply, questions, 2)).toEqual(reply);
    expect(() => normalizeInvitationReply({ ...reply, partySize: 3 }, questions, 2)).toThrow();
    expect(() => normalizeInvitationReply({ ...reply, vegetarianCount: 3 }, questions, 2)).toThrow();
    expect(() => normalizeInvitationReply({ ...reply, answers: {} }, questions, 2)).toThrow();
    expect(() => normalizeInvitationReply({ ...reply, answers: { transport: "其他" } }, questions, 2)).toThrow();
    expect(() => normalizeInvitationReply({ ...reply, workspaceId: "forged" }, questions, 2)).toThrow();
    expect(() => normalizeInvitationReply({ ...reply, answers: { ...reply.answers, forged: "答案" } }, questions, 2)).toThrow();
  });
  it("不出席需為零人，與尚未回覆的狀態分開", () => {
    expect(normalizeInvitationReply({ attendance: "DECLINED", partySize: 0, vegetarianCount: 0, phone: "", dietaryNotes: "", answers: { transport: "不需要" } }, questions, 2).attendance).toBe("DECLINED");
    expect(() => normalizeInvitationReply({ attendance: "UNDECIDED" }, [], 2)).toThrow();
  });
  it("報到碼只能是獨立 QR 格式，不開啟任意網址或接受邀請 Token", () => {
    const token = "a".repeat(43);
    expect(parseCheckInCode(`vowbook:check-in:v1:${token}`)).toBe(token);
    for (const input of [token, `https://example.test/#${token}`, `vowbook:check-in:v2:${token}`, "x".repeat(500)]) expect(() => parseCheckInCode(input)).toThrow();
  });
});
