"use client";

import { createContext, useCallback, useContext, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";

type ViewValues = Record<string, unknown>;
export const WorkspaceFrameContext = createContext(false);
const WorkspaceViewContext = createContext<{
  values: ViewValues;
  setValues: Dispatch<SetStateAction<ViewValues>>;
} | null>(null);

/** Only presentation state lives here; server records and form drafts are never cached. */
export function WorkspaceViewStateProvider({ children }: { children: ReactNode }) {
  const [values, setValues] = useState<ViewValues>({});
  const context = useMemo(() => ({ values, setValues }), [values]);
  return <WorkspaceViewContext.Provider value={context}>{children}</WorkspaceViewContext.Provider>;
}

export function useWorkspaceViewState<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const context = useContext(WorkspaceViewContext);
  const [local, setLocal] = useState({ key, value: initial });
  const localValue = local.key === key ? local.value : initial;
  const value = context && Object.hasOwn(context.values, key) ? context.values[key] as T : localValue;
  const setValues = context?.setValues;
  const setValue = useCallback<Dispatch<SetStateAction<T>>>((update) => {
    if (setValues) {
      setValues((values) => {
        const previous = Object.hasOwn(values, key) ? values[key] as T : initial;
        const next = typeof update === "function" ? (update as (value: T) => T)(previous) : update;
        return Object.is(previous, next) ? values : { ...values, [key]: next };
      });
    } else {
      setLocal((current) => ({ key, value: typeof update === "function" ? (update as (value: T) => T)(current.key === key ? current.value : initial) : update }));
    }
  }, [initial, key, setValues]);
  return [value, setValue];
}
