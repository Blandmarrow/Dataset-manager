import client from "./client";
import type { Job } from "../types";

export const jobsApi = {
  list: () => client.get<Job[]>("/jobs/").then((r) => r.data),
  get: (id: string) => client.get<Job>(`/jobs/${id}`).then((r) => r.data),
  cancel: (id: string) => client.delete(`/jobs/${id}`),
};
