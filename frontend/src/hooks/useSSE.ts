import { useEffect } from "react";
import { useJobStore } from "../store/jobStore";
import type { JobProgress } from "../types";

export function useJobSSE(jobId: string | null) {
  const updateJob = useJobStore((s) => s.updateJob);

  useEffect(() => {
    if (!jobId) return;
    const es = new EventSource(`/api/v1/jobs/stream/${jobId}`);
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as JobProgress;
        if (data.type !== "heartbeat") {
          updateJob(jobId, data);
        }
      } catch {}
    };
    es.onerror = () => es.close();
    return () => es.close();
  }, [jobId, updateJob]);
}

export function useAllJobsSSE() {
  const updateJob = useJobStore((s) => s.updateJob);

  useEffect(() => {
    const es = new EventSource("/api/v1/jobs/stream/all/events");
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as JobProgress;
        if (data.type !== "heartbeat" && data.job_id) {
          updateJob(data.job_id, data);
        }
      } catch {}
    };
    es.onerror = () => {};
    return () => es.close();
  }, [updateJob]);
}
