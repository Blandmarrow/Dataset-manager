import client from "./client";

export const qualityApi = {
  score: (params: { dataset_id: string; image_ids?: string[]; run_aesthetic: boolean; run_technical: boolean }) =>
    client.post<{ job_id: string; total: number }>("/quality/score", params).then((r) => r.data),
  duplicates: (dataset_id: string) =>
    client.get<{ groups: Array<Array<{ id: string; filename: string; aesthetic_score: number | null }>> }>(`/quality/duplicates/${dataset_id}`).then((r) => r.data),
  resolveDuplicates: (keep_ids: string[], delete_ids: string[]) =>
    client.post("/quality/duplicates/resolve", { keep_ids, delete_ids }),
};
