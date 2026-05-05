import asyncio
import base64
import functools

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import select, update
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
    run_watermark: bool = False
    run_embeddings: bool = False
    run_dino: bool = False


class DuplicateResolve(BaseModel):
    keep_ids: list[str]
    delete_ids: list[str]


class StyleSimilarityRequest(BaseModel):
    dataset_id: str
    reference_image_ids: list[str] = []
    reference_embeddings: list[str] = []  # base64-encoded float16 bytes (from embed-references)
    embedding_type: str = "clip"  # "clip" | "dino"


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
        from backend.ml.aesthetic_scorer import (
            extract_clip_embeddings_batch,
            score_images_batch,
            score_images_watermark,
        )
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

        watermark_results = []
        if body.run_watermark:
            entry = await model_manager.load_aesthetic()
            watermark_results = await score_images_watermark(paths, entry.model, job_id=job_id)

        clip_embeddings: list[bytes | None] = []
        dino_embeddings: list[bytes | None] = []
        if body.run_embeddings:
            entry = await model_manager.load_aesthetic()
            clip_embeddings = await extract_clip_embeddings_batch(paths, entry.model, job_id=job_id)
            if body.run_dino:
                from backend.ml.dino_scorer import extract_embeddings_dino
                dino_entry = await model_manager.load_dino()
                dino_embeddings = await extract_embeddings_dino(paths, dino_entry, job_id=job_id)

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
                    img.uniformity_score = t.get("uniformity_score")
                    img.color_score = t.get("color_score")
                    img.saturation_score = t.get("saturation_score")
                    flags = img.quality_flags or {}
                    flags["is_blurry"] = t.get("is_blurry", False)
                    flags["is_noisy"] = t.get("is_noisy", False)
                    flags["is_uniform"] = t.get("is_uniform", False)
                    img.quality_flags = flags
                if watermark_results:
                    w = watermark_results[i]
                    img.watermark_score = w.get("watermark_score")
                    flags = img.quality_flags or {}
                    flags["has_watermark"] = w.get("has_watermark", False)
                    img.quality_flags = flags
                if clip_embeddings:
                    img.clip_embedding = clip_embeddings[i]
                if dino_embeddings:
                    img.dino_embedding = dino_embeddings[i]
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


@router.post("/embed-references")
async def embed_references(files: list[UploadFile] = File(...)):
    """Compute CLIP embeddings for uploaded reference images.
    Returns base64-encoded float16 bytes that can be passed to /style-similarity."""
    from backend.ml.aesthetic_scorer import extract_clip_embedding_from_bytes_sync

    entry = await model_manager.load_aesthetic()
    loop = asyncio.get_event_loop()
    embeddings = []
    for f in files:
        img_bytes = await f.read()
        fn = functools.partial(extract_clip_embedding_from_bytes_sync, img_bytes, entry.model)
        emb_bytes = await loop.run_in_executor(None, fn)
        embeddings.append(base64.b64encode(emb_bytes).decode())
    return {"embeddings": embeddings}


@router.post("/style-similarity")
async def compute_style_similarity(
    body: StyleSimilarityRequest,
    db: AsyncSession = Depends(get_db),
):
    from backend.ml.similarity_scorer import compute_style_similarity

    col = Image.clip_embedding if body.embedding_type == "clip" else Image.dino_embedding

    ref_embs: list[bytes] = []

    if body.reference_image_ids:
        ref_result = await db.execute(
            select(Image.id, col).where(Image.id.in_(body.reference_image_ids))
        )
        ref_embs.extend(r[1] for r in ref_result.all() if r[1] is not None)

    for b64 in body.reference_embeddings:
        ref_embs.append(base64.b64decode(b64))

    if not ref_embs:
        raise HTTPException(
            status_code=400,
            detail=(
                f"No {body.embedding_type} embeddings found for reference images. "
                "Run embedding extraction first, or upload local reference images."
            ),
        )

    cand_result = await db.execute(
        select(Image.id, col).where(
            Image.dataset_id == body.dataset_id,
            col.isnot(None),
        )
    )
    cand_rows = [(r[0], r[1]) for r in cand_result.all()]
    if not cand_rows:
        raise HTTPException(
            status_code=400,
            detail=f"No {body.embedding_type} embeddings found for dataset images. Run embedding extraction first.",
        )

    loop = asyncio.get_event_loop()
    scores = await loop.run_in_executor(
        None, compute_style_similarity, ref_embs, [r[1] for r in cand_rows]
    )

    await db.execute(
        update(Image),
        [{"id": img_id, "style_similarity_score": score}
         for (img_id, _), score in zip(cand_rows, scores)],
    )
    await db.commit()

    return {"updated": len(cand_rows)}


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
