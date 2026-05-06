import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Sparkles, Cpu, Zap } from "lucide-react";
import toast from "react-hot-toast";
import { captioningApi } from "../api/captioning";
import { useJobSSE } from "../hooks/useSSE";
import { useJobStore } from "../store/jobStore";
import PromptPresetManager from "../components/caption/PromptPresetManager";
import ResolutionPicker from "../components/caption/ResolutionPicker";
import type { ModelInfo, OllamaModel } from "../types";

const STYLE_LABELS: Record<string, string[]> = {
  florence2: ["short", "detailed", "tags", "dense", "promptgen"],
  paligemma2: ["short", "detailed", "tags", "booru"],
  ollama: ["short", "detailed", "tags", "booru"],
};

export default function CaptioningPage() {
  const { datasetId } = useParams<{ datasetId: string }>();
  const [selectedModel, setSelectedModel] = useState("");
  const [style, setStyle] = useState("detailed");
  const [overwrite, setOverwrite] = useState(false);
  const [customPrompt, setCustomPrompt] = useState("");
  const [targetWidth, setTargetWidth] = useState<number | null>(null);
  const [targetHeight, setTargetHeight] = useState<number | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  useJobSSE(activeJobId);
  const jobProgress = useJobStore((s) => s.activeJobs.get(activeJobId ?? ""));

  const { data: modelsData, isLoading } = useQuery({
    queryKey: ["captioning-models"],
    queryFn: captioningApi.models,
  });

  const runMutation = useMutation({
    mutationFn: () =>
      captioningApi.run({
        dataset_id: datasetId!,
        model: selectedModel,
        style,
        overwrite,
        custom_prompt: customPrompt,
        ...(targetWidth && targetHeight ? { target_width: targetWidth, target_height: targetHeight } : {}),
      }),
    onSuccess: (data) => {
      if (data.job_id) {
        setActiveJobId(data.job_id);
        toast.success(`Captioning started — ${data.total} images queued`);
      } else {
        toast("No images to caption (all already captioned)");
      }
    },
    onError: () => toast.error("Failed to start captioning"),
  });

  const unloadMutation = useMutation({
    mutationFn: (modelId: string) => captioningApi.unloadModel(modelId),
    onSuccess: () => toast.success("Model unloaded"),
  });

  const localModels = (modelsData?.local_models ?? []) as ModelInfo[];
  const ollamaModels = (modelsData?.ollama_models ?? []) as OllamaModel[];

  const modelType = selectedModel.startsWith("ollama:") ? "ollama"
    : selectedModel === "paligemma2" ? "paligemma2"
    : selectedModel.startsWith("florence2") ? "florence2"
    : null;

  const availableStyles = modelType ? STYLE_LABELS[modelType] : [];

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <h2 className="text-xl font-semibold">AI Captioning</h2>

      {/* Model selection */}
      <div className="card p-5 space-y-4">
        <h3 className="font-medium flex items-center gap-2"><Cpu size={16} /> Local Models</h3>
        {isLoading ? <p className="text-gray-500 text-sm">Loading models...</p> : (
          <div className="space-y-2">
            {localModels.map((m) => (
              <div
                key={m.id}
                className={`flex items-center gap-3 p-3 rounded border cursor-pointer transition-colors ${
                  selectedModel === m.id ? "border-accent bg-accent/10" : "border-gray-700 hover:border-gray-500"
                }`}
                onClick={() => { setSelectedModel(m.id); setStyle("detailed"); }}
              >
                <div className="flex-1">
                  <div className="text-sm font-medium">{m.name}</div>
                  <div className="text-xs text-gray-500">{m.vram_mb / 1024}GB VRAM</div>
                </div>
                {m.loaded && <span className="badge-green">Loaded</span>}
                {m.loaded && (
                  <button
                    className="btn-ghost btn-sm text-xs"
                    onClick={(e) => { e.stopPropagation(); unloadMutation.mutate(m.id); }}
                  >
                    Unload
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card p-5 space-y-4">
        <h3 className="font-medium flex items-center gap-2"><Zap size={16} /> Ollama Models</h3>
        {ollamaModels.length === 0 ? (
          <p className="text-gray-500 text-sm">No Ollama vision models found. Is Ollama running?</p>
        ) : (
          <div className="space-y-2">
            {ollamaModels.map((m) => (
              <div
                key={m.id}
                className={`flex items-center gap-3 p-3 rounded border cursor-pointer transition-colors ${
                  selectedModel === m.id ? "border-accent bg-accent/10" : "border-gray-700 hover:border-gray-500"
                }`}
                onClick={() => { setSelectedModel(m.id); setStyle("detailed"); }}
              >
                <div className="flex-1">
                  <div className="text-sm font-medium">{m.name}</div>
                  <div className="text-xs text-gray-500">{m.size_mb > 0 ? `${(m.size_mb / 1024).toFixed(1)}GB` : ""}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Options */}
      {selectedModel && (
        <div className="card p-5 space-y-4">
          <h3 className="font-medium">Options</h3>

          <div>
            <label className="label">Caption Style</label>
            <div className="flex flex-wrap gap-2">
              {availableStyles.map((s) => (
                <button
                  key={s}
                  className={`btn btn-sm ${style === s ? "btn-primary" : "btn-secondary"}`}
                  onClick={() => setStyle(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <ResolutionPicker
            targetWidth={targetWidth}
            targetHeight={targetHeight}
            onChange={(w, h) => { setTargetWidth(w); setTargetHeight(h); }}
          />

          <div>
            <label className="label">Custom Prompt (optional)</label>
            <textarea
              className="input h-20 resize-y"
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              placeholder={
                selectedModel.startsWith("ollama:")
                  ? "Leave blank to use the style preset prompt..."
                  : "Override the default prompt for this style..."
              }
            />
          </div>

          <PromptPresetManager
            currentModel={selectedModel}
            currentStyle={style}
            currentPrompt={customPrompt}
            onLoad={(p) => {
              setSelectedModel(p.model);
              setStyle(p.style);
              setCustomPrompt(p.prompt);
            }}
          />

          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
            <span className="text-sm">Overwrite existing captions</span>
          </label>
        </div>
      )}

      {/* Progress */}
      {jobProgress && (
        <div className="card p-4 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span>{jobProgress.message || "Processing..."}</span>
            <span className="text-gray-400">{jobProgress.done}/{jobProgress.total}</span>
          </div>
          <div className="bg-gray-700 rounded-full h-2">
            <div className="bg-accent h-2 rounded-full transition-all" style={{ width: `${jobProgress.percent ?? 0}%` }} />
          </div>
          <p className="text-xs text-gray-500 truncate">{jobProgress.current_item}</p>
          {jobProgress.status === "completed" && <p className="text-green-400 text-sm">✓ Captioning complete</p>}
          {jobProgress.status === "failed" && <p className="text-red-400 text-sm">✗ Failed: {(jobProgress as any).message}</p>}
        </div>
      )}

      <button
        className="btn-primary flex items-center gap-2"
        onClick={() => runMutation.mutate()}
        disabled={!selectedModel || runMutation.isPending || jobProgress?.status === "running"}
      >
        <Sparkles size={14} />
        {runMutation.isPending ? "Starting..." : "Start Captioning"}
      </button>
    </div>
  );
}
