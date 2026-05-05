import { useState, useCallback, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Save, Crop, AlertTriangle, Copy, Sparkles, ChevronDown, ChevronUp } from "lucide-react";
import Cropper from "react-easy-crop";
import toast from "react-hot-toast";
import { imagesApi } from "../api/images";
import { captionsApi } from "../api/captions";
import { captioningApi } from "../api/captioning";
import { useJobStore } from "../store/jobStore";
import TagEditor from "../components/caption/TagEditor";
import PromptPresetManager from "../components/caption/PromptPresetManager";
import type { ModelInfo, OllamaModel } from "../types";

function formatSize(bytes: number | null) {
  if (!bytes) return "—";
  return bytes < 1_048_576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1_048_576).toFixed(1)} MB`;
}

interface CropArea { x: number; y: number; width: number; height: number; }

const STYLE_LABELS: Record<string, string[]> = {
  florence2: ["short", "detailed", "tags", "dense", "promptgen"],
  paligemma2: ["short", "detailed", "tags", "booru"],
  ollama: ["short", "detailed", "tags", "booru"],
};

function modelType(model: string) {
  if (model.startsWith("ollama:")) return "ollama";
  if (model === "paligemma2") return "paligemma2";
  if (model.startsWith("florence2")) return "florence2";
  return null;
}

export default function ImageDetailPage() {
  const { datasetId, imageId } = useParams<{ datasetId: string; imageId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [tags, setTags] = useState<string[]>([]);
  const [captionText, setCaptionText] = useState("");
  const [captionStyle, setCaptionStyle] = useState("");
  const [captionDirty, setCaptionDirty] = useState(false);
  const [cropMode, setCropMode] = useState(false);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [aspect, setAspect] = useState<number | undefined>(undefined);
  const [croppedArea, setCroppedArea] = useState<CropArea | null>(null);

  // AI captioning state
  const [showAi, setShowAi] = useState(false);
  const [aiModel, setAiModel] = useState("");
  const [aiStyle, setAiStyle] = useState("detailed");
  const [aiCustomPrompt, setAiCustomPrompt] = useState("");
  const [aiJobId, setAiJobId] = useState<string | null>(null);

  const { data: image, isLoading: imageLoading } = useQuery({
    queryKey: ["image", imageId],
    queryFn: () => imagesApi.get(imageId!),
    enabled: !!imageId,
  });

  const { data: captionData } = useQuery({
    queryKey: ["caption", imageId],
    queryFn: () => captionsApi.get(imageId!),
    enabled: !!imageId,
  });

  const { data: modelsData } = useQuery({
    queryKey: ["captioning-models"],
    queryFn: captioningApi.models,
    enabled: showAi,
  });

  const localModels = (modelsData?.local_models ?? []) as ModelInfo[];
  const ollamaModels = (modelsData?.ollama_models ?? []) as OllamaModel[];
  const aiModelType = modelType(aiModel);
  const aiStyles = aiModelType ? (STYLE_LABELS[aiModelType] ?? []) : [];

  // Track AI job progress from the global SSE store (TopBar already subscribes to all jobs)
  const aiJobProgress = useJobStore((s) => s.activeJobs.get(aiJobId ?? ""));

  // When AI job completes, refresh caption
  useEffect(() => {
    if (!aiJobId || !aiJobProgress) return;
    if (aiJobProgress.status === "completed") {
      setCaptionDirty(false);
      qc.invalidateQueries({ queryKey: ["caption", imageId] });
      qc.invalidateQueries({ queryKey: ["images", datasetId] });
      setAiJobId(null);
      toast.success("Caption generated");
    } else if (aiJobProgress.status === "failed") {
      setAiJobId(null);
      toast.error("Captioning failed");
    }
  }, [aiJobProgress?.status, aiJobId, imageId, datasetId, qc]);

  useEffect(() => {
    if (captionData && !captionDirty) {
      setTags(captionData.tags);
      setCaptionText(captionData.caption_text);
      setCaptionStyle(captionData.caption_style);
    }
  }, [captionData]);

  const saveMutation = useMutation({
    mutationFn: () => captionsApi.update(imageId!, { caption_text: captionText, tags, caption_style: captionStyle }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["caption", imageId] });
      qc.invalidateQueries({ queryKey: ["images", datasetId] });
      setCaptionDirty(false);
      toast.success("Saved");
    },
    onError: () => toast.error("Save failed"),
  });

  const cropMutation = useMutation({
    mutationFn: () => {
      if (!croppedArea) throw new Error("No crop area");
      return imagesApi.crop(imageId!, croppedArea);
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["image", imageId] });
      qc.invalidateQueries({ queryKey: ["images", datasetId] });
      setCropMode(false);
      toast.success(`Cropped to ${data.width}×${data.height}`);
    },
    onError: () => toast.error("Crop failed"),
  });

  const aiMutation = useMutation({
    mutationFn: () =>
      captioningApi.run({
        dataset_id: datasetId!,
        image_ids: [imageId!],
        model: aiModel,
        style: aiStyle,
        overwrite: true,
        custom_prompt: aiCustomPrompt,
      }),
    onSuccess: (data) => {
      if (data.job_id) {
        setAiJobId(data.job_id);
      } else {
        toast("Caption already exists — generation skipped");
      }
    },
    onError: () => toast.error("Failed to start captioning"),
  });

  const onCropComplete = useCallback((_: unknown, croppedPixels: CropArea) => {
    setCroppedArea(croppedPixels);
  }, []);

  if (imageLoading || !image) {
    return <div className="p-8 text-gray-500">Loading...</div>;
  }

  const isDuplicate = image.quality_flags?.is_duplicate as boolean | undefined;
  const isBlurry = image.quality_flags?.is_blurry as boolean | undefined;
  const aiRunning = !!aiJobId && aiJobProgress?.status === "running";

  return (
    <div className="flex h-full">
      {/* Left: image */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="p-3 border-b border-gray-700/50 flex items-center gap-3">
          <button className="btn-ghost btn-sm flex items-center gap-1.5" onClick={() => navigate(-1)}>
            <ArrowLeft size={14} /> Back
          </button>
          <span className="text-sm text-gray-400 truncate">{image.filename}</span>
          <div className="flex-1" />
          <button
            className={`btn-sm flex items-center gap-1.5 ${cropMode ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setCropMode((v) => !v)}
          >
            <Crop size={14} /> {cropMode ? "Cancel Crop" : "Crop"}
          </button>
          {cropMode && (
            <>
              <select className="input w-28" value={aspect ?? ""} onChange={(e) => setAspect(e.target.value ? Number(e.target.value) : undefined)}>
                <option value="">Free</option>
                <option value={1}>1:1</option>
                <option value={4/3}>4:3</option>
                <option value={16/9}>16:9</option>
                <option value={3/2}>3:2</option>
                <option value={9/16}>9:16</option>
              </select>
              <button className="btn-primary btn-sm" onClick={() => cropMutation.mutate()} disabled={!croppedArea}>
                Apply Crop
              </button>
            </>
          )}
        </div>

        <div className="flex-1 relative bg-black/40">
          {cropMode ? (
            <Cropper
              image={imagesApi.fileUrl(imageId!)}
              crop={crop}
              zoom={zoom}
              aspect={aspect}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={onCropComplete}
            />
          ) : (
            <img
              src={imagesApi.fileUrl(imageId!)}
              alt={image.filename}
              className="max-w-full max-h-full object-contain absolute inset-0 m-auto"
            />
          )}
        </div>
      </div>

      {/* Right: metadata + caption panel */}
      <div className="w-80 bg-surface-card border-l border-gray-700/50 flex flex-col overflow-y-auto">
        {/* Meta */}
        <div className="p-4 border-b border-gray-700/50 space-y-2">
          <h3 className="font-medium text-sm text-gray-300 uppercase tracking-wide">Image Info</h3>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            <span className="text-gray-500">Dimensions</span>
            <span>{image.width}×{image.height}</span>
            <span className="text-gray-500">Size</span>
            <span>{formatSize(image.file_size_bytes)}</span>
            <span className="text-gray-500">Format</span>
            <span>{image.format}</span>
            {image.aesthetic_score !== null && (
              <>
                <span className="text-gray-500">Aesthetic</span>
                <span className={image.aesthetic_score >= 6 ? "text-green-400" : image.aesthetic_score >= 4 ? "text-yellow-400" : "text-red-400"}>
                  {image.aesthetic_score?.toFixed(2)}/10
                </span>
              </>
            )}
            {image.blur_score !== null && (
              <>
                <span className="text-gray-500">Blur score</span>
                <span>{image.blur_score?.toFixed(1)}</span>
              </>
            )}
          </div>

          {/* Quality flags */}
          {(isDuplicate === true || isBlurry === true) && (
            <div className="flex gap-2 flex-wrap mt-2">
              {isBlurry === true && <span className="badge-yellow flex items-center gap-1"><AlertTriangle size={10} />Blurry</span>}
              {isDuplicate === true && <span className="badge-yellow flex items-center gap-1"><Copy size={10} />Duplicate</span>}
            </div>
          )}
        </div>

        {/* Caption */}
        <div className="p-4 flex-1 space-y-3">
          <h3 className="font-medium text-sm text-gray-300 uppercase tracking-wide">Caption</h3>

          <div>
            <label className="label">Tags</label>
            <TagEditor
              tags={tags}
              onChange={(t) => { setTags(t); setCaptionDirty(true); }}
            />
          </div>

          <div>
            <label className="label">Caption Text</label>
            <textarea
              className="input h-32 resize-y"
              value={captionText}
              onChange={(e) => { setCaptionText(e.target.value); setCaptionDirty(true); }}
              placeholder="Natural language description..."
            />
          </div>

          <select
            className="input"
            value={captionStyle}
            onChange={(e) => { setCaptionStyle(e.target.value); setCaptionDirty(true); }}
          >
            <option value="">— style —</option>
            <option value="tags">Tags</option>
            <option value="natural">Natural language</option>
            <option value="descriptive">Descriptive</option>
            <option value="booru">Booru style</option>
          </select>

          <button
            className="btn-primary w-full flex items-center justify-center gap-2"
            onClick={() => saveMutation.mutate()}
            disabled={!captionDirty || saveMutation.isPending}
          >
            <Save size={14} /> Save
          </button>

          {/* AI Generate section */}
          <div className="border-t border-gray-700/50 pt-3">
            <button
              className="flex items-center justify-between w-full text-sm font-medium text-gray-300 hover:text-white transition-colors"
              onClick={() => setShowAi((v) => !v)}
            >
              <span className="flex items-center gap-2">
                <Sparkles size={14} className="text-accent" /> Generate with AI
              </span>
              {showAi ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>

            {showAi && (
              <div className="mt-3 space-y-3">
                {/* Model picker */}
                <div className="space-y-1.5">
                  <label className="label">Model</label>
                  {!modelsData && <p className="text-xs text-gray-500">Loading models…</p>}
                  {localModels.map(m => (
                    <div
                      key={m.id}
                      className={`flex items-center gap-2 p-2 rounded border cursor-pointer text-xs transition-colors ${
                        aiModel === m.id ? "border-accent bg-accent/10" : "border-gray-700 hover:border-gray-500"
                      }`}
                      onClick={() => { setAiModel(m.id); setAiStyle("detailed"); }}
                    >
                      <div className="flex-1 font-medium">{m.name}</div>
                      <span className="text-gray-500">{m.vram_mb / 1024}GB</span>
                      {m.loaded && <span className="badge-green">Loaded</span>}
                    </div>
                  ))}
                  {ollamaModels.length > 0 && (
                    <>
                      <p className="text-xs text-gray-500 pt-1">Ollama</p>
                      {ollamaModels.map(m => (
                        <div
                          key={m.id}
                          className={`flex items-center gap-2 p-2 rounded border cursor-pointer text-xs transition-colors ${
                            aiModel === m.id ? "border-accent bg-accent/10" : "border-gray-700 hover:border-gray-500"
                          }`}
                          onClick={() => { setAiModel(m.id); setAiStyle("detailed"); }}
                        >
                          <div className="flex-1 font-medium">{m.name}</div>
                        </div>
                      ))}
                    </>
                  )}
                </div>

                {/* Style picker */}
                {aiModel && (
                  <div>
                    <label className="label">Style</label>
                    <div className="flex flex-wrap gap-1.5">
                      {aiStyles.map(s => (
                        <button
                          key={s}
                          className={`btn btn-sm ${aiStyle === s ? "btn-primary" : "btn-secondary"}`}
                          onClick={() => setAiStyle(s)}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Custom prompt */}
                {aiModel && (
                  <div>
                    <label className="label">Custom Prompt (optional)</label>
                    <textarea
                      className="input h-14 resize-none text-xs"
                      value={aiCustomPrompt}
                      onChange={e => setAiCustomPrompt(e.target.value)}
                      placeholder={
                        aiModel.startsWith("ollama:")
                          ? "Leave blank for style preset…"
                          : "Override the default prompt for this style…"
                      }
                    />
                  </div>
                )}

                <PromptPresetManager
                  currentModel={aiModel}
                  currentStyle={aiStyle}
                  currentPrompt={aiCustomPrompt}
                  onLoad={(p) => {
                    setAiModel(p.model);
                    setAiStyle(p.style);
                    setAiCustomPrompt(p.prompt);
                  }}
                />

                {/* Progress */}
                {aiJobId && aiJobProgress && (
                  <div className="space-y-1">
                    <div className="bg-gray-700 rounded-full h-1.5">
                      <div
                        className="bg-accent h-1.5 rounded-full transition-all"
                        style={{ width: `${aiJobProgress.percent ?? 0}%` }}
                      />
                    </div>
                    <p className="text-xs text-gray-500">{aiJobProgress.message || "Generating…"}</p>
                  </div>
                )}

                <button
                  className="btn-primary w-full flex items-center justify-center gap-2"
                  onClick={() => aiMutation.mutate()}
                  disabled={!aiModel || aiMutation.isPending || aiRunning}
                >
                  <Sparkles size={14} />
                  {aiRunning ? "Generating…" : "Generate Caption"}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
