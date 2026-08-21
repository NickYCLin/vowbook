import { cn } from "@/lib/class-names";

/**
 * Server Action 的共用回饋列。
 * 原本 budget / guests / tables / tasks / staff / timeline / workspaces
 * 七個 forms 檔各自複製一份，統一到這裡。
 */
export type ActionFeedbackState = {
  status: "idle" | "success" | "error";
  message?: string;
};

export function ActionFeedback({
  state,
  className,
}: {
  state: ActionFeedbackState;
  className?: string;
}) {
  if (state.status === "idle" || !state.message) {
    return null;
  }

  const isError = state.status === "error";

  return (
    <p
      role={isError ? "alert" : "status"}
      className={cn(
        "min-w-0 rounded-control border px-3.5 py-2.5 text-caption leading-6 break-words",
        isError
          ? "border-danger/30 bg-danger-soft text-danger"
          : "border-positive/30 bg-positive-soft text-positive",
        className,
      )}
    >
      {state.message}
    </p>
  );
}
