import asyncio
import logging

import numpy as np
import torch

logger = logging.getLogger(__name__)


def extract_dino_embedding_sync(image_path: str, model_entry) -> bytes:
    """Returns L2-normalized float16 numpy bytes for DINOv2-base CLS token, shape (768,)."""
    from PIL import Image as PILImage

    model = model_entry.model
    processor = model_entry.processor

    img = PILImage.open(image_path).convert("RGB")
    inputs = processor(images=img, return_tensors="pt")
    inputs = {k: v.to("cuda") for k, v in inputs.items()}

    with torch.no_grad():
        outputs = model(**inputs)
        cls_token = outputs.last_hidden_state[:, 0, :]  # CLS token
        cls_token = cls_token / cls_token.norm(dim=-1, keepdim=True)

    return cls_token[0].cpu().numpy().astype(np.float16).tobytes()


async def extract_embeddings_dino(
    image_paths: list[str],
    model_entry,
    job_id: str | None = None,
) -> list[bytes | None]:
    from backend.workers.progress import broadcaster

    loop = asyncio.get_event_loop()
    results = []
    total = len(image_paths)

    for i, path in enumerate(image_paths):
        try:
            r = await loop.run_in_executor(
                None, extract_dino_embedding_sync, path, model_entry
            )
        except Exception:
            logger.warning("DINOv2 embedding failed for %s", path)
            r = None
        results.append(r)

        if job_id and i % 10 == 0:
            await broadcaster.emit(job_id, {
                "type": "progress", "job_id": job_id, "job_type": "quality_score",
                "status": "running", "done": i + 1, "total": total,
                "percent": round((i + 1) / total * 100, 1),
                "message": f"DINOv2 embeddings {i + 1}/{total}",
            })

    return results
