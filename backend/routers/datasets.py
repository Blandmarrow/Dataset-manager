import asyncio
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database import get_db
from backend.models import BackgroundJob, Dataset
from backend.schemas.dataset import DatasetCreate, DatasetImport, DatasetOut, DatasetStats, DatasetUpdate
from backend.services.dataset_service import (
    create_dataset,
    get_dataset_stats,
    import_images_from_folder,
    refresh_stats,
)
from backend.workers.job_queue import job_queue

router = APIRouter(prefix="/datasets", tags=["datasets"])


@router.get("/", response_model=list[DatasetOut])
async def list_datasets(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Dataset).order_by(Dataset.created_at.desc()))
    return result.scalars().all()


@router.post("/", response_model=DatasetOut, status_code=201)
async def create(body: DatasetCreate, db: AsyncSession = Depends(get_db)):
    existing = await db.execute(select(Dataset).where(Dataset.name == body.name))
    if existing.scalar():
        raise HTTPException(400, f"Dataset '{body.name}' already exists")
    return await create_dataset(db, body.name, body.description)


@router.get("/{dataset_id}", response_model=DatasetOut)
async def get_dataset(dataset_id: str, db: AsyncSession = Depends(get_db)):
    ds = await db.get(Dataset, dataset_id)
    if not ds:
        raise HTTPException(404, "Dataset not found")
    return ds


@router.patch("/{dataset_id}", response_model=DatasetOut)
async def update_dataset(dataset_id: str, body: DatasetUpdate, db: AsyncSession = Depends(get_db)):
    ds = await db.get(Dataset, dataset_id)
    if not ds:
        raise HTTPException(404, "Dataset not found")
    if body.name is not None:
        ds.name = body.name
    if body.description is not None:
        ds.description = body.description
    await db.commit()
    await db.refresh(ds)
    return ds


@router.delete("/{dataset_id}", status_code=204)
async def delete_dataset(dataset_id: str, db: AsyncSession = Depends(get_db)):
    ds = await db.get(Dataset, dataset_id)
    if not ds:
        raise HTTPException(404, "Dataset not found")
    folder = Path(ds.folder_path)
    await db.delete(ds)
    await db.commit()
    if folder.exists():
        import shutil
        shutil.rmtree(folder, ignore_errors=True)


@router.post("/{dataset_id}/import")
async def import_folder(dataset_id: str, body: DatasetImport, db: AsyncSession = Depends(get_db)):
    ds = await db.get(Dataset, dataset_id)
    if not ds:
        raise HTTPException(404, "Dataset not found")

    from datetime import datetime
    job = BackgroundJob(
        job_type="import",
        dataset_id=dataset_id,
        total_items=0,
        config={"folder_path": body.folder_path},
    )
    db.add(job)
    await db.commit()

    async def _run(job_id: str) -> None:
        from backend.database import AsyncSessionLocal
        async with AsyncSessionLocal() as session:
            ds2 = await session.get(Dataset, dataset_id)
            await import_images_from_folder(session, ds2, body.folder_path, job_id=job_id)

    await job_queue.enqueue(job, _run)
    return {"job_id": job.id}


@router.post("/{dataset_id}/refresh-stats", status_code=204)
async def do_refresh_stats(dataset_id: str, db: AsyncSession = Depends(get_db)):
    ds = await db.get(Dataset, dataset_id)
    if not ds:
        raise HTTPException(404, "Dataset not found")
    await refresh_stats(db, dataset_id)


@router.get("/{dataset_id}/stats", response_model=DatasetStats)
async def get_stats(dataset_id: str, db: AsyncSession = Depends(get_db)):
    stats = await get_dataset_stats(db, dataset_id)
    if not stats:
        raise HTTPException(404, "Dataset not found")
    return stats
