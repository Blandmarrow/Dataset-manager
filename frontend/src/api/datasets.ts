import client from "./client";
import type { Dataset, DatasetStats, TagCooccurrence } from "../types";

export const datasetsApi = {
  list: () => client.get<Dataset[]>("/datasets/").then((r) => r.data),
  get: (id: string) => client.get<Dataset>(`/datasets/${id}`).then((r) => r.data),
  create: (name: string, description = "") =>
    client.post<Dataset>("/datasets/", { name, description }).then((r) => r.data),
  update: (id: string, data: { name?: string; description?: string }) =>
    client.patch<Dataset>(`/datasets/${id}`, data).then((r) => r.data),
  delete: (id: string) => client.delete(`/datasets/${id}`),
  importFolder: (id: string, folder_path: string) =>
    client.post<{ job_id: string }>(`/datasets/${id}/import`, { folder_path }).then((r) => r.data),
  refreshStats: (id: string) => client.post(`/datasets/${id}/refresh-stats`),
  stats: (id: string) => client.get<DatasetStats>(`/datasets/${id}/stats`).then((r) => r.data),
  tagCooccurrence: (id: string, limit = 15) =>
    client.get<TagCooccurrence>(`/datasets/${id}/tag-cooccurrence?limit=${limit}`).then((r) => r.data),
};
