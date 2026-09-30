import { useCallback, useEffect, useState } from "react";
export function useAsync<T>(fn: () => Promise<T>, deps: React.DependencyList) {
  const [data, setData] = useState<T>(); const [error, setError] = useState<Error>(); const [loading, setLoading] = useState(true);
  const run = useCallback(async () => { setLoading(true); setError(undefined); try { setData(await fn()); } catch (cause) { setError(cause as Error); } finally { setLoading(false); } }, deps);
  useEffect(() => { void run(); }, [run]);
  return { data, error, loading, reload: run, setData };
}
