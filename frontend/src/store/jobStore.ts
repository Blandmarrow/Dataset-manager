import { create } from "zustand";
import type { JobProgress } from "../types";

interface JobStore {
  activeJobs: Map<string, JobProgress>;
  updateJob: (id: string, progress: Partial<JobProgress>) => void;
  removeJob: (id: string) => void;
  getJob: (id: string) => JobProgress | undefined;
}

export const useJobStore = create<JobStore>((set, get) => ({
  activeJobs: new Map(),
  updateJob: (id, progress) =>
    set((s) => {
      const next = new Map(s.activeJobs);
      const existing = next.get(id) ?? { job_id: id } as JobProgress;
      next.set(id, { ...existing, ...progress });
      return { activeJobs: next };
    }),
  removeJob: (id) =>
    set((s) => {
      const next = new Map(s.activeJobs);
      next.delete(id);
      return { activeJobs: next };
    }),
  getJob: (id) => get().activeJobs.get(id),
}));
