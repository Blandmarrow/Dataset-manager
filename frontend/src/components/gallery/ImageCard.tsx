import { useNavigate, useParams } from "react-router-dom";
import { AlertTriangle, Copy, Type } from "lucide-react";
import clsx from "clsx";
import type { ImageListItem } from "../../types";
import { imagesApi } from "../../api/images";
import { useSelectionStore } from "../../store/selectionStore";

function scoreColor(score: number | null) {
  if (score === null) return "badge-gray";
  if (score >= 6) return "badge-green";
  if (score >= 4) return "badge-yellow";
  return "badge-red";
}

interface Props {
  image: ImageListItem;
}

export default function ImageCard({ image }: Props) {
  const navigate = useNavigate();
  const { datasetId } = useParams();
  const { toggle, isSelected } = useSelectionStore();
  const selected = isSelected(image.id);
  const isDuplicate = image.quality_flags?.is_duplicate as boolean | undefined;
  const isBlurry = image.quality_flags?.is_blurry as boolean | undefined;
  const hasWatermark = image.quality_flags?.has_watermark as boolean | undefined;

  return (
    <div
      className={clsx(
        "group relative rounded-lg overflow-hidden border transition-all cursor-pointer",
        selected ? "border-accent ring-1 ring-accent" : "border-gray-700/50 hover:border-gray-500"
      )}
      onClick={() => navigate(`/datasets/${datasetId}/image/${image.id}`)}
    >
      {/* Thumbnail */}
      <div className="aspect-square bg-surface-card relative">
        <img
          src={imagesApi.thumbnailUrl(image.id)}
          alt={image.filename}
          className="w-full h-full object-cover"
          loading="lazy"
        />

        {/* Selection checkbox */}
        <div
          className="absolute top-1.5 left-1.5 z-10"
          onClick={(e) => { e.stopPropagation(); toggle(image.id); }}
        >
          <div className={clsx(
            "w-5 h-5 rounded border-2 flex items-center justify-center transition-colors",
            selected ? "bg-accent border-accent" : "bg-black/40 border-gray-400 group-hover:border-white"
          )}>
            {selected && <svg viewBox="0 0 12 10" fill="white" className="w-3 h-3"><path d="M1 5l3 4L11 1"/></svg>}
          </div>
        </div>

        {/* Warning badges */}
        {(isDuplicate === true || isBlurry === true || hasWatermark === true) && (
          <div className="absolute top-1.5 right-1.5 flex gap-1">
            {isDuplicate && <span title="Duplicate"><Copy size={12} className="text-yellow-400" /></span>}
            {isBlurry && <span title="Blurry"><AlertTriangle size={12} className="text-orange-400" /></span>}
            {hasWatermark && <span title="Watermark detected"><Type size={12} className="text-blue-400" /></span>}
          </div>
        )}

        {/* Score badge */}
        {image.aesthetic_score !== null && (
          <div className="absolute bottom-1.5 right-1.5">
            <span className={scoreColor(image.aesthetic_score)}>
              {image.aesthetic_score?.toFixed(1)}
            </span>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="p-2 space-y-1">
        <p className="text-xs text-gray-400 truncate" title={image.filename}>{image.filename}</p>
        {image.width && image.height && (
          <p className="text-xs text-gray-600">{image.width}×{image.height}</p>
        )}
        {image.caption_text && (
          <p className="text-xs text-gray-500 truncate">{image.caption_text}</p>
        )}
      </div>
    </div>
  );
}
