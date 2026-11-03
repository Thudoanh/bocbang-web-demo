import { useEffect, useState } from "react";
import { jobsApi } from "../api/endpoints";
import type { Job } from "../types/domain";

/** Polls the authoritative job resource until the background operation is terminal. */
export function useJobMonitor() {
  const [job, setJob] = useState<Job>();
  useEffect(() => {
    if (!job || job.status === "completed" || job.status === "failed") return;
    const timer = window.setTimeout(async () => {
      try { setJob(await jobsApi.get(job.id)); }
      catch (cause) { setJob({ ...job, status: "failed", error: { code: "JOB_STATUS_UNAVAILABLE", message: (cause as Error).message } }); }
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [job]);
  return { job, track: setJob, clear: () => setJob(undefined) };
}
