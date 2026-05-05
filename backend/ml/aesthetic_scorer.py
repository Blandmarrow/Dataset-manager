import asyncio
import logging
from pathlib import Path

import torch
import torch.nn as nn

logger = logging.getLogger(__name__)


class AestheticMLP(nn.Module):
    def __init__(self, input_size: int) -> None:
        super().__init__()
        self.layers = nn.Sequential(
            nn.Linear(input_size, 1024),
            nn.Dropout(0.2),
            nn.Linear(1024, 128),
            nn.Dropout(0.2),
            nn.Linear(128, 64),
            nn.Dropout(0.1),
            nn.Linear(64, 16),
            nn.Linear(16, 1),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.layers(x)


def download_weights(dest: Path) -> None:
    from huggingface_hub import hf_hub_download
    logger.info("Downloading aesthetic predictor weights...")
    dest.parent.mkdir(parents=True, exist_ok=True)
    path = hf_hub_download(
        repo_id="camenduru/improved-aesthetic-predictor",
        filename="sac+logos+ava1-l14-linearMSE.pth",
    )
    import shutil
    shutil.copy(path, dest)
    logger.info("Aesthetic predictor weights saved to %s", dest)


def score_image_sync(image_path: str, model_entry: dict) -> float:
    from PIL import Image
    clip_model = model_entry["clip"]
    mlp = model_entry["mlp"]
    preprocess = model_entry["preprocess"]

    img = Image.open(image_path).convert("RGB")
    tensor = preprocess(img).unsqueeze(0).to("cuda")

    with torch.no_grad(), torch.autocast("cuda"):
        features = clip_model.encode_image(tensor)
        features = features / features.norm(dim=-1, keepdim=True)
        score = mlp(features.float()).item()

    return round(max(1.0, min(10.0, score)), 3)


async def score_images_batch(
    image_paths: list[str],
    model_entry_dict: dict,
    job_id: str | None = None,
) -> list[float]:
    from backend.workers.progress import broadcaster

    loop = asyncio.get_event_loop()
    scores = []
    total = len(image_paths)

    for i, path in enumerate(image_paths):
        try:
            score = await loop.run_in_executor(None, score_image_sync, path, model_entry_dict)
        except Exception:
            score = 0.0
        scores.append(score)

        if job_id and i % 10 == 0:
            await broadcaster.emit(job_id, {
                "type": "progress", "job_id": job_id, "job_type": "quality_score",
                "status": "running", "done": i + 1, "total": total,
                "percent": round((i + 1) / total * 100, 1),
                "message": f"Scoring image {i + 1}/{total}",
            })

    return scores
