import shutil
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models import Image
from backend.services.image_service import convert_and_save


async def export_kohya(
    db: AsyncSession,
    dataset_id: str,
    output_dir: str,
    n_repeats: int = 10,
    concept_token: str = "concept",
    image_ids: list[str] | None = None,
    output_format: str = "original",
    jpeg_quality: int = 95,
    job_id: str | None = None,
) -> dict:
    from backend.workers.progress import broadcaster

    folder_name = f"{n_repeats}_{concept_token}"
    dest = Path(output_dir) / folder_name
    dest.mkdir(parents=True, exist_ok=True)

    query = select(Image).where(Image.dataset_id == dataset_id)
    if image_ids:
        query = query.where(Image.id.in_(image_ids))
    result = await db.execute(query)
    images = result.scalars().all()

    exported = 0
    for i, img in enumerate(images):
        src = Path(img.file_path)
        if not src.exists():
            continue

        if output_format == "original":
            dest_img = dest / img.filename
            shutil.copy2(src, dest_img)
        elif output_format == "png":
            dest_img = dest / (src.stem + ".png")
            convert_and_save(str(src), str(dest_img), "PNG")
        else:
            dest_img = dest / (src.stem + ".jpg")
            convert_and_save(str(src), str(dest_img), "JPEG", jpeg_quality)

        caption = img.caption_text or ", ".join(img.tags_json)
        (dest / dest_img.with_suffix(".txt").name).write_text(caption, encoding="utf-8")
        exported += 1

        if job_id and i % 5 == 0:
            await broadcaster.emit(job_id, {
                "type": "progress", "job_id": job_id, "job_type": "export",
                "status": "running", "done": i + 1, "total": len(images),
                "percent": round((i + 1) / len(images) * 100, 1),
                "current_item": img.filename, "message": f"Exporting {img.filename}",
            })

    return {"exported": exported, "output_dir": str(dest)}


async def export_aitoolkit(
    db: AsyncSession,
    dataset_id: str,
    output_dir: str,
    concept_name: str = "concept",
    image_ids: list[str] | None = None,
    output_format: str = "jpg",
    jpeg_quality: int = 95,
    job_id: str | None = None,
) -> dict:
    from backend.workers.progress import broadcaster

    dest = Path(output_dir) / concept_name
    dest.mkdir(parents=True, exist_ok=True)

    query = select(Image).where(Image.dataset_id == dataset_id)
    if image_ids:
        query = query.where(Image.id.in_(image_ids))
    result = await db.execute(query)
    images = result.scalars().all()

    exported = 0
    for i, img in enumerate(images):
        src = Path(img.file_path)
        if not src.exists():
            continue

        if output_format == "original":
            dest_img = dest / img.filename
            shutil.copy2(src, dest_img)
        elif output_format == "png":
            dest_img = dest / (src.stem + ".png")
            convert_and_save(str(src), str(dest_img), "PNG")
        else:
            dest_img = dest / (src.stem + ".jpg")
            convert_and_save(str(src), str(dest_img), "JPEG", jpeg_quality)

        caption = img.caption_text or ", ".join(img.tags_json)
        (dest / dest_img.with_suffix(".txt").name).write_text(caption, encoding="utf-8")
        exported += 1

        if job_id and i % 5 == 0:
            await broadcaster.emit(job_id, {
                "type": "progress", "job_id": job_id, "job_type": "export",
                "status": "running", "done": i + 1, "total": len(images),
                "percent": round((i + 1) / len(images) * 100, 1),
                "current_item": img.filename,
            })

    return {"exported": exported, "output_dir": str(dest)}


async def preview_export(db: AsyncSession, dataset_id: str) -> dict:
    query = select(Image.filename, Image.caption_text, Image.tags_json).where(Image.dataset_id == dataset_id)
    result = await db.execute(query)
    rows = result.all()
    return {
        "image_count": len(rows),
        "captioned_count": sum(1 for r in rows if r.caption_text or r.tags_json),
        "sample_files": [
            {"image": r.filename, "caption_preview": (r.caption_text or ", ".join(r.tags_json))[:80]}
            for r in rows[:5]
        ],
    }
