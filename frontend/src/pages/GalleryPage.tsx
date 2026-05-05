import { useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Upload, CheckSquare, Square } from "lucide-react";
import toast from "react-hot-toast";
import { imagesApi } from "../api/images";
import { datasetsApi } from "../api/datasets";
import ImageCard from "../components/gallery/ImageCard";
import SelectionToolbar from "../components/gallery/SelectionToolbar";
import { useSelectionStore } from "../store/selectionStore";

const SORT_OPTIONS = [
  { label: "Newest first", sort: "created_at", order: "desc" },
  { label: "Oldest first", sort: "created_at", order: "asc" },
  { label: "Score ↓", sort: "aesthetic_score", order: "desc" },
  { label: "Score ↑", sort: "aesthetic_score", order: "asc" },
  { label: "Name A-Z", sort: "filename", order: "asc" },
];

export default function GalleryPage() {
  const { datasetId } = useParams<{ datasetId: string }>();
  const qc = useQueryClient();
  const { selectAll, clear, count } = useSelectionStore();

  const [page, setPage] = useState(1);
  const [sortIdx, setSortIdx] = useState(0);
  const [captionedFilter, setCaptionedFilter] = useState<boolean | undefined>();
  const [uploading, setUploading] = useState(false);

  const sortOpt = SORT_OPTIONS[sortIdx];

  const { data: dataset } = useQuery({
    queryKey: ["dataset", datasetId],
    queryFn: () => datasetsApi.get(datasetId!),
    enabled: !!datasetId,
  });

  const { data: images = [], isLoading, refetch } = useQuery({
    queryKey: ["images", datasetId, page, sortOpt, captionedFilter],
    queryFn: () =>
      imagesApi.list({
        dataset_id: datasetId!,
        page,
        limit: 100,
        sort: sortOpt.sort,
        order: sortOpt.order,
        captioned: captionedFilter,
      }),
    enabled: !!datasetId,
  });

  const handleUpload = useCallback(async (files: FileList) => {
    if (!datasetId) return;
    setUploading(true);
    try {
      await imagesApi.upload(datasetId, Array.from(files));
      await refetch();
      qc.invalidateQueries({ queryKey: ["datasets"] });
      toast.success(`Uploaded ${files.length} image(s)`);
    } catch {
      toast.error("Upload failed");
    } finally {
      setUploading(false);
    }
  }, [datasetId, refetch, qc]);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files.length) handleUpload(e.dataTransfer.files);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-gray-700/50 flex items-center gap-3 flex-wrap shrink-0">
        <h2 className="font-semibold text-lg">{dataset?.name ?? "Gallery"}</h2>
        <span className="badge-gray">{dataset?.image_count ?? 0} images</span>
        <span className="badge-blue">{dataset?.captioned_count ?? 0} captioned</span>

        <div className="flex-1" />

        {/* Filters */}
        <select
          className="input w-36"
          value={sortIdx}
          onChange={(e) => { setSortIdx(Number(e.target.value)); setPage(1); }}
        >
          {SORT_OPTIONS.map((o, i) => <option key={i} value={i}>{o.label}</option>)}
        </select>

        <select
          className="input w-36"
          value={captionedFilter === undefined ? "" : String(captionedFilter)}
          onChange={(e) => {
            const v = e.target.value;
            setCaptionedFilter(v === "" ? undefined : v === "true");
            setPage(1);
          }}
        >
          <option value="">All images</option>
          <option value="true">Captioned only</option>
          <option value="false">Uncaptioned only</option>
        </select>

        {/* Select all toggle */}
        <button
          className="btn-ghost btn-sm flex items-center gap-1.5"
          onClick={() => count === images.length ? clear() : selectAll(images.map(i => i.id))}
        >
          {count === images.length && images.length > 0 ? <CheckSquare size={14} /> : <Square size={14} />}
          {count === images.length && images.length > 0 ? "Deselect All" : "Select All"}
        </button>

        {/* Upload button */}
        <label className="btn-primary flex items-center gap-2 cursor-pointer">
          <Upload size={14} />
          {uploading ? "Uploading..." : "Upload"}
          <input
            type="file"
            multiple
            accept="image/*"
            className="hidden"
            onChange={(e) => e.target.files && handleUpload(e.target.files)}
          />
        </label>
      </div>

      {/* Grid */}
      <div
        className="flex-1 overflow-y-auto p-4"
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
      >
        {isLoading ? (
          <div className="text-gray-500 text-center mt-20">Loading...</div>
        ) : images.length === 0 ? (
          <div className="text-center mt-20 space-y-3">
            <p className="text-gray-500">No images yet. Upload or import from a folder.</p>
            <label className="btn-primary inline-flex items-center gap-2 cursor-pointer">
              <Upload size={14} /> Upload Images
              <input type="file" multiple accept="image/*" className="hidden"
                onChange={(e) => e.target.files && handleUpload(e.target.files)} />
            </label>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
            {images.map((img) => <ImageCard key={img.id} image={img} />)}
          </div>
        )}

        {/* Pagination */}
        {images.length === 100 && (
          <div className="flex justify-center gap-3 mt-6">
            {page > 1 && <button className="btn-secondary" onClick={() => setPage(p => p - 1)}>← Previous</button>}
            <button className="btn-secondary" onClick={() => setPage(p => p + 1)}>Next →</button>
          </div>
        )}
      </div>

      <SelectionToolbar datasetId={datasetId!} />
    </div>
  );
}
