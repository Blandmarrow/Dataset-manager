import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { captioningApi } from "../api/captioning";
import { datasetsApi } from "../api/datasets";
import { useJobSSE } from "../hooks/useSSE";
import { useJobStore } from "../store/jobStore";
import { useSelectionStore } from "../store/selectionStore";
import ResolutionPicker from "../components/caption/ResolutionPicker";
import type { ModelInfo, OllamaModel } from "../types";

const STYLE_LABELS: Record<string, string[]> = {
  florence2: ["short", "detailed", "tags", "dense", "promptgen"],
  paligemma2: ["short", "detailed", "tags", "booru"],
  ollama: ["short", "detailed", "tags", "booru"],
};

type Scope = "uncaptioned" | "selected" | "all";

export default function CaptioningPage() {
  const { datasetId } = useParams<{ datasetId: string }>();
  const qc = useQueryClient();
  const { selectedIds, count: selCount } = useSelectionStore();

  const [selectedModel, setSelectedModel] = useState("");
  const [ollamaModelInput, setOllamaModelInput] = useState("");
  const [style, setStyle] = useState("detailed");
  const [customPrompt, setCustomPrompt] = useState("");
  const [targetWidth, setTargetWidth] = useState<number | null>(null);
  const [targetHeight, setTargetHeight] = useState<number | null>(null);
  const [scope, setScope] = useState<Scope>("uncaptioned");
  const [appendTags, setAppendTags] = useState(true);
  const [stripRefusals, setStripRefusals] = useState(true);
  const [saveBackup, setSaveBackup] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  useJobSSE(activeJobId);
  const jobProgress = useJobStore((s) => s.activeJobs.get(activeJobId ?? ""));

  const { data: modelsData, isLoading } = useQuery({
    queryKey: ["captioning-models"],
    queryFn: captioningApi.models,
  });
  const { data: dataset } = useQuery({
    queryKey: ["dataset", datasetId],
    queryFn: () => datasetsApi.get(datasetId!),
    enabled: !!datasetId,
  });

  const localModels = (modelsData?.local_models ?? []) as ModelInfo[];
  const ollamaModels = (modelsData?.ollama_models ?? []) as OllamaModel[];

  const modelType = selectedModel.startsWith("ollama:") ? "ollama"
    : selectedModel === "paligemma2" ? "paligemma2"
    : selectedModel.startsWith("florence2") ? "florence2"
    : null;
  const availableStyles = modelType ? STYLE_LABELS[modelType] : [];

  const unloadMutation = useMutation({
    mutationFn: (modelId: string) => captioningApi.unloadModel(modelId),
    onSuccess: () => toast.success("Model unloaded"),
  });

  const runMutation = useMutation({
    mutationFn: () => captioningApi.run({
      dataset_id: datasetId!,
      model: selectedModel,
      style,
      overwrite: scope === "all",
      custom_prompt: customPrompt,
      image_ids: scope === "selected" ? [...selectedIds] : undefined,
      ...(targetWidth && targetHeight ? { target_width: targetWidth, target_height: targetHeight } : {}),
      append_tags: appendTags,
      strip_refusals: stripRefusals,
      save_backup: saveBackup,
    }),
    onSuccess: (data) => {
      if (data.job_id) {
        setActiveJobId(data.job_id);
        toast.success(`Captioning started — ${data.total} images queued`);
        qc.invalidateQueries({ queryKey: ["dataset", datasetId] });
      } else {
        toast("No images to caption");
      }
    },
    onError: () => toast.error("Failed to start captioning"),
  });

  const uncaptioned = (dataset?.image_count ?? 0) - (dataset?.captioned_count ?? 0);
  const isRunning = jobProgress?.status === "running";
  const isDone = jobProgress?.status === "completed";
  const isFailed = jobProgress?.status === "failed";

  return (
    <div style={{ padding: "24px 28px", overflowY: "auto", flex: 1 }}>
      <div className="page-h">
        <div>
          <h1>Captioning</h1>
          <p>Generate captions and tags for training. Long jobs run in the background; close this page anytime.</p>
        </div>
        <div className="phactions">
          <button
            className="btn primary"
            onClick={() => runMutation.mutate()}
            disabled={!selectedModel || runMutation.isPending || isRunning}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M4 3l8 5-8 5V3z"/>
            </svg>
            {runMutation.isPending ? "Starting…" : "Run captioning"}
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 16, alignItems: "start" }}>
        {/* Left: Configuration */}
        <div className="panel">
          <div className="panel-h">
            <h3>Configuration</h3>
            <div style={{ flex: 1 }} />
            <span className="badge solid mono">{dataset?.captioned_count ?? 0} / {dataset?.image_count ?? 0} captioned</span>
          </div>
          <div style={{ padding: "4px 22px" }}>

            {/* Model */}
            <div className="form-row">
              <div className="lbl-col">
                <h4>Model</h4>
                <p>Vision-language model that generates the caption.</p>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {isLoading && <span style={{ color: "var(--fg-mute)", fontSize: 12 }}>Loading models…</span>}

                {/* Local models */}
                {localModels.map((m) => (
                  <div
                    key={m.id}
                    className={`model-row${selectedModel === m.id ? " sel" : ""}`}
                    onClick={() => { setSelectedModel(m.id); setOllamaModelInput(""); setStyle("detailed"); }}
                  >
                    <div className="ind" />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="mr-name">{m.name}</div>
                      <div className="mr-desc">{m.id.startsWith("florence2") ? "Microsoft · best for descriptive prose" : "Google · accepts custom prompt · requires HF token"}</div>
                    </div>
                    {m.loaded && (
                      <button
                        className="btn ghost sm"
                        style={{ fontSize: 10.5 }}
                        onClick={(e) => { e.stopPropagation(); unloadMutation.mutate(m.id); }}
                      >
                        Unload
                      </button>
                    )}
                    <span className="mr-vram">{m.vram_mb ? `${(m.vram_mb / 1024).toFixed(1)} GB` : "—"}</span>
                  </div>
                ))}

                {/* Ollama section */}
                <div style={{ fontSize: 10.5, color: "var(--fg-dim)", letterSpacing: ".04em", textTransform: "uppercase", padding: "6px 0 2px", marginTop: 2 }}>Ollama</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <select
                    className="select"
                    style={{ flex: 1 }}
                    value={ollamaModels.some((m) => m.id === selectedModel) ? selectedModel : ""}
                    onChange={(e) => {
                      if (e.target.value) {
                        setSelectedModel(e.target.value);
                        setOllamaModelInput("");
                        setStyle("detailed");
                      }
                    }}
                  >
                    <option value="">— select a model —</option>
                    {ollamaModels.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}{m.size_mb > 0 ? ` (${(m.size_mb / 1024).toFixed(1)} GB)` : ""}
                      </option>
                    ))}
                  </select>
                  <input
                    className="input"
                    placeholder="or type name…"
                    value={ollamaModelInput}
                    onChange={(e) => {
                      setOllamaModelInput(e.target.value);
                      setSelectedModel(e.target.value ? `ollama:${e.target.value}` : "");
                      setStyle("detailed");
                    }}
                    style={{ width: 140 }}
                  />
                </div>
              </div>
            </div>

            {/* Style */}
            {availableStyles.length > 0 && (
              <div className="form-row">
                <div className="lbl-col">
                  <h4>Style</h4>
                  <p>Output format for the generated caption.</p>
                </div>
                <div className="row-flex">
                  {availableStyles.map((s) => (
                    <button key={s} className={`btn sm${style === s ? " primary" : ""}`} onClick={() => setStyle(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Prompt */}
            <div className="form-row">
              <div className="lbl-col">
                <h4>Prompt</h4>
                <p>Override the default model prompt. Used by PaliGemma and Ollama.</p>
              </div>
              <div>
                <textarea
                  className="input"
                  style={{ height: 80 }}
                  value={customPrompt}
                  onChange={(e) => setCustomPrompt(e.target.value)}
                  placeholder="Leave blank to use the style preset prompt…"
                />
              </div>
            </div>

            {/* Target resolution */}
            <div className="form-row">
              <div className="lbl-col">
                <h4>Target resolution</h4>
                <p>Center-crop & resize to the resolution your trainer uses, so captions describe what the model actually sees.</p>
              </div>
              <ResolutionPicker
                targetWidth={targetWidth}
                targetHeight={targetHeight}
                onChange={(w, h) => { setTargetWidth(w); setTargetHeight(h); }}
              />
            </div>

            {/* Scope */}
            <div className="form-row">
              <div className="lbl-col">
                <h4>Scope</h4>
                <p>Which images to caption.</p>
              </div>
              <div className="row-flex">
                {([
                  { value: "uncaptioned", label: `Uncaptioned only`, sub: uncaptioned },
                  { value: "selected", label: "Selected", sub: selCount },
                  { value: "all", label: "Re-caption all", sub: null },
                ] as const).map((opt) => (
                  <label key={opt.value} className="row-flex" style={{ gap: 6, cursor: "pointer" }}>
                    <input type="radio" name="scope" checked={scope === opt.value} onChange={() => setScope(opt.value)} />
                    <span style={{ fontSize: 12.5 }}>
                      {opt.label}
                      {opt.sub !== null && <span className="mono" style={{ color: "var(--fg-dim)", marginLeft: 4 }}>{opt.sub}</span>}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {/* Options */}
            <div className="form-row">
              <div className="lbl-col">
                <h4>Options</h4>
                <p>Post-processing applied to each caption.</p>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {[
                  { label: <>Append existing tags from <span className="mono">tags_json</span></>, val: appendTags, set: setAppendTags },
                  { label: "Strip refusal phrases & identity guesses", val: stripRefusals, set: setStripRefusals },
                  { label: <>Save backup of previous caption to <span className="mono">.caption.bak</span></>, val: saveBackup, set: setSaveBackup },
                ].map((opt, i) => (
                  <label key={i} className="row-flex" style={{ gap: 8, cursor: "pointer" }}>
                    <input type="checkbox" className="checkbox" checked={opt.val} onChange={(e) => opt.set(e.target.checked)} />
                    <span style={{ fontSize: 12.5 }}>{opt.label}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Right: Live progress */}
        <div className="panel">
          <div className="panel-h"><h3>Live progress</h3></div>
          <div className="panel-b">
            {!jobProgress ? (
              <div className="empty-state" style={{ padding: "40px 20px" }}>
                <svg width="32" height="32" viewBox="0 0 16 16" fill="none" stroke="var(--fg-soft)" strokeWidth="1.2">
                  <path d="M4 3l8 5-8 5V3z"/>
                </svg>
                <span style={{ color: "var(--fg-dim)", fontSize: 12 }}>Run captioning to see progress here</span>
              </div>
            ) : (
              <>
                <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 10, marginBottom: 14 }}>
                  <div>
                    <div style={{ fontSize: 28, fontWeight: 600, letterSpacing: "-.02em", fontFamily: "Geist Mono, monospace" }}>
                      {jobProgress.done ?? 0}
                      <span style={{ color: "var(--fg-dim)", fontSize: 18 }}>/{jobProgress.total ?? 0}</span>
                    </div>
                    <div style={{ color: "var(--fg-mute)", fontSize: 12, marginTop: 2 }}>
                      {isDone ? "Complete" : isFailed ? "Failed" : "Processing…"}
                    </div>
                  </div>
                  <span className={`badge dot ${isDone ? "good" : isFailed ? "bad" : "info"}`}>
                    {isDone ? "Done" : isFailed ? "Failed" : "Running"}
                  </span>
                </div>

                {/* Progress bar */}
                <div style={{ height: 5, background: "var(--surface-3)", borderRadius: 3, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${jobProgress.percent ?? 0}%`, background: "linear-gradient(90deg, var(--accent-2), var(--accent))", transition: "width .4s" }} />
                </div>

                <div className="divider" />

                {/* Stats */}
                <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12, marginBottom: 14 }}>
                  {(jobProgress as any).throughput_ips && (
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "var(--fg-mute)" }}>Throughput</span>
                      <span className="mono">{((jobProgress as any).throughput_ips as number).toFixed(1)} img/s</span>
                    </div>
                  )}
                  {(jobProgress as any).vram_used_mb && (
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "var(--fg-mute)" }}>VRAM</span>
                      <span className="mono">{Math.round((jobProgress as any).vram_used_mb / 1024 * 10) / 10} GB used</span>
                    </div>
                  )}
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--fg-mute)" }}>Last image</span>
                    <span className="mono" style={{ color: "var(--fg-dim)", maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {jobProgress.current_item || "—"}
                    </span>
                  </div>
                </div>

                {/* Last caption preview */}
                {jobProgress.message && !isDone && !isFailed && (
                  <div style={{ padding: "10px 12px", background: "var(--surface-2)", border: "1px solid var(--line)", borderRadius: "var(--r)", fontSize: 12, color: "var(--fg)" }}>
                    {jobProgress.message}
                  </div>
                )}

                {isDone && <p style={{ color: "var(--good)", fontSize: 12, marginTop: 8 }}>✓ Captioning complete</p>}
                {isFailed && <p style={{ color: "var(--bad)", fontSize: 12, marginTop: 8 }}>✗ Captioning failed</p>}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
