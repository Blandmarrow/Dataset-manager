import client from "./client";

interface ExportFilters {
  caption_format?: string;
  resize_to?: number | null;
  aesthetic_min?: number | null;
  captioned_only?: boolean;
  exclude_flags?: string;
  style_sim_min?: number | null;
}

export const exportApi = {
  kohya: (params: {
    dataset_id: string;
    output_dir: string;
    n_repeats?: number;
    concept_token?: string;
    image_ids?: string[];
    output_format?: string;
  } & ExportFilters) =>
    client.post<{ job_id: string }>("/export/kohya", params).then((r) => r.data),

  aitoolkit: (params: {
    dataset_id: string;
    output_dir: string;
    concept_name?: string;
    image_ids?: string[];
    output_format?: string;
  } & ExportFilters) =>
    client.post<{ job_id: string }>("/export/aitoolkit", params).then((r) => r.data),

  plain: (params: {
    dataset_id: string;
    output_dir: string;
    image_ids?: string[];
    output_format?: string;
  } & ExportFilters) =>
    client.post<{ job_id: string }>("/export/plain", params).then((r) => r.data),

  preview: (
    dataset_id: string,
    filters?: {
      aesthetic_min?: number | null;
      captioned_only?: boolean;
      exclude_flags?: string;
      style_sim_min?: number | null;
    },
  ) =>
    client
      .get(`/export/preview/${dataset_id}`, {
        params: {
          ...(filters?.aesthetic_min != null && { aesthetic_min: filters.aesthetic_min }),
          ...(filters?.captioned_only && { captioned_only: true }),
          ...(filters?.exclude_flags && { exclude_flags: filters.exclude_flags }),
          ...(filters?.style_sim_min != null && { style_sim_min: filters.style_sim_min }),
        },
      })
      .then((r) => r.data),
};
