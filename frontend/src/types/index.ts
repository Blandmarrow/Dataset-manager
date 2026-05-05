export interface Dataset {
  id: string;
  name: string;
  description: string;
  folder_path: string;
  created_at: string;
  updated_at: string;
  image_count: number;
  captioned_count: number;
  total_size_bytes: number;
}

export interface DatasetStats {
  id: string;
  name: string;
  image_count: number;
  captioned_count: number;
  caption_coverage_pct: number;
  total_size_bytes: number;
  total_size_mb: number;
  avg_width: number | null;
  avg_height: number | null;
  aspect_ratio_distribution: Record<string, number>;
  format_distribution: Record<string, number>;
  score_distribution: Record<string, number>;
}

export interface ImageListItem {
  id: string;
  dataset_id: string;
  filename: string;
  width: number | null;
  height: number | null;
  file_size_bytes: number | null;
  format: string | null;
  aesthetic_score: number | null;
  blur_score: number | null;
  quality_flags: Record<string, unknown>;
  caption_text: string;
  tags_json: string[];
  captioned_by: string;
}

export interface ImageDetail extends ImageListItem {
  original_filename: string;
  phash: string | null;
  noise_score: number | null;
  caption_style: string;
  captioned_at: string | null;
  created_at: string;
}

export interface CaptionData {
  image_id: string;
  caption_text: string;
  tags: string[];
  caption_style: string;
  captioned_by: string;
}

export interface TagStat {
  tag: string;
  count: number;
  category: string;
}

export interface Job {
  id: string;
  job_type: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  dataset_id: string | null;
  total_items: number;
  done_items: number;
  error_msg: string | null;
  result_data: Record<string, unknown>;
  config: Record<string, unknown>;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface JobProgress {
  type: string;
  job_id: string;
  job_type: string;
  status: string;
  done: number;
  total: number;
  percent: number;
  current_item?: string;
  message?: string;
}

export interface BooruTag {
  tag: string;
  count: number;
  category: string;
  source: string;
}

export interface ModelInfo {
  id: string;
  name: string;
  vram_mb: number;
  loaded: boolean;
}

export interface OllamaModel {
  id: string;
  name: string;
  size_mb: number;
}
