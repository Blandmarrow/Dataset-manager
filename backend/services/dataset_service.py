import asyncio
import shutil
from datetime import datetime
from pathlib import Path
from uuid import uuid4

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.config import settings
from backend.models import Dataset, Image, Tag
from backend.services.image_service import generate_thumbnail, get_image_info

SUPPORTED_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif", ".tiff", ".tif"}


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
        select(Image.width, Image.height, Image.format, Image.aesthetic_score, Image.caption_text)
        .where(Image.dataset_id == dataset_id)
    )
    rows = result.all()

    widths = [r.width for r in rows if r.width]
    heights = [r.height for r in rows if r.height]
    formats: dict[str, int] = {}
    ar_buckets: dict[str, int] = {}
    score_buckets = {"low (0-4)": 0, "mid (4-6)": 0, "high (6-10)": 0, "unscored": 0}

    for r in rows:
        fmt = (r.format or "unknown").upper()
        formats[fmt] = formats.get(fmt, 0) + 1

        if r.width and r.height:
            ar = r.width / r.height
            if ar < 0.8:
                bucket = "portrait"
            elif ar > 1.2:
                bucket = "landscape"
            else:
                bucket = "square"
            ar_buckets[bucket] = ar_buckets.get(bucket, 0) + 1

        if r.aesthetic_score is None:
            score_buckets["unscored"] += 1
        elif r.aesthetic_score < 4:
            score_buckets["low (0-4)"] += 1
        elif r.aesthetic_score < 6:
            score_buckets["mid (4-6)"] += 1
        else:
            score_buckets["high (6-10)"] += 1

    captioned = sum(1 for r in rows if r.caption_text)
    total = len(rows)
    coverage = round(captioned / total * 100, 1) if total else 0.0

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
        "aspect_ratio_distribution": ar_buckets,
        "format_distribution": formats,
        "score_distribution": score_buckets,
    }
