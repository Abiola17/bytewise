"use client";

import { useCallback, useEffect, useState } from "react";

export type ApiState<T> =
  { status: "loading" } | { status: "error"; message: string } | { status: "success"; data: T };

/** Runs an API call on mount and exposes loading / error / success plus a reload. */
export function useApi<T>(fetcher: () => Promise<T>) {
  const [state, setState] = useState<ApiState<T>>({ status: "loading" });

  const load = useCallback(() => {
    setState({ status: "loading" });
    fetcher().then(
      (data) => setState({ status: "success", data }),
      (error: unknown) =>
        setState({
          status: "error",
          message: error instanceof Error ? error.message : "Something went wrong.",
        }),
    );
  }, [fetcher]);

  useEffect(load, [load]);

  return { state, reload: load };
}
