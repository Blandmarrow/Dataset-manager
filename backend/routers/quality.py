from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database import get_db
from backend.ml.model_manager import model_manager
from backend.models import BackgroundJob, Image
from backend.workers.job_queue import job_queue

router = APIRouter(prefix="/quality", tags=["quality"])


class ScoreRequest(BaseModel):
    dataset_id: str
    image_ids: list[str] | None = None
    run_aesthetic: bool = True
    run_technical: bool = True


class DuplicateResolve(BaseModel):
    keep_ids: list[str]
    delete_ids: list[str]


@router.post("/score")
async def score_quality(body: ScoreRequest, db: AsyncSession = Depends(get_db)):
    query = select(Image).where(Image.dataset_id == body.dataset_id)
    if body.image_ids:
        query = query.where(Image.id.in_(body.image_ids))
    result = await db.execute(query)
    images = result.scalars().all()

    if not images:
        return {"job_id": None, "message": "No images found"}

    job = BackgroundJob(
        job_type="quality_score",
        dataset_id=body.dataset_id,
        total_items=len(images),
        config=body.model_dump(),
    )
    db.add(job)
    await db.commit()

    image_data = [(img.id, img.file_path) for img in images]

    async def _run(job_id: str) -> None:
        from backend.database import AsyncSessionLocal
        from backend.ml.aesthetic_scorer import score_images_batch
        from backend.ml.technical_scorer import score_images_technical

        ids = [d[0] for d in image_data]
        paths = [d[1] for d in image_data]

        aesthetic_scores = []
        if body.run_aesthetic:
            entry = await model_manager.load_aesthetic()
            aesthetic_scores = await score_images_batch(paths, entry.model, job_id=job_id)

        technical_results = []
        if body.run_technical:
            technical_results = await score_images_technical(ids, paths, job_id=job_id)

        async with AsyncSessionLocal() as session:
            for i, img_id in enumerate(ids):
                img = await session.get(Image, img_id)
                if not img:
                    continue
                if aesthetic_scores:
                    img.aesthetic_score = aesthetic_scores[i]
                if technical_results:
                    t = technical_results[i]
                    img.blur_score = t.get("blur_score")
                    img.noise_score = t.get("noise_score")
                    flags = img.quality_flags or {}
                    flags["is_blurry"] = t.get("is_blurry", False)
                    flags["is_noisy"] = t.get("is_noisy", False)
                    img.quality_flags = flags
            await session.commit()

        # Detect duplicates after scoring
        if body.run_technical:
            await _flag_duplicates(body.dataset_id)

    async def _flag_duplicates(dataset_id: str) -> None:
        from backend.database import AsyncSessionLocal
        from backend.ml.technical_scorer import find_duplicates_sync

        async with AsyncSessionLocal() as session:
            result = await session.execute(
                select(Image.id, Image.phash).where(
                    Image.dataset_id == dataset_id,
                    Image.phash.isnot(None),
                )
            )
            phashes = [(r.id, r.phash) for r in result.all()]

        import asyncio
        groups = await asyncio.get_event_loop().run_in_executor(None, find_duplicates_sync, phashes)

        async with AsyncSessionLocal() as session:
            for group in groups:
                keep = group[0]
                for dup_id in group[1:]:
                    img = await session.get(Image, dup_id)
                    if img:
                        flags = img.quality_flags or {}
                        flags["is_duplicate"] = True
                        flags["duplicate_of"] = keep
                        img.quality_flags = flags
            await session.commit()

    await job_queue.enqueue(job, _run)
    return {"job_id": job.id, "total": len(images)}


@router.get("/duplicates/{dataset_id}")
async def get_duplicates(dataset_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Image).where(
            Image.dataset_id == dataset_id,
            Image.quality_flags["is_duplicate"].as_boolean() == True,
        )
    )
    duplicates = result.scalars().all()
    groups: dict[str, list] = {}
    for img in duplicates:
        key = img.quality_flags.get("duplicate_of", img.id)
        groups.setdefault(key, []).append({
            "id": img.id,
            "filename": img.filename,
            "aesthetic_score": img.aesthetic_score,
        })
    return {"groups": list(groups.values())}


@router.post("/duplicates/resolve", status_code=204)
async def resolve_duplicates(body: DuplicateResolve, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Image).where(Image.id.in_(body.delete_ids)))
    to_delete = result.scalars().all()
    for img in to_delete:
        from pathlib import Path
        p = Path(img.file_path)
        t = Path(img.thumbnail_path) if img.thumbnail_path else None
        await db.delete(img)
        for f in [p, t]:
            if f and f.exists():
                f.unlink(missing_ok=True)
    await db.commit()

    for img_id in body.keep_ids:
        img = await db.get(Image, img_id)
        if img:
            flags = img.quality_flags or {}
            flags.pop("is_duplicate", None)
            flags.pop("duplicate_of", None)
            img.quality_flags = flags
    await db.commit()
