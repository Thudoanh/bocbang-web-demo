import { useCallback, useEffect, useRef, useState } from "react";
export function useAsync<T>(fn: () => Promise<T>, deps: React.DependencyList) {
  const [data, setData] = useState<T>(); const [error, setError] = useState<Error>(); const [loading, setLoading] = useState(true);
  const sequence = useRef(0);
  const run = useCallback(async () => { const current = ++sequence.current; setLoading(true); setError(undefined); try { const result = await fn(); if (current === sequence.current) setData(result); } catch (cause) { if (current === sequence.current) setError(cause as Error); } finally { if (current === sequence.current) setLoading(false); } }, deps);
  useEffect(() => { void run(); }, [run]);
  return { data, error, loading, reload: run, setData };
}
