import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Star, RefreshCw, AlertTriangle, Layers, ChevronDown, ChevronUp } from "lucide-react";
import toast from "react-hot-toast";
import { qualityApi } from "../api/quality";
import { imagesApi } from "../api/images";
import { useJobSSE } from "../hooks/useSSE";
import { useJobStore } from "../store/jobStore";
import StyleReferencePicker from "../components/quality/StyleReferencePicker";

export default function QualityPage() {
  const { datasetId } = useParams<{ datasetId: string }>();
  const qc = useQueryClient();
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  // Scoring options
  const [runAesthetic, setRunAesthetic] = useState(true);
  const [runTechnical, setRunTechnical] = useState(true);
  const [runWatermark, setRunWatermark] = useState(false);
  const [runEmbeddings, setRunEmbeddings] = useState(false);
  const [runDino, setRunDino] = useState(false);

  // Style similarity
  const [showStyleSection, setShowStyleSection] = useState(false);
  const [selectedRefIds, setSelectedRefIds] = useState<Set<string>>(new Set());
  const [externalRefFiles, setExternalRefFiles] = useState<File[]>([]);
  const [embeddingType, setEmbeddingType] = useState<"clip" | "dino">("clip");

  useJobSSE(activeJobId);
  const jobProgress = useJobStore((s) => s.activeJobs.get(activeJobId ?? ""));

  useEffect(() => {
    if (jobProgress?.status === "completed") {
      qc.invalidateQueries({ queryKey: ["images", datasetId] });
      qc.invalidateQueries({ queryKey: ["duplicates", datasetId] });
      setActiveJobId(null);
    }
  }, [jobProgress?.status, datasetId, qc]);

  const { data: duplicates } = useQuery({
    queryKey: ["duplicates", datasetId],
    queryFn: () => qualityApi.duplicates(datasetId!),
    enabled: !!datasetId,
  });

  const scoreMutation = useMutation({
    mutationFn: () =>
      qualityApi.score({
        dataset_id: datasetId!,
        run_aesthetic: runAesthetic,
        run_technical: runTechnical,
        run_watermark: runWatermark,
        run_embeddings: runEmbeddings,
        run_dino: runEmbeddings && runDino,
      }),
    onSuccess: (data) => {
      if (data.job_id) {
        setActiveJobId(data.job_id);
        toast.success("Quality scoring started");
      }
    },
    onError: () => toast.error("Failed to start scoring"),
  });

  const resolveMutation = useMutation({
    mutationFn: ({ keep, del }: { keep: string[]; del: string[] }) =>
      qualityApi.resolveDuplicates(keep, del),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["duplicates", datasetId] });
      qc.invalidateQueries({ queryKey: ["images", datasetId] });
      toast.success("Duplicates resolved");
    },
  });

  const similarityMutation = useMutation({
    mutationFn: async () => {
      let reference_embeddings: string[] = [];
      if (externalRefFiles.length > 0) {
        const result = await qualityApi.embedReferences(externalRefFiles);
        reference_embeddings = result.embeddings;
      }
      return qualityApi.styleSimilarity({
        dataset_id: datasetId!,
        reference_image_ids: Array.from(selectedRefIds),
        reference_embeddings,
        embedding_type: externalRefFiles.length > 0 ? "clip" : embeddingType,
      });
    },
    onSuccess: (data) => {
      toast.success(`Style similarity scored for ${data.updated} images`);
      qc.invalidateQueries({ queryKey: ["images", datasetId] });
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Style similarity scoring failed";
      toast.error(msg);
    },
  });

  const toggleRef = (id: string) => {
    setSelectedRefIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const dupGroups = duplicates?.groups ?? [];
  const isRunning = scoreMutation.isPending || jobProgress?.status === "running";

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <h2 className="text-xl font-semibold">Quality Scoring</h2>

      {/* Controls */}
      <div className="card p-5 space-y-4">
        <h3 className="font-medium flex items-center gap-2"><Star size={16} />Run Quality Analysis</h3>

        <div className="space-y-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={runAesthetic} onChange={(e) => setRunAesthetic(e.target.checked)} />
            <span className="text-sm">Aesthetic Score (LAION)</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={runTechnical} onChange={(e) => setRunTechnical(e.target.checked)} />
            <span className="text-sm">Technical (blur, noise, duplicates, uniformity, color richness)</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={runWatermark} onChange={(e) => setRunWatermark(e.target.checked)} />
            <span className="text-sm">Watermark / text detection (uses CLIP)</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={runEmbeddings} onChange={(e) => setRunEmbeddings(e.target.checked)} />
            <span className="text-sm">Compute style embeddings (CLIP) — required for style similarity</span>
          </label>
          {runEmbeddings && (
            <label className="flex items-center gap-2 cursor-pointer ml-6">
              <input type="checkbox" checked={runDino} onChange={(e) => setRunDino(e.target.checked)} />
              <span className="text-sm text-gray-400">Also compute DINOv2 embeddings (~1.2 GB VRAM)</span>
            </label>
          )}
        </div>

        {/* Progress */}
        {jobProgress && (
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-gray-400">
              <span>{jobProgress.message}</span>
              <span>{jobProgress.done}/{jobProgress.total}</span>
            </div>
            <div className="bg-gray-700 rounded-full h-2">
              <div className="bg-accent h-2 rounded-full transition-all" style={{ width: `${jobProgress.percent ?? 0}%` }} />
            </div>
            {jobProgress.status === "completed" && <p className="text-green-400 text-xs">✓ Scoring complete</p>}
          </div>
        )}

        <button
          className="btn-primary flex items-center gap-2"
          onClick={() => scoreMutation.mutate()}
          disabled={isRunning}
        >
          <RefreshCw size={14} className={isRunning ? "animate-spin" : ""} /> Run Scoring
        </button>
      </div>

      {/* Score legend */}
      <div className="card p-4">
        <h3 className="font-medium mb-3 text-sm text-gray-400 uppercase tracking-wide">Score Guide</h3>
        <div className="flex gap-3 text-sm flex-wrap">
          <span className="badge-red">1–4 Low quality</span>
          <span className="badge-yellow">4–6 Average</span>
          <span className="badge-green">6–10 High quality</span>
          <span className="badge-gray">Unscored</span>
          <span className="badge-blue">Watermark detected</span>
          <span className="badge-orange">Near-uniform</span>
        </div>
      </div>

      {/* Style Similarity */}
      <div className="card p-5 space-y-4">
        <button
          className="w-full flex items-center justify-between"
          onClick={() => setShowStyleSection((v) => !v)}
        >
          <h3 className="font-medium flex items-center gap-2">
            <Layers size={16} />Style Similarity
          </h3>
          {showStyleSection ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>

        {showStyleSection && (
          <div className="space-y-4">
            <p className="text-xs text-gray-400">
              Select reference images that represent your target style. Dataset references require
              CLIP embeddings to be computed first (enable above). Local file references are
              embedded on-the-fly when you click Score Similarity.
            </p>

            <div className="space-y-1">
              <label className="label">Embedding model</label>
              <div className="flex gap-2">
                <button
                  className={embeddingType === "clip" ? "btn-primary btn-sm" : "btn-secondary btn-sm"}
                  onClick={() => setEmbeddingType("clip")}
                >
                  CLIP
                </button>
                <button
                  className={embeddingType === "dino" ? "btn-primary btn-sm" : "btn-secondary btn-sm"}
                  onClick={() => setEmbeddingType("dino")}
                  disabled={externalRefFiles.length > 0}
                  title={externalRefFiles.length > 0 ? "Local file references always use CLIP" : "Requires DINOv2 embeddings to be computed"}
                >
                  DINOv2
                </button>
              </div>
            </div>

            <div className="space-y-1">
              <label className="label">Reference images</label>
              {datasetId && (
                <StyleReferencePicker
                  datasetId={datasetId}
                  selectedIds={selectedRefIds}
                  onToggle={toggleRef}
                  externalFiles={externalRefFiles}
                  onExternalFilesChange={setExternalRefFiles}
                />
              )}
            </div>

            <button
              className="btn-primary flex items-center gap-2"
              onClick={() => similarityMutation.mutate()}
              disabled={(selectedRefIds.size === 0 && externalRefFiles.length === 0) || similarityMutation.isPending}
            >
              <RefreshCw size={14} className={similarityMutation.isPending ? "animate-spin" : ""} />
              Score Similarity
              {(selectedRefIds.size + externalRefFiles.length) > 0 &&
                ` (${selectedRefIds.size + externalRefFiles.length} refs)`}
            </button>
          </div>
        )}
      </div>

      {/* Duplicates */}
      {dupGroups.length > 0 && (
        <div className="card p-5 space-y-4">
          <h3 className="font-medium flex items-center gap-2">
            <AlertTriangle size={16} className="text-yellow-400" />
            Duplicate Groups ({dupGroups.length})
          </h3>
          <div className="space-y-4">
            {dupGroups.map((group, gi) => (
              <div key={gi} className="border border-gray-700 rounded p-3 space-y-2">
                <p className="text-xs text-gray-500">{group.length} similar images</p>
                <div className="flex gap-2 flex-wrap">
                  {group.map((img) => (
                    <div key={img.id} className="flex flex-col items-center gap-1">
                      <img
                        src={imagesApi.thumbnailUrl(img.id)}
                        alt={img.filename}
                        className="w-20 h-20 object-cover rounded border border-gray-600"
                      />
                      <span className="text-xs text-gray-500 truncate w-20 text-center">{img.filename}</span>
                      {img.aesthetic_score !== null && (
                        <span className="text-xs text-accent">{img.aesthetic_score?.toFixed(1)}</span>
                      )}
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <button
                    className="btn-secondary btn-sm"
                    onClick={() => resolveMutation.mutate({
                      keep: [group[0].id],
                      del: group.slice(1).map((i) => i.id),
                    })}
                  >
                    Keep First, Delete Rest
                  </button>
                  {group[0].aesthetic_score !== null && (
                    <button
                      className="btn-secondary btn-sm"
                      onClick={() => {
                        const best = [...group].sort((a, b) => (b.aesthetic_score ?? 0) - (a.aesthetic_score ?? 0));
                        resolveMutation.mutate({
                          keep: [best[0].id],
                          del: best.slice(1).map((i) => i.id),
                        });
                      }}
                    >
                      Keep Best Score
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
