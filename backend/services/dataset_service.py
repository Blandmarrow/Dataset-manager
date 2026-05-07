import asyncio
import shutil
import statistics
from datetime import datetime
from pathlib import Path
from uuid import uuid4

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.config import settings
from backend.models import Dataset, Image, Tag
from backend.services.image_service import generate_thumbnail, get_image_info

SUPPORTED_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif", ".tiff", ".tif"}


def _bucket(val: float, edges: list[float], labels: list[str]) -> str:
    for i, edge in enumerate(edges):
        if val < edge:
            return labels[i]
    return labels[-1]


def _ar_fine_bucket(ratio: float) -> str:
    if ratio <= 0.5:
        return "9:16+"
    if ratio <= 0.67:
        return "2:3"
    if ratio <= 0.85:
        return "3:4"
    if ratio <= 1.15:
        return "1:1"
    if ratio <= 1.4:
        return "4:3"
    if ratio <= 1.6:
        return "3:2"
    if ratio <= 1.95:
        return "16:9"
    return "21:9+"


def _watermark_bucket(val: float) -> str:
    idx = min(int(val * 10), 9)
    lo = idx / 10
    hi = lo + 0.1
    return f"{lo:.1f}–{hi:.1f}"


def _p95(sorted_vals: list[float]) -> float:
    if not sorted_vals:
        return 0.0
    idx = int(len(sorted_vals) * 0.95)
    return sorted_vals[min(idx, len(sorted_vals) - 1)]


async def create_dataset(db: AsyncSession, name: str, description: str = "") -> Dataset:
    ds_id = str(uuid4())
    folder = settings.datasets_dir / ds_id
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "images").mkdir(exist_ok=True)
    (folder / "thumbnails").mkdir(exist_ok=True)

    ds = Dataset(id=ds_id, name=name, description=description, folder_path=str(folder))
    db.add(ds)
    await db.commit()
    await db.refresh(ds)
    return ds


async def import_images_from_folder(
    db: AsyncSession,
    dataset: Dataset,
    folder_path: str,
    job_id: str | None = None,
) -> int:
    from backend.workers.progress import broadcaster

    src = Path(folder_path)
    if not src.exists() or not src.is_dir():
        raise ValueError(f"Folder not found: {folder_path}")

    image_files = [f for f in src.iterdir() if f.suffix.lower() in SUPPORTED_EXTENSIONS]
    total = len(image_files)
    added = 0

    dest_images = Path(dataset.folder_path) / "images"
    dest_thumbs = Path(dataset.folder_path) / "thumbnails"

    for i, src_file in enumerate(image_files):
        try:
            dest_file = dest_images / src_file.name
            # Avoid overwriting existing files
            if dest_file.exists():
                stem = src_file.stem
                suffix = src_file.suffix
                dest_file = dest_images / f"{stem}_{uuid4().hex[:6]}{suffix}"

            shutil.copy2(src_file, dest_file)

            info = get_image_info(str(dest_file))
            thumb_path = str(dest_thumbs / (dest_file.stem + ".webp"))
            await asyncio.get_event_loop().run_in_executor(
                None, generate_thumbnail, str(dest_file), thumb_path
            )

            img = Image(
                dataset_id=dataset.id,
                filename=dest_file.name,
                original_filename=src_file.name,
                file_path=str(dest_file),
                thumbnail_path=thumb_path,
                **info,
            )
            db.add(img)
            added += 1
        except Exception:
            pass  # skip broken files, continue import

        if job_id and i % 10 == 0:
            pct = round((i + 1) / total * 100, 1)
            await broadcaster.emit(job_id, {
                "type": "progress",
                "job_id": job_id,
                "job_type": "import",
                "status": "running",
                "done": i + 1,
                "total": total,
                "percent": pct,
                "current_item": src_file.name,
                "message": f"Importing {src_file.name}",
            })

    await db.commit()
    await refresh_stats(db, dataset.id)
    return added


async def refresh_stats(db: AsyncSession, dataset_id: str) -> None:
    result = await db.execute(
        select(
            func.count(Image.id),
            func.sum(Image.file_size_bytes),
        ).where(Image.dataset_id == dataset_id)
    )
    row = result.one()
    image_count = row[0] or 0
    total_size = row[1] or 0

    captioned = await db.execute(
        select(func.count(Image.id)).where(
            Image.dataset_id == dataset_id,
            Image.caption_text != "",
        )
    )
    captioned_count = captioned.scalar() or 0

    ds = await db.get(Dataset, dataset_id)
    if ds:
        ds.image_count = image_count
        ds.captioned_count = captioned_count
        ds.total_size_bytes = total_size
        ds.updated_at = datetime.utcnow()
        await db.commit()


async def get_dataset_stats(db: AsyncSession, dataset_id: str) -> dict:
    ds = await db.get(Dataset, dataset_id)
    if not ds:
        return {}

    result = await db.execute(
        select(
            Image.width, Image.height, Image.format,
            Image.aesthetic_score, Image.caption_text,
            Image.blur_score, Image.noise_score, Image.uniformity_score,
            Image.watermark_score, Image.color_score, Image.saturation_score,
            Image.file_size_bytes, Image.quality_flags,
            Image.style_similarity_score,
        ).where(Image.dataset_id == dataset_id)
    )
    rows = result.all()

    # Bucket edge/label definitions
    blur_edges =       [20, 40, 80, 150, 300]
    blur_labels =      ["0–20", "20–40", "40–80", "80–150", "150–300", "300+"]
    noise_edges =      [5, 10, 15, 20, 30]
    noise_labels =     ["0–5", "5–10", "10–15", "15–20", "20–30", "30+"]
    uni_edges =        [5, 10, 20, 40]
    uni_labels =       ["0–5", "5–10", "10–20", "20–40", "40+"]
    color_edges =      [10, 20, 40, 60]
    color_labels =     ["0–10", "10–20", "20–40", "40–60", "60+"]
    sat_edges =        [10, 20, 40, 60]
    sat_labels =       ["0–10", "10–20", "20–40", "40–60", "60+"]
    mp_edges =         [0.25, 0.5, 1.0, 2.0, 4.0, 8.0]
    mp_labels =        ["<0.25", "0.25–0.5", "0.5–1", "1–2", "2–4", "4–8", "8+"]
    fs_edges =         [0.1, 0.5, 1.0, 2.0, 5.0]
    fs_labels =        ["<0.1 MB", "0.1–0.5 MB", "0.5–1 MB", "1–2 MB", "2–5 MB", "5+ MB"]
    wc_edges =         [1, 6, 11, 21, 51]
    wc_labels =        ["No caption", "1–5 words", "6–10 words", "11–20 words", "21–50 words", "50+ words"]

    widths: list[int] = []
    heights: list[int] = []
    file_sizes_mb: list[float] = []

    formats: dict[str, int] = {}
    ar_coarse: dict[str, int] = {"portrait": 0, "landscape": 0, "square": 0}
    ar_fine: dict[str, int] = {}
    score_buckets = {"low (0-4)": 0, "mid (4-6)": 0, "high (6-10)": 0, "unscored": 0}
    blur_dist: dict[str, int] = {}
    noise_dist: dict[str, int] = {}
    uni_dist: dict[str, int] = {}
    wm_dist: dict[str, int] = {}
    color_dist: dict[str, int] = {}
    sat_dist: dict[str, int] = {}
    mp_dist: dict[str, int] = {}
    fs_dist: dict[str, int] = {}
    wc_dist: dict[str, int] = {}

    ssim_dist: dict[str, int] = {}
    flag_counts = {"blurry": 0, "noisy": 0, "uniform": 0, "watermarked": 0, "duplicate": 0}
    score_cov = {"aesthetic": 0, "technical": 0, "watermark": 0}

    captioned = 0

    for r in rows:
        # Formats
        fmt = (r.format or "unknown").upper()
        formats[fmt] = formats.get(fmt, 0) + 1

        # Dimensions
        if r.width and r.height:
            widths.append(r.width)
            heights.append(r.height)
            ar = r.width / r.height
            # Coarse AR
            if ar < 0.8:
                ar_coarse["portrait"] += 1
            elif ar > 1.2:
                ar_coarse["landscape"] += 1
            else:
                ar_coarse["square"] += 1
            # Fine AR
            b = _ar_fine_bucket(ar)
            ar_fine[b] = ar_fine.get(b, 0) + 1
            # Megapixels
            mp = (r.width * r.height) / 1_000_000
            b = _bucket(mp, mp_edges, mp_labels)
            mp_dist[b] = mp_dist.get(b, 0) + 1

        # File size
        if r.file_size_bytes:
            mb = r.file_size_bytes / 1_048_576
            file_sizes_mb.append(mb)
            b = _bucket(mb, fs_edges, fs_labels)
            fs_dist[b] = fs_dist.get(b, 0) + 1

        # Aesthetic
        if r.aesthetic_score is None:
            score_buckets["unscored"] += 1
        else:
            score_cov["aesthetic"] += 1
            if r.aesthetic_score < 4:
                score_buckets["low (0-4)"] += 1
            elif r.aesthetic_score < 6:
                score_buckets["mid (4-6)"] += 1
            else:
                score_buckets["high (6-10)"] += 1

        # Technical scores
        if r.blur_score is not None:
            score_cov["technical"] += 1
            b = _bucket(r.blur_score, blur_edges, blur_labels)
            blur_dist[b] = blur_dist.get(b, 0) + 1
        if r.noise_score is not None:
            b = _bucket(r.noise_score, noise_edges, noise_labels)
            noise_dist[b] = noise_dist.get(b, 0) + 1
        if r.uniformity_score is not None:
            b = _bucket(r.uniformity_score, uni_edges, uni_labels)
            uni_dist[b] = uni_dist.get(b, 0) + 1
        if r.color_score is not None:
            b = _bucket(r.color_score, color_edges, color_labels)
            color_dist[b] = color_dist.get(b, 0) + 1
        if r.saturation_score is not None:
            b = _bucket(r.saturation_score, sat_edges, sat_labels)
            sat_dist[b] = sat_dist.get(b, 0) + 1

        # Watermark
        if r.watermark_score is not None:
            score_cov["watermark"] += 1
            b = _watermark_bucket(r.watermark_score)
            wm_dist[b] = wm_dist.get(b, 0) + 1

        # Style similarity
        if r.style_similarity_score is not None:
            b = _watermark_bucket(r.style_similarity_score)
            ssim_dist[b] = ssim_dist.get(b, 0) + 1

        # Quality flags
        flags = r.quality_flags or {}
        if flags.get("is_blurry"):
            flag_counts["blurry"] += 1
        if flags.get("is_noisy"):
            flag_counts["noisy"] += 1
        if flags.get("is_uniform"):
            flag_counts["uniform"] += 1
        if flags.get("has_watermark"):
            flag_counts["watermarked"] += 1
        if flags.get("is_duplicate"):
            flag_counts["duplicate"] += 1

        # Caption word count
        text = r.caption_text or ""
        if text.strip():
            captioned += 1
        wc = len(text.split()) if text.strip() else 0
        b = _bucket(wc, wc_edges, wc_labels)
        wc_dist[b] = wc_dist.get(b, 0) + 1

    # Embedding coverage — separate count query to avoid loading blobs
    embed_count = await db.scalar(
        select(func.count(Image.id)).where(
            Image.dataset_id == dataset_id,
            Image.clip_embedding.isnot(None),
        )
    )
    score_cov["embeddings"] = embed_count or 0

    total = len(rows)
    coverage = round(captioned / total * 100, 1) if total else 0.0

    # File size summary
    fs_sorted = sorted(file_sizes_mb)
    fs_summary: dict[str, float] = {}
    if fs_sorted:
        fs_summary = {
            "min_mb": round(fs_sorted[0], 3),
            "median_mb": round(statistics.median(fs_sorted), 3),
            "p95_mb": round(_p95(fs_sorted), 3),
            "max_mb": round(fs_sorted[-1], 3),
        }

    # Sort ordered distributions to preserve bucket order in JSON
    def _ordered(dist: dict[str, int], labels: list[str]) -> dict[str, int]:
        return {lbl: dist[lbl] for lbl in labels if lbl in dist}

    ar_fine_order = ["9:16+", "2:3", "3:4", "1:1", "4:3", "3:2", "16:9", "21:9+"]

    return {
        "id": ds.id,
        "name": ds.name,
        "image_count": total,
        "captioned_count": captioned,
        "caption_coverage_pct": coverage,
        "total_size_bytes": ds.total_size_bytes,
        "total_size_mb": round(ds.total_size_bytes / 1_048_576, 2),
        "avg_width": round(sum(widths) / len(widths), 1) if widths else None,
        "avg_height": round(sum(heights) / len(heights), 1) if heights else None,
        "aspect_ratio_distribution": {k: v for k, v in ar_coarse.items() if v},
        "format_distribution": formats,
        "score_distribution": score_buckets,
        "blur_distribution": _ordered(blur_dist, blur_labels),
        "noise_distribution": _ordered(noise_dist, noise_labels),
        "uniformity_distribution": _ordered(uni_dist, uni_labels),
        "watermark_distribution": dict(sorted(wm_dist.items())),
        "color_distribution": _ordered(color_dist, color_labels),
        "saturation_distribution": _ordered(sat_dist, sat_labels),
        "megapixel_distribution": _ordered(mp_dist, mp_labels),
        "file_size_distribution": _ordered(fs_dist, fs_labels),
        "file_size_summary": fs_summary,
        "aspect_ratio_fine": _ordered(ar_fine, ar_fine_order),
        "caption_length_distribution": _ordered(wc_dist, wc_labels),
        "style_similarity_distribution": dict(sorted(ssim_dist.items())),
        "quality_flag_counts": flag_counts,
        "score_coverage": score_cov,
    }


async def get_score_values(db: AsyncSession, dataset_id: str) -> dict:
    result = await db.execute(
        select(
            Image.aesthetic_score,
            Image.blur_score,
            Image.noise_score,
            Image.uniformity_score,
            Image.watermark_score,
            Image.color_score,
            Image.saturation_score,
            Image.style_similarity_score,
            Image.width,
            Image.height,
            Image.file_size_bytes,
            Image.caption_text,
        ).where(Image.dataset_id == dataset_id)
    )
    rows = result.all()

    score_fields = [
        "aesthetic_score", "blur_score", "noise_score", "uniformity_score",
        "watermark_score", "color_score", "saturation_score", "style_similarity_score",
    ]
    out: dict[str, list[float]] = {f: [] for f in score_fields}
    out["megapixels"] = []
    out["file_size_mb"] = []
    out["caption_words"] = []

    for row in rows:
        for field in score_fields:
            val = getattr(row, field)
            if val is not None:
                out[field].append(float(val))
        if row.width and row.height:
            out["megapixels"].append(row.width * row.height / 1_000_000)
        if row.file_size_bytes:
            out["file_size_mb"].append(row.file_size_bytes / 1_048_576)
        out["caption_words"].append(len((row.caption_text or "").split()))

    return out


async def get_tag_cooccurrence(db: AsyncSession, dataset_id: str, limit: int = 15) -> dict:
    result = await db.execute(
        select(Image.tags_json)
        .where(Image.dataset_id == dataset_id, Image.tags_json.isnot(None))
    )
    all_tags_json = [r[0] for r in result.all() if r[0]]

    # Count tag frequencies, pick top N
    freq: dict[str, int] = {}
    for tags in all_tags_json:
        for t in tags:
            freq[t] = freq.get(t, 0) + 1

    top_tags = [t for t, _ in sorted(freq.items(), key=lambda x: -x[1])[:limit]]
    if not top_tags:
        return {"tags": [], "matrix": []}

    tag_idx = {t: i for i, t in enumerate(top_tags)}
    n = len(top_tags)
    matrix = [[0] * n for _ in range(n)]

    for tags in all_tags_json:
        present = [tag_idx[t] for t in tags if t in tag_idx]
        for i in present:
            for j in present:
                matrix[i][j] += 1

    return {"tags": top_tags, "matrix": matrix}
