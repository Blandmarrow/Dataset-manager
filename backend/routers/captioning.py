from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database import get_db
from backend.ml import ollama_captioner
from backend.ml.model_manager import model_manager
from backend.models import BackgroundJob, Image
from backend.workers.job_queue import job_queue

router = APIRouter(prefix="/captioning", tags=["captioning"])


class CaptionJobRequest(BaseModel):
    dataset_id: str
    image_ids: list[str] | None = None
    model: str  # "florence2_large" | "florence2_promptgen" | "paligemma2" | "ollama:model_name"
    style: str = "detailed"
    overwrite: bool = False
    custom_prompt: str = ""
    target_width: int | None = None
    target_height: int | None = None


@router.get("/models")
async def list_models():
    static = model_manager.list_models()
    ollama_models = await ollama_captioner.list_vision_models()
    return {"local_models": static, "ollama_models": ollama_models}


@router.get("/styles")
async def list_styles():
    return {
        "florence2": ["short", "detailed", "tags", "dense", "promptgen"],
        "paligemma2": ["short", "detailed", "tags", "booru"],
        "ollama": ["short", "detailed", "tags", "booru"],
    }


@router.post("/run")
async def run_captioning(body: CaptionJobRequest, db: AsyncSession = Depends(get_db)):
    query = select(Image).where(Image.dataset_id == body.dataset_id)
    if body.image_ids:
        query = query.where(Image.id.in_(body.image_ids))
    if not body.overwrite:
        query = query.where(Image.caption_text == "")
    result = await db.execute(query)
    images = result.scalars().all()

    if not images:
        return {"job_id": None, "message": "No images to caption"}

    job = BackgroundJob(
        job_type="caption",
        dataset_id=body.dataset_id,
        total_items=len(images),
        config=body.model_dump(),
    )
    db.add(job)
    await db.commit()

    image_data = [(img.id, img.file_path) for img in images]

    async def _run(job_id: str) -> None:
        from backend.database import AsyncSessionLocal
        from backend.services.caption_service import set_caption

        is_ollama = body.model.startswith("ollama:")
        is_florence = body.model.startswith("florence2")
        is_paligemma = body.model == "paligemma2"

        if is_florence:
            variant = "promptgen" if "promptgen" in body.model else "large"
            entry = await model_manager.load_florence2(variant)
            from backend.ml.florence_captioner import caption_batch
            paths = [p for _, p in image_data]
            captions = await caption_batch(
                paths, entry, body.style, job_id=job_id,
                target_w=body.target_width, target_h=body.target_height,
            )

        elif is_paligemma:
            entry = await model_manager.load_paligemma2()
            from backend.ml.paligemma_captioner import caption_batch
            paths = [p for _, p in image_data]
            captions = await caption_batch(
                paths, entry, body.style, job_id=job_id,
                target_w=body.target_width, target_h=body.target_height,
            )

        elif is_ollama:
            ollama_model = body.model.removeprefix("ollama:")
            paths = [p for _, p in image_data]
            captions = await ollama_captioner.caption_batch(
                paths, ollama_model, body.style, body.custom_prompt, job_id=job_id,
                target_w=body.target_width, target_h=body.target_height,
            )
        else:
            captions = [""] * len(image_data)

        async with AsyncSessionLocal() as session:
            for (img_id, _), caption in zip(image_data, captions):
                if caption:
                    tags = [t.strip() for t in caption.split(",") if t.strip()] if body.style in ("tags", "booru") else []
                    await set_caption(session, img_id, caption, tags, body.style, body.model)

        from backend.services.dataset_service import refresh_stats
        async with AsyncSessionLocal() as session:
            await refresh_stats(session, body.dataset_id)

    await job_queue.enqueue(job, _run)
    return {"job_id": job.id, "total": len(images)}


@router.delete("/model/{model_id}/unload", status_code=204)
async def unload_model(model_id: str):
    await model_manager.unload(model_id)
