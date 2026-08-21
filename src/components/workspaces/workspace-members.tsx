"use client";

import {
  createWorkspaceInvitationAction,
  reinviteWorkspaceInvitationAction,
  removeWorkspaceMemberAction,
  revokeWorkspaceInvitationAction,
  updateWorkspaceMemberRoleAction,
  type WorkspaceInvitationMutationState,
} from "@/actions/workspace-invitations";
import type { WorkspaceRole } from "@/domain/workspace";
import {
  INVITATION_EMAIL_HTML_PATTERN,
  type InvitableWorkspaceRole,
} from "@/domain/workspace-invitation";
import type {
  PendingWorkspaceInvitationItem,
  RenewableWorkspaceInvitationItem,
  WorkspaceMemberItem,
} from "@/lib/workspace-invitations";
import {
  useActionState,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useFormStatus } from "react-dom";

const initialState: WorkspaceInvitationMutationState = { status: "idle" };

const roleLabels: Record<WorkspaceRole, string> = {
  OWNER: "擁有者",
  PARTNER: "伴侶",
  PLANNER: "婚顧",
  VIEWER: "檢視者",
};

const roleDescriptions: Record<InvitableWorkspaceRole, string> = {
  PARTNER: "可共同編輯婚宴內容，不能管理協作者。",
  PLANNER: "可共同編輯婚宴內容，不能管理協作者。",
  VIEWER: "只能查看工作區內容與協作者名稱、角色。",
};

function Feedback({
  state,
  id,
}: {
  state: WorkspaceInvitationMutationState;
  id?: string;
}) {
  const isError = state.status === "error";
  return (
    <p
      id={id}
      role={state.status === "idle" ? undefined : isError ? "alert" : "status"}
      aria-live={isError ? "assertive" : "polite"}
      className={
        state.status === "idle"
          ? "min-h-0"
          : isError
            ? "border-l-2 border-danger bg-danger-soft px-4 py-3 text-sm leading-6 text-danger"
            : "border-l-2 border-sage bg-sage-soft px-4 py-3 text-sm leading-6 text-sage"
      }
    >
      {state.message}
    </p>
  );
}

function RevokeInvitationButton({
  invitation,
}: {
  invitation: PendingWorkspaceInvitationItem;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-label={`撤銷給 ${invitation.email} 的邀請`}
      className="inline-flex min-h-11 max-w-full min-w-0 items-center justify-center whitespace-normal break-words rounded-full border border-danger px-4 py-2 text-sm font-semibold text-danger disabled:cursor-wait disabled:opacity-60 [overflow-wrap:anywhere]"
    >
      {pending ? "撤銷中…" : "撤銷邀請"}
    </button>
  );
}

function PendingInvitationsPanel({
  workspaceId,
  pendingInvitations,
}: {
  workspaceId: string;
  pendingInvitations?: PendingWorkspaceInvitationItem[];
}) {
  const action = revokeWorkspaceInvitationAction.bind(null, workspaceId);
  const [state, formAction] = useActionState(action, initialState);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (state.status === "success") headingRef.current?.focus();
  }, [state]);

  return (
    <section aria-labelledby="pending-invitations-title" className="min-w-0">
      <h2
        ref={headingRef}
        id="pending-invitations-title"
        tabIndex={-1}
        className="font-serif text-2xl font-semibold text-ink outline-none"
      >
        等待接受的邀請
      </h2>
      <p className="mt-2 text-sm leading-6 text-ink-soft">
        邀請在七天內有效；接受後，婚宴會出現在對方的「我的婚宴」。等待期間不能直接修改角色。
      </p>
      <div className="mt-4 min-w-0">
        <Feedback state={state} />
      </div>

      {pendingInvitations?.length ? (
        <ul className="mt-4 min-w-0 divide-y divide-line overflow-hidden rounded-card border border-line bg-surface shadow-card">
          {pendingInvitations.map((invitation) => (
            <li
              key={invitation.id}
              className="min-w-0 px-5 py-4 sm:flex sm:items-start sm:justify-between sm:gap-5 sm:px-7"
            >
              <div className="min-w-0">
                <p className="min-w-0 break-all font-semibold text-ink [overflow-wrap:anywhere]">
                  {invitation.email}
                </p>
                <p className="mt-1 text-sm text-ink-soft">
                  {roleLabels[invitation.role]}・到期時間{" "}
                  <time dateTime={invitation.expiresAt}>
                    {new Intl.DateTimeFormat("zh-TW", {
                      dateStyle: "medium",
                      timeStyle: "short",
                      timeZone: "Asia/Taipei",
                    }).format(new Date(invitation.expiresAt))}
                    （台北時間）
                  </time>
                </p>
              </div>
              <form action={formAction} className="mt-3 sm:mt-0">
                <input
                  type="hidden"
                  name="invitationId"
                  value={invitation.id}
                />
                <input
                  type="hidden"
                  name="version"
                  value={invitation.version}
                />
                <RevokeInvitationButton invitation={invitation} />
              </form>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 rounded-card border border-dashed border-line-strong bg-surface/60 px-5 py-6 text-caption leading-6 text-ink-soft sm:px-6">
          目前沒有等待接受的邀請。
        </p>
      )}
    </section>
  );
}

function ReinviteFields({
  invitation,
}: {
  invitation: RenewableWorkspaceInvitationItem;
}) {
  const { pending } = useFormStatus();

  return (
    <fieldset
      disabled={pending}
      aria-busy={pending}
      className="grid min-w-0 gap-3 border-0 p-0 sm:grid-cols-[minmax(12rem,1fr)_auto] sm:items-end"
    >
      <input type="hidden" name="invitationId" value={invitation.id} />
      <input type="hidden" name="version" value={invitation.version} />
      <div className="min-w-0">
        <label
          htmlFor={`reinvite-role-${invitation.id}`}
          className="block min-w-0 break-all text-sm font-medium text-ink [overflow-wrap:anywhere]"
        >
          重新邀請 {invitation.email} 的角色
        </label>
        <select
          id={`reinvite-role-${invitation.id}`}
          name="role"
          defaultValue={invitation.role}
          required
          className="mt-2 min-h-11 w-full min-w-0 rounded-lg border border-line bg-surface px-4 text-ink outline-none focus:border-clay"
        >
          <option value="PARTNER">伴侶</option>
          <option value="PLANNER">婚顧</option>
          <option value="VIEWER">檢視者</option>
        </select>
      </div>
      <button
        type="submit"
        disabled={pending}
        aria-label={`重新邀請 ${invitation.email}`}
        className="min-h-11 rounded-full border border-clay bg-surface px-4 py-2 text-sm font-semibold text-clay-strong disabled:cursor-wait disabled:opacity-60"
      >
        {pending ? "重新邀請中…" : "重新邀請"}
      </button>
    </fieldset>
  );
}

function RenewableInvitationsPanel({
  workspaceId,
  invitations,
}: {
  workspaceId: string;
  invitations?: RenewableWorkspaceInvitationItem[];
}) {
  const action = reinviteWorkspaceInvitationAction.bind(null, workspaceId);
  const [state, formAction] = useActionState(action, initialState);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (state.status === "success") headingRef.current?.focus();
  }, [state]);

  return (
    <section aria-labelledby="renewable-invitations-title" className="min-w-0">
      <h2
        ref={headingRef}
        id="renewable-invitations-title"
        tabIndex={-1}
        className="font-serif text-2xl font-semibold text-ink outline-none"
      >
        需重新邀請
      </h2>
      <p className="mt-2 text-sm leading-6 text-ink-soft">
        已過期或已撤銷的邀請不會自動重開。重新送出後，請再把 VowBook
        網址傳給對方。
      </p>
      <div className="mt-4 min-w-0">
        <Feedback state={state} />
      </div>

      {invitations?.length ? (
        <ul className="mt-4 min-w-0 divide-y divide-line overflow-hidden rounded-card border border-line bg-surface shadow-card">
          {invitations.map((invitation) => (
            <li key={invitation.id} className="min-w-0 px-5 py-4 sm:px-7">
              <div className="min-w-0">
                <p className="min-w-0 break-all font-semibold text-ink [overflow-wrap:anywhere]">
                  {invitation.email}
                </p>
                <p className="mt-1 text-sm font-medium text-ink-soft">
                  {invitation.reason === "EXPIRED" ? "已過期" : "已撤銷"}
                </p>
              </div>
              <form action={formAction} className="mt-4 min-w-0">
                <ReinviteFields invitation={invitation} />
              </form>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 rounded-card border border-dashed border-line-strong bg-surface/60 px-5 py-6 text-caption leading-6 text-ink-soft sm:px-6">
          目前沒有需要重新邀請的帳號。
        </p>
      )}
    </section>
  );
}

function InviteCollaboratorForm({
  workspaceId,
  operationKey,
}: {
  workspaceId: string;
  operationKey: string;
}) {
  const action = createWorkspaceInvitationAction.bind(null, workspaceId);
  const [state, formAction, pending] = useActionState(action, initialState);
  const emailRef = useRef<HTMLInputElement>(null);
  const roleRef = useRef<HTMLSelectElement>(null);
  const emailError =
    state.status === "error" &&
    state.code === "VALIDATION" &&
    state.field === "email";
  const roleError =
    state.status === "error" &&
    state.code === "VALIDATION" &&
    state.field === "role";

  useEffect(() => {
    if (emailError) emailRef.current?.focus();
    else if (roleError) roleRef.current?.focus();
  }, [emailError, roleError, state]);

  return (
    <section
      aria-labelledby="invite-collaborator-title"
      className="rounded-card border border-line bg-surface px-5 py-6 shadow-card sm:px-6"
    >
      <h2
        id="invite-collaborator-title"
        className="font-serif text-2xl font-semibold text-ink"
      >
        邀請協作者
      </h2>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-soft">
        請輸入對方實際用來登入 Google 的完整
        Email。系統只會去除前後空白並轉為小寫，不會猜測 Gmail
        的句點或加號別名。
      </p>
      <p className="mt-2 max-w-3xl text-sm font-medium leading-6 text-ink">
        邀請建立後會保留七天。請把 VowBook 網址傳給對方。
      </p>

      <form action={formAction} className="mt-5 min-w-0">
        <input type="hidden" name="operationKey" value={operationKey} />
        <fieldset
          disabled={pending}
          aria-busy={pending}
          className="grid min-w-0 gap-5 border-0 p-0 lg:grid-cols-[minmax(0,1fr)_minmax(12rem,0.45fr)_auto] lg:items-end"
        >
          <div className="min-w-0">
            <label
              htmlFor="invitation-email"
              className="font-medium text-ink"
            >
              Google 帳號 Email
            </label>
            <input
              ref={emailRef}
              id="invitation-email"
              name="email"
              type="email"
              required
              maxLength={254}
              pattern={INVITATION_EMAIL_HTML_PATTERN}
              autoComplete="email"
              inputMode="email"
              aria-invalid={emailError || undefined}
              aria-describedby={
                emailError
                  ? "invitation-email-help invitation-feedback"
                  : "invitation-email-help"
              }
              className="mt-2 min-h-11 w-full min-w-0 rounded-lg border border-line bg-surface px-4 text-ink shadow-inner outline-none transition focus:border-clay"
            />
            <p
              id="invitation-email-help"
              className="mt-2 text-sm text-ink-faint"
            >
              限 ASCII Email，最多 254 個字元。
            </p>
          </div>

          <div className="min-w-0">
            <label
              htmlFor="invitation-role"
              className="font-medium text-ink"
            >
              協作角色
            </label>
            <select
              ref={roleRef}
              id="invitation-role"
              name="role"
              defaultValue="PARTNER"
              required
              aria-invalid={roleError || undefined}
              aria-describedby={roleError ? "invitation-feedback" : undefined}
              className="mt-2 min-h-11 w-full min-w-0 rounded-lg border border-line bg-surface px-4 text-ink outline-none focus:border-clay"
            >
              <option value="PARTNER">伴侶</option>
              <option value="PLANNER">婚顧</option>
              <option value="VIEWER">檢視者</option>
            </select>
          </div>

          <button
            type="submit"
            disabled={pending}
            className="min-h-11 rounded-full bg-clay px-5 py-2 font-semibold text-white disabled:cursor-wait disabled:opacity-60"
          >
            {pending ? "送出中…" : "送出協作邀請"}
          </button>

          <div className="min-w-0 lg:col-span-3">
            <Feedback state={state} id="invitation-feedback" />
          </div>
        </fieldset>
      </form>

      <dl className="mt-6 grid min-w-0 gap-3 text-sm leading-6 text-ink-soft sm:grid-cols-3">
        {(Object.entries(roleDescriptions) as Array<
          [InvitableWorkspaceRole, string]
        >).map(([role, description]) => (
          <div key={role} className="min-w-0 border-l-2 border-line pl-3">
            <dt className="font-semibold text-ink">{roleLabels[role]}</dt>
            <dd>{description}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

type ManageableWorkspaceMember = WorkspaceMemberItem & {
  role: InvitableWorkspaceRole;
  management: NonNullable<WorkspaceMemberItem["management"]>;
};

type MemberDialogProps = {
  workspaceId: string;
  member: ManageableWorkspaceMember;
  onSuccess(state: WorkspaceInvitationMutationState): void;
};

function RoleEditDialog({ workspaceId, member, onSuccess }: MemberDialogProps) {
  const action = updateWorkspaceMemberRoleAction.bind(null, workspaceId);
  const [state, formAction, pending] = useActionState(action, initialState);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const roleRef = useRef<HTMLSelectElement>(null);
  const [snapshot, setSnapshot] = useState(() => ({
    role: member.role,
    updatedAt: member.management.updatedAt,
  }));
  const [draftRole, setDraftRole] = useState<InvitableWorkspaceRole>(
    member.role,
  );

  const open = () => {
    setSnapshot({
      role: member.role,
      updatedAt: member.management.updatedAt,
    });
    setDraftRole(member.role);
    dialogRef.current?.showModal();
    roleRef.current?.focus();
  };

  const close = () => {
    if (!pending) dialogRef.current?.close();
  };

  useEffect(() => {
    if (
      state.status === "success" &&
      state.membershipId === member.management.membershipId
    ) {
      dialogRef.current?.close();
      onSuccess(state);
      return;
    }

    // React resets form controls after a Server Action resolves. Re-apply the
    // controlled draft so an error retry cannot silently submit the old role.
    if (state.status === "error" && roleRef.current) {
      roleRef.current.value = draftRole;
    }
  }, [draftRole, member.management.membershipId, onSuccess, state]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={open}
        aria-label={`編輯 ${member.displayName} 的角色`}
        className="inline-flex min-h-11 items-center justify-center rounded-full border border-clay px-4 py-2 text-sm font-semibold text-clay-strong"
      >
        編輯角色
      </button>
      <dialog
        ref={dialogRef}
        aria-labelledby={`edit-member-title-${member.management.membershipId}`}
        onCancel={(event) => {
          if (pending) event.preventDefault();
        }}
        onClose={() => {
          if (triggerRef.current?.isConnected) triggerRef.current.focus();
        }}
        className="m-auto max-h-[calc(100dvh-2rem)] w-[min(32rem,calc(100%-2rem))] overflow-y-auto rounded-2xl border border-line bg-surface p-0 text-ink shadow-2xl [&::backdrop]:bg-stone-950/45"
      >
        <div className="sticky top-0 flex items-start justify-between gap-4 border-b border-line bg-surface px-5 py-4 sm:px-6">
          <h3
            id={`edit-member-title-${member.management.membershipId}`}
            className="min-w-0 break-words font-serif text-2xl font-semibold [overflow-wrap:anywhere]"
          >
            編輯{member.displayName}的角色
          </h3>
          <button
            type="button"
            onClick={close}
            disabled={pending}
            aria-label={`關閉編輯${member.displayName}的角色`}
            className="min-h-11 shrink-0 rounded-full px-3 text-sm font-semibold text-ink-soft disabled:cursor-wait disabled:opacity-60"
          >
            關閉
          </button>
        </div>
        <form action={formAction} className="px-5 py-5 sm:px-6">
          <fieldset
            disabled={pending}
            aria-busy={pending}
            className="min-w-0 space-y-5 border-0 p-0"
          >
            <input
              type="hidden"
              name="membershipId"
              value={member.management.membershipId}
            />
            <input
              type="hidden"
              name="expectedUpdatedAt"
              value={snapshot.updatedAt}
            />
            <div className="min-w-0">
              <label
                htmlFor={`member-role-${member.management.membershipId}`}
                className="font-medium text-ink"
              >
                協作角色
              </label>
              <select
                ref={roleRef}
                id={`member-role-${member.management.membershipId}`}
                name="role"
                value={draftRole}
                onChange={(event) =>
                  setDraftRole(event.target.value as InvitableWorkspaceRole)
                }
                required
                className="mt-2 min-h-11 w-full min-w-0 rounded-lg border border-line bg-surface px-4 text-ink outline-none focus:border-clay"
              >
                <option value="PARTNER">伴侶</option>
                <option value="PLANNER">婚顧</option>
                <option value="VIEWER">檢視者</option>
              </select>
            </div>
            {state.status === "error" && <Feedback state={state} />}
            <div className="flex flex-wrap justify-end gap-3">
              <button
                type="button"
                onClick={close}
                disabled={pending}
                className="min-h-11 rounded-full border border-line-strong px-5 py-2 font-semibold text-ink disabled:cursor-wait disabled:opacity-60"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={pending}
                className="min-h-11 rounded-full bg-clay px-5 py-2 font-semibold text-white disabled:cursor-wait disabled:opacity-60"
              >
                {pending ? "儲存中…" : "儲存角色"}
              </button>
            </div>
          </fieldset>
        </form>
      </dialog>
    </>
  );
}

function RemoveMemberDialog({ workspaceId, member, onSuccess }: MemberDialogProps) {
  const action = removeWorkspaceMemberAction.bind(null, workspaceId);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const confirmationRef = useRef<HTMLInputElement>(null);
  const successfulCloseRef = useRef(false);
  const [state, formAction, pending] = useActionState(
    async (previousState: WorkspaceInvitationMutationState, formData: FormData) => {
      const nextState = await action(previousState, formData);
      if (
        nextState.status === "success" &&
        nextState.membershipId === member.management.membershipId
      ) {
        successfulCloseRef.current = true;
        dialogRef.current?.close();
        onSuccess(nextState);
      }
      return nextState;
    },
    initialState,
  );
  const [snapshotUpdatedAt, setSnapshotUpdatedAt] = useState(
    member.management.updatedAt,
  );
  const [confirmation, setConfirmation] = useState("");
  const confirmed = confirmation === member.displayName;

  const open = () => {
    setSnapshotUpdatedAt(member.management.updatedAt);
    setConfirmation("");
    dialogRef.current?.showModal();
    confirmationRef.current?.focus();
  };

  const close = () => {
    if (!pending) dialogRef.current?.close();
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={open}
        aria-label={`移除 ${member.displayName}`}
        className="inline-flex min-h-11 items-center justify-center rounded-full border border-danger px-4 py-2 text-sm font-semibold text-danger"
      >
        移除
      </button>
      <dialog
        ref={dialogRef}
        aria-labelledby={`remove-member-title-${member.management.membershipId}`}
        onCancel={(event) => {
          if (pending) event.preventDefault();
        }}
        onClose={() => {
          if (successfulCloseRef.current) {
            successfulCloseRef.current = false;
            return;
          }
          if (triggerRef.current?.isConnected) triggerRef.current.focus();
        }}
        className="m-auto max-h-[calc(100dvh-2rem)] w-[min(32rem,calc(100%-2rem))] overflow-y-auto rounded-2xl border border-line bg-surface p-0 text-ink shadow-2xl [&::backdrop]:bg-stone-950/45"
      >
        <div className="sticky top-0 flex items-start justify-between gap-4 border-b border-line bg-surface px-5 py-4 sm:px-6">
          <h3
            id={`remove-member-title-${member.management.membershipId}`}
            className="min-w-0 break-words font-serif text-2xl font-semibold [overflow-wrap:anywhere]"
          >
            移除{member.displayName}
          </h3>
          <button
            type="button"
            onClick={close}
            disabled={pending}
            aria-label={`關閉移除${member.displayName}`}
            className="min-h-11 shrink-0 rounded-full px-3 text-sm font-semibold text-ink-soft disabled:cursor-wait disabled:opacity-60"
          >
            關閉
          </button>
        </div>
        <form action={formAction} className="px-5 py-5 sm:px-6">
          <fieldset
            disabled={pending}
            aria-busy={pending}
            className="min-w-0 space-y-5 border-0 p-0"
          >
            <input
              type="hidden"
              name="membershipId"
              value={member.management.membershipId}
            />
            <input
              type="hidden"
              name="expectedUpdatedAt"
              value={snapshotUpdatedAt}
            />
            <p className="min-w-0 break-words leading-7 [overflow-wrap:anywhere]">
              這會移除 <strong>{member.displayName}</strong>
              {member.email ? (
                <>
                  （<span className="break-all">{member.email}</span>）
                </>
              ) : null}
              的工作區存取權。此操作不會刪除對方的帳號。
            </p>
            <div className="min-w-0">
              <label
                htmlFor={`remove-member-confirmation-${member.management.membershipId}`}
                className="font-medium text-ink"
              >
                請輸入「{member.displayName}」以確認移除
              </label>
              <input
                ref={confirmationRef}
                id={`remove-member-confirmation-${member.management.membershipId}`}
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                autoComplete="off"
                required
                className="mt-2 min-h-11 w-full min-w-0 rounded-lg border border-line bg-surface px-4 text-ink shadow-inner outline-none focus:border-danger"
              />
            </div>
            {state.status === "error" && <Feedback state={state} />}
            <div className="flex flex-wrap justify-end gap-3">
              <button
                type="button"
                onClick={close}
                disabled={pending}
                className="min-h-11 rounded-full border border-line-strong px-5 py-2 font-semibold text-ink disabled:cursor-wait disabled:opacity-60"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={pending || !confirmed}
                aria-label={`確認移除${member.displayName}`}
                className="min-h-11 rounded-full bg-red-800 px-5 py-2 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {pending ? "移除中…" : "確認移除"}
              </button>
            </div>
          </fieldset>
        </form>
      </dialog>
    </>
  );
}

export function WorkspaceMembersPanel({
  workspaceId,
  operationKey,
  role,
  members,
  pendingInvitations,
  renewableInvitations,
}: {
  workspaceId: string;
  operationKey: string;
  role: WorkspaceRole;
  members: WorkspaceMemberItem[];
  pendingInvitations?: PendingWorkspaceInvitationItem[];
  renewableInvitations?: RenewableWorkspaceInvitationItem[];
}) {
  const isOwner = role === "OWNER";
  const membersHeadingRef = useRef<HTMLHeadingElement>(null);
  const [memberFeedback, setMemberFeedback] =
    useState<WorkspaceInvitationMutationState>(initialState);
  const handleRoleSuccess = useCallback(
    (state: WorkspaceInvitationMutationState) => {
      setMemberFeedback(state);
    },
    [],
  );
  const handleRemovalSuccess = useCallback(
    (state: WorkspaceInvitationMutationState) => {
      setMemberFeedback(state);
      membersHeadingRef.current?.focus();
    },
    [],
  );

  return (
    <div className="mt-7 min-w-0 space-y-8">
      {isOwner && (
        <InviteCollaboratorForm
          workspaceId={workspaceId}
          operationKey={operationKey}
        />
      )}

      <section aria-labelledby="current-members-title" className="min-w-0">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2
              ref={membersHeadingRef}
              id="current-members-title"
              tabIndex={-1}
              className="font-serif text-2xl font-semibold text-ink outline-none"
            >
              目前成員
            </h2>
            <p className="mt-2 text-sm leading-6 text-ink-soft">
              {isOwner
                ? "擁有者可查看管理所需的成員 Email，並調整非擁有者角色或移除其存取權。"
                : "為保護隱私，這裡只顯示成員的顯示名稱與角色。"}
            </p>
          </div>
          <p className="text-sm text-ink-faint">{members.length} 位</p>
        </div>

        <div className="mt-4 min-w-0">
          <Feedback state={memberFeedback} />
        </div>

        <ul className="mt-4 min-w-0 divide-y divide-line overflow-hidden rounded-card border border-line bg-surface shadow-card">
          {members.map((member, index) => {
            const manageable =
              isOwner && member.role !== "OWNER" && member.management
                ? (member as ManageableWorkspaceMember)
                : null;
            return (
              <li
                key={
                  member.management?.membershipId ??
                  `${member.role}:${member.displayName}:${index}`
                }
                className="grid min-w-0 gap-3 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-7"
              >
                <div className="min-w-0">
                  <p className="min-w-0 break-words font-semibold text-ink [overflow-wrap:anywhere]">
                    {member.displayName}
                  </p>
                  {isOwner && member.email !== undefined && (
                    <p className="mt-1 min-w-0 break-all text-sm text-ink-soft [overflow-wrap:anywhere]">
                      {member.email}
                    </p>
                  )}
                </div>
                <div className="flex min-w-0 flex-wrap items-center gap-2 sm:justify-end">
                  <p className="w-fit rounded-full border border-line bg-[#f4ece3] px-3 py-1 text-sm font-medium text-ink">
                    {roleLabels[member.role]}
                  </p>
                  {manageable && (
                    <>
                      <RoleEditDialog
                        workspaceId={workspaceId}
                        member={manageable}
                        onSuccess={handleRoleSuccess}
                      />
                      <RemoveMemberDialog
                        workspaceId={workspaceId}
                        member={manageable}
                        onSuccess={handleRemovalSuccess}
                      />
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {isOwner && (
        <>
          <PendingInvitationsPanel
            workspaceId={workspaceId}
            pendingInvitations={pendingInvitations}
          />
          <RenewableInvitationsPanel
            workspaceId={workspaceId}
            invitations={renewableInvitations}
          />
        </>
      )}
    </div>
  );
}
