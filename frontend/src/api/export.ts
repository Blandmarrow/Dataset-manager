import client from "./client";

export const exportApi = {
  kohya: (params: {
    dataset_id: string;
    output_dir: string;
    n_repeats?: number;
    concept_token?: string;
    image_ids?: string[];
    output_format?: string;
  }) => client.post<{ job_id: string }>("/export/kohya", params).then((r) => r.data),
  aitoolkit: (params: {
    dataset_id: string;
    output_dir: string;
    concept_name?: string;
    image_ids?: string[];
    output_format?: string;
  }) => client.post<{ job_id: string }>("/export/aitoolkit", params).then((r) => r.data),
  preview: (dataset_id: string) =>
    client.get(`/export/preview/${dataset_id}`).then((r) => r.data),
};
