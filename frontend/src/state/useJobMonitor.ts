import { useEffect, useState } from "react";
import { jobsApi } from "../api/endpoints";
import type { Job } from "../types/domain";

/** Polls the authoritative job resource until the background operation is terminal. */
export function useJobMonitor() {
  const [job, setJob] = useState<Job>();
  const [error, setError] = useState<Error>();
  const [pollAttempt, setPollAttempt] = useState(0);
  useEffect(() => {
    if (!job || job.status === "completed" || job.status === "failed") return;
    const timer = window.setTimeout(async () => {
      try { setJob(await jobsApi.get(job.id)); setError(undefined); }
      catch (cause) { setError(cause as Error); setPollAttempt((value) => value + 1); }
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [job, pollAttempt]);
  return { job, error, track: (next: Job) => { setError(undefined); setJob(next); }, clear: () => { setJob(undefined); setError(undefined); } };
}
