import asyncio
import shutil
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.config import settings
from backend.database import get_db
from backend.models import BackgroundJob, Dataset, Image
from backend.schemas.image import (
    BatchCropRequest,
    BatchResizeRequest,
    ImageCropRequest,
    ImageListItem,
    ImageOut,
    ImageResizeRequest,
)
from backend.services.dataset_service import refresh_stats
from backend.services.image_service import (
    crop_image,
    crop_to_aspect,
    generate_thumbnail,
    get_image_info,
    resize_image,
)
from backend.workers.job_queue import job_queue

router = APIRouter(prefix="/images", tags=["images"])

SUPPORTED_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif", ".tiff", ".tif"}


def _safe_path(path_str: str, base_dir: Path) -> Path:
    resolved = Path(path_str).resolve()
    if not str(resolved).startswith(str(base_dir.resolve())):
        raise HTTPException(403, "Access denied")
    return resolved


@router.get("/", response_model=list[ImageListItem])
async def list_images(
    dataset_id: str,
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=500),
    sort: str = "created_at",
    order: str = "desc",
    captioned: bool | None = None,
    min_score: float | None = None,
    max_score: float | None = None,
    db: AsyncSession = Depends(get_db),
):
    q = select(Image).where(Image.dataset_id == dataset_id)
    if captioned is True:
        q = q.where(Image.caption_text != "")
    elif captioned is False:
        q = q.where(Image.caption_text == "")
    if min_score is not None:
        q = q.where(Image.aesthetic_score >= min_score)
    if max_score is not None:
        q = q.where(Image.aesthetic_score <= max_score)

    sort_col = getattr(Image, sort, Image.created_at)
    q = q.order_by(sort_col.desc() if order == "desc" else sort_col.asc())
    q = q.offset((page - 1) * limit).limit(limit)

    result = await db.execute(q)
    return result.scalars().all()


@router.post("/upload", status_code=201)
async def upload_images(
    dataset_id: str,
    files: list[UploadFile] = File(...),
    db: AsyncSession = Depends(get_db),
):
    ds = await db.get(Dataset, dataset_id)
    if not ds:
        raise HTTPException(404, "Dataset not found")

    dest_images = Path(ds.folder_path) / "images"
    dest_thumbs = Path(ds.folder_path) / "thumbnails"
    added = []

    for upload in files:
        suffix = Path(upload.filename or "").suffix.lower()
        if suffix not in SUPPORTED_EXTENSIONS:
            continue
        filename = f"{uuid4().hex}{suffix}"
        dest = dest_images / filename
        with open(dest, "wb") as f:
            shutil.copyfileobj(upload.file, f)

        info = get_image_info(str(dest))
        thumb_path = str(dest_thumbs / (dest.stem + ".webp"))
        await asyncio.get_event_loop().run_in_executor(None, generate_thumbnail, str(dest), thumb_path)

        img = Image(
            dataset_id=dataset_id,
            filename=filename,
            original_filename=upload.filename or filename,
            file_path=str(dest),
            thumbnail_path=thumb_path,
            **info,
        )
        db.add(img)
        added.append(filename)

    await db.commit()
    await refresh_stats(db, dataset_id)
    return {"added": len(added), "files": added}


@router.get("/{image_id}", response_model=ImageOut)
async def get_image(image_id: str, db: AsyncSession = Depends(get_db)):
    img = await db.get(Image, image_id)
    if not img:
        raise HTTPException(404, "Image not found")
    return img


@router.delete("/{image_id}", status_code=204)
async def delete_image(image_id: str, db: AsyncSession = Depends(get_db)):
    img = await db.get(Image, image_id)
    if not img:
        raise HTTPException(404, "Image not found")
    dataset_id = img.dataset_id
    p = Path(img.file_path)
    t = Path(img.thumbnail_path) if img.thumbnail_path else None
    txt = p.with_suffix(".txt")
    await db.delete(img)
    await db.commit()
    for f in [p, t, txt]:
        if f and f.exists():
            f.unlink(missing_ok=True)
    await refresh_stats(db, dataset_id)


@router.delete("/batch/delete", status_code=204)
async def batch_delete(image_ids: list[str], db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Image).where(Image.id.in_(image_ids)))
    images = result.scalars().all()
    dataset_ids = set()
    for img in images:
        dataset_ids.add(img.dataset_id)
        p = Path(img.file_path)
        t = Path(img.thumbnail_path) if img.thumbnail_path else None
        txt = p.with_suffix(".txt")
        await db.delete(img)
        for f in [p, t, txt]:
            if f and f.exists():
                f.unlink(missing_ok=True)
    await db.commit()
    for did in dataset_ids:
        await refresh_stats(db, did)


@router.get("/{image_id}/file")
async def serve_file(image_id: str, db: AsyncSession = Depends(get_db)):
    img = await db.get(Image, image_id)
    if not img:
        raise HTTPException(404, "Image not found")
    p = _safe_path(img.file_path, settings.datasets_dir)
    if not p.exists():
        raise HTTPException(404, "File not found on disk")
    return FileResponse(str(p))


@router.get("/{image_id}/thumbnail")
async def serve_thumbnail(image_id: str, db: AsyncSession = Depends(get_db)):
    img = await db.get(Image, image_id)
    if not img:
        raise HTTPException(404, "Image not found")
    if img.thumbnail_path and Path(img.thumbnail_path).exists():
        return FileResponse(img.thumbnail_path)
    # Fallback: generate on demand
    p = _safe_path(img.file_path, settings.datasets_dir)
    thumb = str(p.parent.parent / "thumbnails" / (p.stem + ".webp"))
    await asyncio.get_event_loop().run_in_executor(None, generate_thumbnail, str(p), thumb)
    img.thumbnail_path = thumb
    await db.commit()
    return FileResponse(thumb)


@router.post("/{image_id}/resize")
async def resize(image_id: str, body: ImageResizeRequest, db: AsyncSession = Depends(get_db)):
    img = await db.get(Image, image_id)
    if not img:
        raise HTTPException(404, "Image not found")
    new_w, new_h = await asyncio.get_event_loop().run_in_executor(
        None, resize_image, img.file_path, body.width, body.height, body.scale, body.maintain_ar, body.resample
    )
    img.width, img.height = new_w, new_h
    # Regenerate thumbnail
    await asyncio.get_event_loop().run_in_executor(None, generate_thumbnail, img.file_path, img.thumbnail_path)
    await db.commit()
    return {"width": new_w, "height": new_h}


@router.post("/{image_id}/crop")
async def crop(image_id: str, body: ImageCropRequest, db: AsyncSession = Depends(get_db)):
    img = await db.get(Image, image_id)
    if not img:
        raise HTTPException(404, "Image not found")
    new_w, new_h = await asyncio.get_event_loop().run_in_executor(
        None, crop_image, img.file_path, body.x, body.y, body.width, body.height
    )
    img.width, img.height = new_w, new_h
    await asyncio.get_event_loop().run_in_executor(None, generate_thumbnail, img.file_path, img.thumbnail_path)
    await db.commit()
    return {"width": new_w, "height": new_h}


@router.post("/batch/resize")
async def batch_resize(body: BatchResizeRequest, db: AsyncSession = Depends(get_db)):
    job = BackgroundJob(job_type="batch_resize", total_items=len(body.image_ids), config=body.model_dump())
    db.add(job)
    await db.commit()

    async def _run(job_id: str) -> None:
        from backend.database import AsyncSessionLocal
        from backend.workers.progress import broadcaster
        async with AsyncSessionLocal() as session:
            result = await session.execute(select(Image).where(Image.id.in_(body.image_ids)))
            images = result.scalars().all()
            for i, img in enumerate(images):
                loop = asyncio.get_event_loop()
                new_w, new_h = await loop.run_in_executor(
                    None, resize_image, img.file_path, body.width, body.height, body.scale, body.maintain_ar
                )
                img.width, img.height = new_w, new_h
                if img.thumbnail_path:
                    await loop.run_in_executor(None, generate_thumbnail, img.file_path, img.thumbnail_path)
                await broadcaster.emit(job_id, {
                    "type": "progress", "job_id": job_id, "job_type": "batch_resize",
                    "status": "running", "done": i + 1, "total": len(images),
                    "percent": round((i + 1) / len(images) * 100, 1),
                    "current_item": img.filename,
                })
            await session.commit()

    await job_queue.enqueue(job, _run)
    return {"job_id": job.id}


@router.post("/batch/crop")
async def batch_crop(body: BatchCropRequest, db: AsyncSession = Depends(get_db)):
    job = BackgroundJob(job_type="batch_crop", total_items=len(body.image_ids), config=body.model_dump())
    db.add(job)
    await db.commit()

    async def _run(job_id: str) -> None:
        from backend.database import AsyncSessionLocal
        from backend.workers.progress import broadcaster
        async with AsyncSessionLocal() as session:
            result = await session.execute(select(Image).where(Image.id.in_(body.image_ids)))
            images = result.scalars().all()
            for i, img in enumerate(images):
                loop = asyncio.get_event_loop()
                new_w, new_h = await loop.run_in_executor(
                    None, crop_to_aspect, img.file_path, body.target_ar, body.strategy
                )
                img.width, img.height = new_w, new_h
                if img.thumbnail_path:
                    await loop.run_in_executor(None, generate_thumbnail, img.file_path, img.thumbnail_path)
                await broadcaster.emit(job_id, {
                    "type": "progress", "job_id": job_id, "job_type": "batch_crop",
                    "status": "running", "done": i + 1, "total": len(images),
                    "percent": round((i + 1) / len(images) * 100, 1),
                    "current_item": img.filename,
                })
            await session.commit()

    await job_queue.enqueue(job, _run)
    return {"job_id": job.id}
