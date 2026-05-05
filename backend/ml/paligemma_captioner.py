import asyncio
import logging
from PIL import Image

logger = logging.getLogger(__name__)

STYLE_PROMPTS = {
    "detailed": "<image>describe this image in detail",
    "short": "<image>briefly describe this image",
    "tags": "<image>list the key elements of this image as comma-separated tags",
    "booru": "<image>describe this image using booru-style tags, comma separated",
}


def infer_sync(image_path: str, model_entry, prompt: str) -> str:
    import torch
    model = model_entry.model
    processor = model_entry.processor

    img = Image.open(image_path).convert("RGB")
    inputs = processor(text=prompt, images=img, return_tensors="pt").to("cuda", torch.bfloat16)

    try:
        with torch.no_grad():
            generated_ids = model.generate(
                **inputs,
                max_new_tokens=512,
                do_sample=False,
            )
        # Decode only the new tokens (skip the input prompt tokens)
        input_len = inputs["input_ids"].shape[-1]
        generated_ids = generated_ids[:, input_len:]
        result = processor.batch_decode(generated_ids, skip_special_tokens=True)[0]
        return result.strip()
    except torch.cuda.OutOfMemoryError:
        torch.cuda.empty_cache()
        raise RuntimeError("GPU out of memory during PaliGemma-2 inference")


async def caption_image(image_path: str, model_entry, style: str = "detailed") -> str:
    prompt = STYLE_PROMPTS.get(style, STYLE_PROMPTS["detailed"])
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, infer_sync, image_path, model_entry, prompt)


async def caption_batch(
    image_paths: list[str],
    model_entry,
    style: str = "detailed",
    job_id: str | None = None,
) -> list[str]:
    from backend.workers.progress import broadcaster

    results = []
    total = len(image_paths)

    for i, path in enumerate(image_paths):
        try:
            caption = await caption_image(path, model_entry, style)
        except Exception as e:
            logger.error("PaliGemma-2 failed on %s: %s", path, e)
            caption = ""
        results.append(caption)

        if job_id:
            await broadcaster.emit(job_id, {
                "type": "progress", "job_id": job_id, "job_type": "caption",
                "status": "running", "done": i + 1, "total": total,
                "percent": round((i + 1) / total * 100, 1),
                "current_item": path.split("/")[-1],
                "message": f"PaliGemma-2: {i + 1}/{total}",
            })

    return results
