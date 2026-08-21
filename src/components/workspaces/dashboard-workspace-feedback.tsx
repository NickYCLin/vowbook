"use client";

import { useEffect, useRef } from "react";

export function DashboardWorkspaceDeletionFeedback() {
  const feedbackRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    feedbackRef.current?.focus();
  }, []);

  return (
    <p
      ref={feedbackRef}
      role="status"
      tabIndex={-1}
      className="mt-6 rounded-card border border-sage/30 bg-sage-soft px-4 py-3 text-caption font-medium text-sage outline-none sm:px-5"
    >
      已永久刪除婚宴工作區。
    </p>
  );
}
