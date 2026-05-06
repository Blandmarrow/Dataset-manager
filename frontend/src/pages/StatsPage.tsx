import { useState, useEffect, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ImageListItem } from "../types";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import { datasetsApi } from "../api/datasets";
import { captionsApi } from "../api/captions";
import { imagesApi, type ImageListParams } from "../api/images";

// ─── Constants ──────────────────────────────────────────────────────────────
const COLORS = ["#e94560", "#6366f1", "#22d3ee", "#a78bfa", "#34d399", "#fb923c"];
const TOOLTIP_STYLE = { background: "#16213e", border: "1px solid #374151", fontSize: 12 };
const AXIS_TICK = { fontSize: 10, fill: "#9ca3af" };

// Bucket edge arrays — must mirror backend/services/dataset_service.py
const BLUR_EDGES   = [20, 40, 80, 150, 300];
const BLUR_LABELS  = ["0–20", "20–40", "40–80", "80–150", "150–300", "300+"];
const NOISE_EDGES  = [5, 10, 15, 20, 30];
const NOISE_LABELS = ["0–5", "5–10", "10–15", "15–20", "20–30", "30+"];
const UNI_EDGES    = [5, 10, 20, 40];
const UNI_LABELS   = ["0–5", "5–10", "10–20", "20–40", "40+"];
const COLOR_EDGES  = [10, 20, 40, 60];
const COLOR_LABELS = ["0–10", "10–20", "20–40", "40–60", "60+"];
const SAT_EDGES    = [10, 20, 40, 60];
const SAT_LABELS   = ["0–10", "10–20", "20–40", "40–60", "60+"];
const MP_EDGES     = [0.25, 0.5, 1.0, 2.0, 4.0, 8.0];
const MP_LABELS    = ["<0.25", "0.25–0.5", "0.5–1", "1–2", "2–4", "4–8", "8+"];
const FS_EDGES_MB  = [0.1, 0.5, 1.0, 2.0, 5.0];
const FS_LABELS    = ["<0.1 MB", "0.1–0.5 MB", "0.5–1 MB", "1–2 MB", "2–5 MB", "5+ MB"];
const AR_EDGES     = [0.5, 0.67, 0.85, 1.15, 1.4, 1.6, 1.95];
const AR_LABELS    = ["9:16+", "2:3", "3:4", "1:1", "4:3", "3:2", "16:9", "21:9+"];

// ─── Types ───────────────────────────────────────────────────────────────────
type FilterParams = Omit<ImageListParams, "dataset_id" | "page" | "limit">;

interface ChartEntry {
  name: string;
  count: number;
  filter?: FilterParams;
}

type PanelFilter = { title: string; params: FilterParams } | null;

// ─── Data builders ────────────────────────────────────────────────────────────
function scoreEntries(
  dist: Record<string, number>,
  labels: string[],
  edges: number[],
  field: string,
  order: "asc" | "desc" = "asc",
): ChartEntry[] {
  return labels
    .filter((lbl) => lbl in dist)
    .map((name) => {
      const i = labels.indexOf(name);
      return {
        name,
        count: dist[name],
        filter: {
          score_field: field,
          min_score: i > 0 ? edges[i - 1] : undefined,
          max_score: i < edges.length ? edges[i] : undefined,
          sort: field,
          order,
        },
      };
    });
}

function mpEntries(dist: Record<string, number>): ChartEntry[] {
  return MP_LABELS.filter((lbl) => lbl in dist).map((name) => {
    const i = MP_LABELS.indexOf(name);
    return {
      name,
      count: dist[name],
      filter: {
        mp_min: i > 0 ? MP_EDGES[i - 1] : undefined,
        mp_max: i < MP_EDGES.length ? MP_EDGES[i] : undefined,
      },
    };
  });
}

function fsEntries(dist: Record<string, number>): ChartEntry[] {
  return FS_LABELS.filter((lbl) => lbl in dist).map((name) => {
    const i = FS_LABELS.indexOf(name);
    return {
      name,
      count: dist[name],
      filter: {
        file_size_min: i > 0 ? Math.round(FS_EDGES_MB[i - 1] * 1_048_576) : undefined,
        file_size_max: i < FS_EDGES_MB.length ? Math.round(FS_EDGES_MB[i] * 1_048_576) : undefined,
        sort: "file_size_bytes",
        order: "asc" as const,
      },
    };
  });
}

function arFineEntries(dist: Record<string, number>): ChartEntry[] {
  return AR_LABELS.filter((lbl) => lbl in dist).map((name) => {
    const i = AR_LABELS.indexOf(name);
    return {
      name,
      count: dist[name],
      filter: {
        ar_min: i > 0 ? AR_EDGES[i - 1] : undefined,
        ar_max: i < AR_EDGES.length ? AR_EDGES[i] : undefined,
      },
    };
  });
}

function arCoarseEntries(dist: Record<string, number>): ChartEntry[] {
  return Object.entries(dist).map(([name, count]) => ({
    name,
    count,
    filter:
      name === "portrait"
        ? { ar_max: 0.8 }
        : name === "landscape"
        ? { ar_min: 1.2 }
        : { ar_min: 0.8, ar_max: 1.2 },
  }));
}

function wmEntries(dist: Record<string, number>): ChartEntry[] {
  return Object.entries(dist).map(([name, count]) => {
    const parts = name.split("–").map(Number);
    return {
      name,
      count,
      filter: {
        score_field: "watermark_score",
        min_score: isNaN(parts[0]) ? undefined : parts[0],
        max_score: isNaN(parts[1]) ? undefined : parts[1],
        sort: "watermark_score",
        order: "desc" as const,
      },
    };
  });
}

const AESTHETIC_FILTER_MAP: Record<string, FilterParams> = {
  "low (0-4)":   { min_score: 0, max_score: 4, sort: "aesthetic_score", order: "desc" },
  "mid (4-6)":   { min_score: 4, max_score: 6, sort: "aesthetic_score", order: "desc" },
  "high (6-10)": { min_score: 6, sort: "aesthetic_score", order: "desc" },
  "unscored":    { score_is_null: true, sort: "created_at", order: "desc" },
};

// ─── ImageLightbox ────────────────────────────────────────────────────────────
function ImageLightbox({
  images,
  index,
  datasetId,
  onClose,
  onNavigate,
  onDelete,
}: {
  images: ImageListItem[];
  index: number;
  datasetId: string;
  onClose: () => void;
  onNavigate: (i: number) => void;
  onDelete: (imageId: string) => Promise<void>;
}) {
  const img = images[index];
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const prev = useCallback(() => { setConfirmDelete(false); onNavigate(index - 1); }, [index, onNavigate]);
  const next = useCallback(() => { setConfirmDelete(false); onNavigate(index + 1); }, [index, onNavigate]);

  useEffect(() => {
    setConfirmDelete(false);
  }, [index]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { if (confirmDelete) setConfirmDelete(false); else onClose(); }
      if (e.key === "ArrowLeft"  && index > 0)               prev();
      if (e.key === "ArrowRight" && index < images.length - 1) next();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [index, images.length, onClose, prev, next, confirmDelete]);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await onDelete(img.id);
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  const scores: { label: string; value: string | number | null }[] = [
    { label: "Aesthetic",  value: img.aesthetic_score  != null ? img.aesthetic_score.toFixed(2)  : null },
    { label: "Blur",       value: img.blur_score       != null ? img.blur_score.toFixed(1)       : null },
    { label: "Watermark",  value: img.watermark_score  != null ? img.watermark_score.toFixed(2)  : null },
    { label: "Color",      value: img.color_score      != null ? img.color_score.toFixed(1)      : null },
    { label: "Saturation", value: img.saturation_score != null ? img.saturation_score.toFixed(1) : null },
  ].filter((s) => s.value != null);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85"
      onClick={onClose}
    >
      <div
        className="bg-[#0f1729] rounded-xl max-w-4xl w-full mx-4 flex flex-col shadow-2xl border border-gray-700 overflow-hidden"
        style={{ maxHeight: "90vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 shrink-0 gap-3">
          <span className="text-sm text-gray-300 truncate min-w-0" title={img.filename}>
            {img.filename}
          </span>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs text-gray-600">{index + 1} / {images.length}</span>
            <Link
              to={`/datasets/${datasetId}/image/${img.id}`}
              className="text-xs px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white transition-colors"
            >
              View Details →
            </Link>
            {/* Delete control */}
            {confirmDelete ? (
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-red-400">Remove image?</span>
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="text-xs px-2 py-1 rounded bg-red-600 hover:bg-red-700 text-white disabled:opacity-50 transition-colors"
                >
                  {deleting ? "…" : "Remove"}
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="text-xs px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="text-xs px-2 py-1 rounded bg-red-950 hover:bg-red-900 text-red-400 hover:text-red-300 border border-red-900 hover:border-red-700 transition-colors"
              >
                Delete
              </button>
            )}
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-white text-xl leading-none w-7 h-7 flex items-center justify-center rounded hover:bg-gray-800"
            >
              ×
            </button>
          </div>
        </div>

        {/* Image */}
        <div className="relative flex items-center justify-center bg-black/40 min-h-0 flex-1 overflow-hidden">
          {index > 0 && (
            <button
              onClick={prev}
              className="absolute left-2 z-10 w-9 h-9 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center text-lg transition-colors"
            >
              ‹
            </button>
          )}
          <img
            key={img.id}
            src={imagesApi.fileUrl(img.id)}
            alt={img.filename}
            className="object-contain"
            style={{ maxHeight: "60vh", maxWidth: "100%" }}
          />
          {index < images.length - 1 && (
            <button
              onClick={next}
              className="absolute right-2 z-10 w-9 h-9 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center text-lg transition-colors"
            >
              ›
            </button>
          )}
        </div>

        {/* Footer — metadata */}
        <div className="px-4 py-3 border-t border-gray-800 shrink-0 flex items-center gap-4 flex-wrap">
          {img.width && img.height && (
            <span className="text-xs text-gray-500">{img.width}×{img.height}</span>
          )}
          {img.file_size_bytes && (
            <span className="text-xs text-gray-500">
              {img.file_size_bytes > 1_048_576
                ? `${(img.file_size_bytes / 1_048_576).toFixed(1)} MB`
                : `${Math.round(img.file_size_bytes / 1024)} KB`}
            </span>
          )}
          {scores.map(({ label, value }) => (
            <span key={label} className="text-xs text-gray-500">
              <span className="text-gray-600">{label}:</span> {value}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── BucketPanel ─────────────────────────────────────────────────────────────
function BucketPanel({
  title,
  params,
  datasetId,
  onClose,
}: {
  title: string;
  params: FilterParams;
  datasetId: string;
  onClose: () => void;
}) {
  const [previewIdx, setPreviewIdx] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const queryKey = ["bucket-images", datasetId, params];

  const { data: images = [], isLoading } = useQuery({
    queryKey,
    queryFn: () => imagesApi.list({ dataset_id: datasetId, limit: 200, ...params }),
  });

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (confirmDeleteId) setConfirmDeleteId(null);
        else onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, confirmDeleteId]);

  const handleDelete = async (imageId: string) => {
    await imagesApi.delete(imageId);

    // Remove from panel cache without a refetch
    const deletedIdx = images.findIndex((img) => img.id === imageId);
    const next = images.filter((img) => img.id !== imageId);
    queryClient.setQueryData<ImageListItem[]>(queryKey, next);

    // Refresh stats so counts/histograms stay accurate
    queryClient.invalidateQueries({ queryKey: ["dataset-stats", datasetId] });
    queryClient.invalidateQueries({ queryKey: ["tag-stats", datasetId] });
    queryClient.invalidateQueries({ queryKey: ["tag-cooccurrence", datasetId] });

    setConfirmDeleteId(null);

    // Adjust lightbox position
    if (previewIdx !== null && deletedIdx !== -1) {
      if (next.length === 0) {
        setPreviewIdx(null);
      } else if (deletedIdx <= previewIdx) {
        setPreviewIdx(Math.max(0, previewIdx - 1));
      }
    }
  };

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
        onClick={onClose}
      >
        <div
          className="bg-[#0f1729] rounded-xl w-full max-w-5xl max-h-[85vh] flex flex-col mx-4 shadow-2xl border border-gray-800"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800 shrink-0">
            <div>
              <h3 className="text-white font-semibold">{title}</h3>
              {!isLoading && (
                <p className="text-xs text-gray-500 mt-0.5">
                  {images.length === 200 ? "200+ images (showing first 200)" : `${images.length} image${images.length !== 1 ? "s" : ""}`}
                  {images.length > 0 && <span className="text-gray-600"> · click any image to preview</span>}
                </p>
              )}
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-white text-2xl leading-none w-8 h-8 flex items-center justify-center rounded hover:bg-gray-800"
            >
              ×
            </button>
          </div>

          {/* Body */}
          <div className="overflow-y-auto p-4">
            {isLoading ? (
              <div className="text-gray-500 text-sm py-16 text-center">Loading…</div>
            ) : images.length === 0 ? (
              <div className="text-gray-500 text-sm py-16 text-center">No images found</div>
            ) : (
              <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 gap-2">
                {images.map((img, i) => (
                  <div key={img.id} className="relative group aspect-square">
                    <button
                      className="w-full h-full overflow-hidden rounded bg-gray-900 hover:ring-2 hover:ring-[#e94560] transition-all focus:outline-none focus:ring-2 focus:ring-[#e94560]"
                      onClick={() => { setConfirmDeleteId(null); setPreviewIdx(i); }}
                    >
                      <img
                        src={imagesApi.thumbnailUrl(img.id)}
                        alt={img.filename}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    </button>

                    {/* Delete confirm overlay */}
                    {confirmDeleteId === img.id ? (
                      <div className="absolute inset-0 rounded bg-black/85 flex flex-col items-center justify-center gap-2 z-10">
                        <span className="text-xs text-red-400 font-medium">Remove?</span>
                        <div className="flex gap-1.5">
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDelete(img.id); }}
                            className="text-xs px-2 py-0.5 rounded bg-red-600 hover:bg-red-700 text-white transition-colors"
                          >
                            Remove
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(null); }}
                            className="text-xs px-2 py-0.5 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      /* Delete button — appears on hover */
                      <button
                        onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(img.id); }}
                        className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/70 text-white text-xs
                                   opacity-0 group-hover:opacity-100 transition-opacity
                                   hover:bg-red-600 flex items-center justify-center z-10"
                        title="Delete image"
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {previewIdx !== null && images.length > 0 && (
        <ImageLightbox
          images={images}
          index={previewIdx}
          datasetId={datasetId}
          onClose={() => setPreviewIdx(null)}
          onNavigate={setPreviewIdx}
          onDelete={handleDelete}
        />
      )}
    </>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatSize(mb: number) {
  return mb > 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(1)} MB`;
}

function SectionHeader({ title }: { title: string }) {
  return <h3 className="text-base font-semibold text-gray-200 mb-3 mt-2">{title}</h3>;
}

function MiniBarChart({
  data,
  color = "#6366f1",
  xAngle,
  onBarClick,
}: {
  data: ChartEntry[];
  color?: string;
  xAngle?: number;
  onBarClick?: (entry: ChartEntry) => void;
}) {
  if (!data.length)
    return <div className="text-xs text-gray-600 py-6 text-center">No data</div>;

  const clickable = !!onBarClick;

  return (
    <ResponsiveContainer width="100%" height={140}>
      <BarChart
        data={data}
        margin={{ top: 4, right: 4, left: -16, bottom: xAngle ? 28 : 4 }}
      >
        <XAxis
          dataKey="name"
          tick={{ ...AXIS_TICK, angle: xAngle ?? 0, textAnchor: xAngle ? "end" : "middle" }}
          interval={0}
        />
        <YAxis tick={AXIS_TICK} />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          formatter={(value) => [value, "images"]}
          labelFormatter={(label) => label}
          cursor={{ fill: "rgba(255,255,255,0.05)" }}
        />
        <Bar
          dataKey="count"
          fill={color}
          radius={[2, 2, 0, 0]}
          cursor={clickable ? "pointer" : "default"}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onClick={clickable ? (d: any) => { if (d?.filter) onBarClick(d as ChartEntry); } : undefined}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ─── Co-occurrence heatmap ────────────────────────────────────────────────────
function CooccurrenceHeatmap({ tags, matrix }: { tags: string[]; matrix: number[][] }) {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null);
  if (!tags.length) return <div className="text-xs text-gray-600 py-4 text-center">No tag data</div>;

  const maxOff = Math.max(1, ...matrix.flatMap((row, i) => row.filter((_, j) => i !== j)));
  const LABEL_W = 100;
  const CELL = 28;

  return (
    <div className="overflow-x-auto relative">
      {tooltip && (
        <div
          className="fixed z-50 pointer-events-none px-2 py-1 rounded text-xs bg-gray-900 border border-gray-700 text-white shadow-lg"
          style={{ left: tooltip.x + 12, top: tooltip.y - 8 }}
        >
          {tooltip.text}
        </div>
      )}
      <div style={{ display: "inline-block", minWidth: LABEL_W + tags.length * CELL }}>
        <div style={{ display: "flex", marginLeft: LABEL_W }}>
          {tags.map((tag) => (
            <div
              key={tag}
              style={{
                width: CELL, minWidth: CELL, fontSize: 9, color: "#9ca3af",
                transform: "rotate(-45deg)", transformOrigin: "bottom left",
                height: 64, overflow: "hidden", whiteSpace: "nowrap", paddingLeft: 2,
              }}
            >
              {tag}
            </div>
          ))}
        </div>
        {tags.map((rowTag, i) => (
          <div key={rowTag} style={{ display: "flex", alignItems: "center" }}>
            <div
              style={{
                width: LABEL_W, minWidth: LABEL_W, fontSize: 10, color: "#9ca3af",
                overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis",
                paddingRight: 6, textAlign: "right",
              }}
            >
              {rowTag}
            </div>
            {tags.map((colTag, j) => {
              const val = matrix[i][j];
              const isDiag = i === j;
              const opacity = isDiag ? 0.25 : val / maxOff;
              const bg = isDiag
                ? "rgba(99,102,241,0.35)"
                : `rgba(233,69,96,${Math.min(opacity, 1).toFixed(2)})`;
              return (
                <div
                  key={colTag}
                  style={{
                    width: CELL, minWidth: CELL, height: CELL, background: bg,
                    border: "1px solid rgba(255,255,255,0.04)", cursor: "default",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 8, color: val > 0 ? "rgba(255,255,255,0.6)" : "transparent",
                  }}
                  onMouseMove={(e) =>
                    setTooltip({
                      x: e.clientX, y: e.clientY,
                      text: isDiag
                        ? `${rowTag}: ${val} images`
                        : `${rowTag} + ${colTag}: ${val} images`,
                    })
                  }
                  onMouseLeave={() => setTooltip(null)}
                >
                  {val > 0 ? val : ""}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── StatsPage ────────────────────────────────────────────────────────────────
export default function StatsPage() {
  const { datasetId } = useParams<{ datasetId: string }>();
  const [panelFilter, setPanelFilter] = useState<PanelFilter>(null);

  const { data: stats, isLoading } = useQuery({
    queryKey: ["dataset-stats", datasetId],
    queryFn: () => datasetsApi.stats(datasetId!),
    enabled: !!datasetId,
  });

  const { data: tagStats = [] } = useQuery({
    queryKey: ["tag-stats", datasetId],
    queryFn: () => captionsApi.tagStats(datasetId!),
    enabled: !!datasetId,
  });

  const { data: cooccurrence } = useQuery({
    queryKey: ["tag-cooccurrence", datasetId],
    queryFn: () => datasetsApi.tagCooccurrence(datasetId!),
    enabled: !!datasetId,
  });

  if (isLoading) return <div className="p-8 text-gray-500">Loading stats…</div>;
  if (!stats) return <div className="p-8 text-gray-500">No data</div>;

  // ── Chart data ──
  const blurData    = scoreEntries(stats.blur_distribution,        BLUR_LABELS,  BLUR_EDGES,  "blur_score",        "asc");
  const noiseData   = scoreEntries(stats.noise_distribution,       NOISE_LABELS, NOISE_EDGES, "noise_score",       "desc");
  const uniData     = scoreEntries(stats.uniformity_distribution,  UNI_LABELS,   UNI_EDGES,   "uniformity_score",  "asc");
  const colorData   = scoreEntries(stats.color_distribution,       COLOR_LABELS, COLOR_EDGES, "color_score",       "asc");
  const satData     = scoreEntries(stats.saturation_distribution,  SAT_LABELS,   SAT_EDGES,   "saturation_score",  "asc");
  const watermarkData = wmEntries(stats.watermark_distribution);
  const megapixelData = mpEntries(stats.megapixel_distribution);
  const fileSizeData  = fsEntries(stats.file_size_distribution);
  const arData = Object.keys(stats.aspect_ratio_fine).length > 0
    ? arFineEntries(stats.aspect_ratio_fine)
    : arCoarseEntries(stats.aspect_ratio_distribution);
  const aestheticData: ChartEntry[] = Object.entries(stats.score_distribution).map(([name, count]) => ({
    name,
    count,
    filter: AESTHETIC_FILTER_MAP[name],
  }));
  const formatData: ChartEntry[] = Object.entries(stats.format_distribution).map(([name, count]) => ({
    name,
    count,
    filter: { format_filter: name },
  }));
  const topTags = tagStats.slice(0, 20);

  // ── Conditional visibility ──
  const hasQualityScores = Object.keys(stats.blur_distribution).length > 0;
  const hasFlags    = Object.values(stats.quality_flag_counts).some((v) => v > 0);
  const hasCoverage = Object.values(stats.score_coverage).some((v) => v > 0);
  const hasCooccurrence = (cooccurrence?.tags.length ?? 0) > 0;
  const fs = stats.file_size_summary;

  // ── Click helpers ──
  const open = (title: string) => (entry: ChartEntry) => {
    if (entry.filter) setPanelFilter({ title, params: entry.filter });
  };
  const openFlag = (flag: string, label: string) =>
    setPanelFilter({ title: label, params: { quality_flag: flag } });

  const flagDefs = [
    { key: "blurry",      flag: "is_blurry",     label: "Blurry",      color: "text-orange-400" },
    { key: "noisy",       flag: "is_noisy",      label: "Noisy",       color: "text-yellow-400" },
    { key: "uniform",     flag: "is_uniform",    label: "Uniform",     color: "text-blue-400"   },
    { key: "watermarked", flag: "has_watermark",  label: "Watermarked", color: "text-red-400"    },
    { key: "duplicate",   flag: "is_duplicate",  label: "Duplicate",   color: "text-purple-400" },
  ];

  const coverageDefs = [
    { key: "aesthetic",  label: "Aesthetic"  },
    { key: "technical",  label: "Technical"  },
    { key: "watermark",  label: "Watermark"  },
    { key: "embeddings", label: "Embeddings" },
  ];

  return (
    <div className="p-6 space-y-8 max-w-6xl">
      <h2 className="text-xl font-semibold">Dataset Statistics</h2>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total Images",    value: stats.image_count.toLocaleString() },
          { label: "Captioned",       value: `${stats.caption_coverage_pct}%` },
          { label: "Total Size",      value: formatSize(stats.total_size_mb) },
          { label: "Avg Dimensions",  value: stats.avg_width ? `${Math.round(stats.avg_width)}×${Math.round(stats.avg_height!)}` : "—" },
        ].map(({ label, value }) => (
          <div key={label} className="card p-4 text-center">
            <div className="text-2xl font-bold text-white">{value}</div>
            <div className="text-xs text-gray-500 mt-1">{label}</div>
          </div>
        ))}
      </div>

      {/* Score coverage */}
      {hasCoverage && (
        <div>
          <SectionHeader title="Scoring Coverage" />
          <div className="flex flex-wrap gap-2">
            {coverageDefs.map(({ key, label }) => {
              const n = stats.score_coverage[key] ?? 0;
              const pct = stats.image_count > 0 ? Math.round((n / stats.image_count) * 100) : 0;
              return (
                <div key={key} className="card px-3 py-2 flex items-center gap-2 text-sm">
                  <span className="text-gray-400">{label}:</span>
                  <span className="text-white font-medium">{n.toLocaleString()}</span>
                  <span className="text-gray-500 text-xs">/ {stats.image_count.toLocaleString()} ({pct}%)</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Quality flags */}
      {hasFlags && (
        <div>
          <SectionHeader title="Quality Flags" />
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {flagDefs.map(({ key, flag, label, color }) => {
              const n = stats.quality_flag_counts[key] ?? 0;
              const pct = stats.image_count > 0 ? ((n / stats.image_count) * 100).toFixed(1) : "0";
              return (
                <button
                  key={key}
                  className="card p-3 text-center hover:ring-1 hover:ring-gray-600 transition-all disabled:opacity-40 disabled:cursor-default"
                  disabled={n === 0}
                  onClick={() => n > 0 && openFlag(flag, `${label} images`)}
                  title={n > 0 ? `Click to view ${n} ${label.toLowerCase()} images` : undefined}
                >
                  <div className={`text-2xl font-bold ${color}`}>{n.toLocaleString()}</div>
                  <div className="text-xs text-gray-500 mt-1">{label}</div>
                  <div className="text-xs text-gray-600 mt-0.5">{pct}% of total</div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Score distributions */}
      {hasQualityScores && (
        <div>
          <SectionHeader title="Score Distributions" />
          <p className="text-xs text-gray-600 mb-3 -mt-2">Click any bar to view the images in that range.</p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              { title: "Blur Score",         subtitle: "higher = sharper", data: blurData,      color: "#22d3ee", panelTitle: "Blur score" },
              { title: "Noise Score",        subtitle: "lower = cleaner",  data: noiseData,     color: "#a78bfa", panelTitle: "Noise score" },
              { title: "Uniformity Score",   subtitle: "higher = detail",  data: uniData,       color: "#34d399", panelTitle: "Uniformity score" },
              { title: "Watermark Score",    subtitle: "lower = cleaner",  data: watermarkData, color: "#e94560", panelTitle: "Watermark score" },
              { title: "Color Richness",     subtitle: "",                 data: colorData,     color: "#fb923c", panelTitle: "Color richness" },
              { title: "Saturation",         subtitle: "",                 data: satData,       color: "#6366f1", panelTitle: "Saturation" },
            ].map(({ title, subtitle, data, color, panelTitle }) => (
              <div key={title} className="card p-4">
                <div className="text-xs font-medium text-gray-400 mb-2">
                  {title}{subtitle && <span className="text-gray-600"> ({subtitle})</span>}
                </div>
                <MiniBarChart
                  data={data}
                  color={color}
                  xAngle={-35}
                  onBarClick={open(panelTitle)}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Aesthetic score */}
      <div className="card p-4">
        <div className="text-sm font-medium text-gray-400 mb-1">Aesthetic Scores</div>
        <p className="text-xs text-gray-600 mb-3">Click any bar to view those images.</p>
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={aestheticData}>
            <XAxis dataKey="name" tick={AXIS_TICK} />
            <YAxis tick={AXIS_TICK} />
            <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "rgba(255,255,255,0.05)" }} />
            <Bar
              dataKey="count"
              fill="#6366f1"
              radius={[2, 2, 0, 0]}
              cursor="pointer"
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              onClick={(d: any) => { if (d?.filter) setPanelFilter({ title: `Aesthetic: ${d.name}`, params: d.filter }); }}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Dimensions & size */}
      <div>
        <SectionHeader title="Dimensions &amp; File Size" />
        <p className="text-xs text-gray-600 mb-3 -mt-2">Click any bar to view those images.</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="card p-4">
            <div className="text-xs font-medium text-gray-400 mb-2">Aspect Ratio</div>
            <MiniBarChart data={arData} color={COLORS[0]} onBarClick={open("Aspect ratio")} />
          </div>
          <div className="card p-4">
            <div className="text-xs font-medium text-gray-400 mb-2">Megapixels</div>
            <MiniBarChart data={megapixelData} color={COLORS[2]} xAngle={-35} onBarClick={open("Megapixels")} />
          </div>
          <div className="card p-4">
            <div className="text-xs font-medium text-gray-400 mb-2">File Size</div>
            <MiniBarChart data={fileSizeData} color={COLORS[5]} xAngle={-35} onBarClick={open("File size")} />
            {Object.keys(fs).length > 0 && (
              <div className="grid grid-cols-2 gap-1 mt-3 pt-3 border-t border-gray-800">
                {[
                  { label: "Min",    value: `${fs.min_mb?.toFixed(2)} MB`    },
                  { label: "Median", value: `${fs.median_mb?.toFixed(2)} MB` },
                  { label: "p95",    value: `${fs.p95_mb?.toFixed(2)} MB`    },
                  { label: "Max",    value: `${fs.max_mb?.toFixed(2)} MB`    },
                ].map(({ label, value }) => (
                  <div key={label} className="text-center">
                    <div className="text-xs text-gray-500">{label}</div>
                    <div className="text-xs text-white font-medium">{value}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Caption analytics */}
      {Object.keys(stats.caption_length_distribution).length > 0 && (
        <div className="card p-4">
          <div className="text-sm font-medium text-gray-400 mb-3">Caption Word Count</div>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={Object.entries(stats.caption_length_distribution).map(([name, count]) => ({ name, count }))}>
              <XAxis dataKey="name" tick={AXIS_TICK} />
              <YAxis tick={AXIS_TICK} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                {Object.keys(stats.caption_length_distribution).map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Tag analytics */}
      {topTags.length > 0 && (
        <div>
          <SectionHeader title="Tag Analytics" />
          <div className="card p-4 mb-4">
            <div className="text-sm font-medium text-gray-400 mb-3">Top 20 Tags</div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={topTags} layout="vertical">
                <XAxis type="number" tick={AXIS_TICK} />
                <YAxis dataKey="tag" type="category" width={130} tick={{ fontSize: 10, fill: "#9ca3af" }} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Bar dataKey="count" fill="#22d3ee" radius={[0, 2, 2, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          {hasCooccurrence && (
            <div className="card p-4">
              <div className="text-sm font-medium text-gray-400 mb-1">Tag Co-occurrence Matrix</div>
              <div className="text-xs text-gray-600 mb-4">
                Cell brightness = how often two tags appear on the same image. Diagonal = single-tag count.
              </div>
              <CooccurrenceHeatmap tags={cooccurrence!.tags} matrix={cooccurrence!.matrix} />
            </div>
          )}
        </div>
      )}

      {/* Formats */}
      <div className="card p-4">
        <div className="text-sm font-medium text-gray-400 mb-1">File Formats</div>
        <p className="text-xs text-gray-600 mb-3">Click any bar to view those images.</p>
        <ResponsiveContainer width="100%" height={140}>
          <BarChart data={formatData}>
            <XAxis dataKey="name" tick={AXIS_TICK} />
            <YAxis tick={AXIS_TICK} />
            <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "rgba(255,255,255,0.05)" }} />
            <Bar
              dataKey="count"
              fill="#e94560"
              radius={[2, 2, 0, 0]}
              cursor="pointer"
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              onClick={(d: any) => { if (d?.filter) setPanelFilter({ title: `Format: ${d.name}`, params: d.filter }); }}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Bucket panel modal */}
      {panelFilter && (
        <BucketPanel
          title={panelFilter.title}
          params={panelFilter.params}
          datasetId={datasetId!}
          onClose={() => setPanelFilter(null)}
        />
      )}
    </div>
  );
}
