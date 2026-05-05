import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Download } from "lucide-react";
import toast from "react-hot-toast";
import { exportApi } from "../api/export";
import { useJobSSE } from "../hooks/useSSE";
import { useJobStore } from "../store/jobStore";

export default function ExportPage() {
  const { datasetId } = useParams<{ datasetId: string }>();
  const [format, setFormat] = useState<"kohya" | "aitoolkit">("kohya");
  const [outputDir, setOutputDir] = useState("");
  const [nRepeats, setNRepeats] = useState(10);
  const [conceptToken, setConceptToken] = useState("concept");
  const [outputFmt, setOutputFmt] = useState("original");
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  useJobSSE(activeJobId);
  const jobProgress = useJobStore((s) => s.activeJobs.get(activeJobId ?? ""));

  const { data: preview } = useQuery({
    queryKey: ["export-preview", datasetId],
    queryFn: () => exportApi.preview(datasetId!),
    enabled: !!datasetId,
  });

  const exportMutation = useMutation({
    mutationFn: () => {
      if (format === "kohya") {
        return exportApi.kohya({
          dataset_id: datasetId!,
          output_dir: outputDir,
          n_repeats: nRepeats,
          concept_token: conceptToken,
          output_format: outputFmt,
        });
      } else {
        return exportApi.aitoolkit({
          dataset_id: datasetId!,
          output_dir: outputDir,
          concept_name: conceptToken,
          output_format: outputFmt,
        });
      }
    },
    onSuccess: (data) => {
      setActiveJobId(data.job_id);
      toast.success("Export started");
    },
    onError: () => toast.error("Export failed"),
  });

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <h2 className="text-xl font-semibold">Export Dataset</h2>

      {/* Preview */}
      {preview && (
        <div className="card p-4 space-y-2">
          <h3 className="font-medium text-sm text-gray-400 uppercase tracking-wide">Preview</h3>
          <div className="flex gap-6 text-sm">
            <div><span className="text-gray-500">Images: </span><span className="font-medium">{preview.image_count}</span></div>
            <div><span className="text-gray-500">Captioned: </span><span className="font-medium text-accent">{preview.captioned_count}</span></div>
          </div>
          {preview.sample_files?.length > 0 && (
            <div className="space-y-1 mt-2">
              <p className="text-xs text-gray-500 uppercase tracking-wide">Sample captions</p>
              {preview.sample_files.map((f: { image: string; caption_preview: string }) => (
                <div key={f.image} className="text-xs flex gap-2">
                  <span className="text-gray-500 font-mono w-32 truncate">{f.image}</span>
                  <span className="text-gray-400 truncate">{f.caption_preview || <em className="text-red-400">no caption</em>}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Format */}
      <div className="card p-5 space-y-4">
        <h3 className="font-medium">Export Format</h3>
        <div className="flex gap-3">
          {(["kohya", "aitoolkit"] as const).map((f) => (
            <button
              key={f}
              className={`flex-1 p-3 rounded border text-sm font-medium transition-colors ${
                format === f ? "border-accent bg-accent/10 text-white" : "border-gray-700 text-gray-400 hover:border-gray-500"
              }`}
              onClick={() => setFormat(f)}
            >
              {f === "kohya" ? "Kohya / SD-Scripts" : "AI Toolkit (Ostris)"}
            </button>
          ))}
        </div>

        {format === "kohya" ? (
          <div className="text-xs text-gray-500 bg-surface p-2 rounded font-mono">
            output_dir/<br />
            &nbsp;&nbsp;{nRepeats}_{conceptToken}/<br />
            &nbsp;&nbsp;&nbsp;&nbsp;image.png + image.txt
          </div>
        ) : (
          <div className="text-xs text-gray-500 bg-surface p-2 rounded font-mono">
            output_dir/<br />
            &nbsp;&nbsp;{conceptToken}/<br />
            &nbsp;&nbsp;&nbsp;&nbsp;image.jpg + image.txt
          </div>
        )}
      </div>

      {/* Config */}
      <div className="card p-5 space-y-4">
        <h3 className="font-medium">Configuration</h3>

        <div>
          <label className="label">Output Directory</label>
          <input
            className="input"
            placeholder="C:\training\my_dataset"
            value={outputDir}
            onChange={(e) => setOutputDir(e.target.value)}
          />
        </div>

        <div className="flex gap-3">
          {format === "kohya" && (
            <div className="flex-1">
              <label className="label">Repeats</label>
              <input
                type="number"
                className="input"
                min={1}
                max={100}
                value={nRepeats}
                onChange={(e) => setNRepeats(Number(e.target.value))}
              />
            </div>
          )}
          <div className="flex-1">
            <label className="label">{format === "kohya" ? "Concept Token" : "Concept Name"}</label>
            <input
              className="input"
              value={conceptToken}
              onChange={(e) => setConceptToken(e.target.value)}
            />
          </div>
        </div>

        <div>
          <label className="label">Image Format</label>
          <select className="input" value={outputFmt} onChange={(e) => setOutputFmt(e.target.value)}>
            <option value="original">Keep original</option>
            <option value="png">Force PNG</option>
            <option value="jpeg">Force JPEG</option>
          </select>
        </div>
      </div>

      {/* Progress */}
      {jobProgress && (
        <div className="card p-4 space-y-2">
          <div className="flex justify-between text-sm">
            <span>Exporting...</span>
            <span className="text-gray-400">{jobProgress.done}/{jobProgress.total}</span>
          </div>
          <div className="bg-gray-700 rounded-full h-2">
            <div className="bg-accent h-2 rounded-full transition-all" style={{ width: `${jobProgress.percent ?? 0}%` }} />
          </div>
          {jobProgress.status === "completed" && (
            <p className="text-green-400 text-sm">✓ Export complete → {outputDir}</p>
          )}
        </div>
      )}

      <button
        className="btn-primary flex items-center gap-2"
        onClick={() => exportMutation.mutate()}
        disabled={!outputDir || exportMutation.isPending || jobProgress?.status === "running"}
      >
        <Download size={14} /> Export
      </button>
    </div>
  );
}
