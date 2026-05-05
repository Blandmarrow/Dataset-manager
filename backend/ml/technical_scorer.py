import asyncio
import logging
from pathlib import Path

import cv2
import imagehash
import numpy as np
from PIL import Image

logger = logging.getLogger(__name__)

BLUR_THRESHOLD = 100.0   # Laplacian variance below this = blurry
NOISE_THRESHOLD = 15.0   # noise score above this = noisy
DUPLICATE_THRESHOLD = 8  # Hamming distance threshold


def score_technical_sync(image_path: str) -> dict:
    img_cv = cv2.imread(image_path)
    if img_cv is None:
        return {"blur_score": 0.0, "noise_score": 0.0, "is_blurry": True, "is_noisy": False}

    gray = cv2.cvtColor(img_cv, cv2.COLOR_BGR2GRAY)

    # Blur detection via Laplacian variance
    blur_score = float(cv2.Laplacian(gray, cv2.CV_64F).var())

    # Noise estimation via difference from Gaussian-smoothed version
    smoothed = cv2.GaussianBlur(gray.astype(np.float32), (5, 5), 0)
    noise_score = float(np.std(gray.astype(np.float32) - smoothed))

    return {
        "blur_score": round(blur_score, 3),
        "noise_score": round(noise_score, 3),
        "is_blurry": blur_score < BLUR_THRESHOLD,
        "is_noisy": noise_score > NOISE_THRESHOLD,
    }


async def score_images_technical(
    image_ids: list[str],
    image_paths: list[str],
    job_id: str | None = None,
) -> list[dict]:
    from backend.workers.progress import broadcaster

    loop = asyncio.get_event_loop()
    results = []
    total = len(image_paths)

    for i, path in enumerate(image_paths):
        try:
            scores = await loop.run_in_executor(None, score_technical_sync, path)
        except Exception:
            scores = {"blur_score": 0.0, "noise_score": 0.0, "is_blurry": False, "is_noisy": False}
        results.append(scores)

        if job_id and i % 10 == 0:
            await broadcaster.emit(job_id, {
                "type": "progress", "job_id": job_id, "job_type": "quality_score",
                "status": "running", "done": i + 1, "total": total,
                "percent": round((i + 1) / total * 100, 1),
                "message": f"Technical scoring {i + 1}/{total}",
            })

    return results


def find_duplicates_sync(phashes: list[tuple[str, str]]) -> list[list[str]]:
    """Group image IDs by near-identical phash (Hamming distance < threshold)."""
    groups: list[list[str]] = []
    assigned: set[str] = set()

    for i, (id_a, hash_a) in enumerate(phashes):
        if id_a in assigned:
            continue
        group = [id_a]
        h_a = imagehash.hex_to_hash(hash_a)
        for id_b, hash_b in phashes[i + 1:]:
            if id_b in assigned:
                continue
            h_b = imagehash.hex_to_hash(hash_b)
            if h_a - h_b < DUPLICATE_THRESHOLD:
                group.append(id_b)
                assigned.add(id_b)
        if len(group) > 1:
            assigned.add(id_a)
            groups.append(group)

    return groups
