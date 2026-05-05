import io
import shutil
from pathlib import Path

import imagehash
from PIL import Image, ImageOps

from backend.config import settings


RESAMPLE_MAP = {
    "LANCZOS": Image.Resampling.LANCZOS,
    "BICUBIC": Image.Resampling.BICUBIC,
    "NEAREST": Image.Resampling.NEAREST,
    "BILINEAR": Image.Resampling.BILINEAR,
}


def _open_safe(path: str) -> Image.Image:
    img = Image.open(path)
    img = ImageOps.exif_transpose(img)  # respect EXIF rotation
    if img.mode not in ("RGB", "RGBA"):
        img = img.convert("RGB")
    return img


def get_image_info(path: str) -> dict:
    try:
        img = _open_safe(path)
        return {
            "width": img.width,
            "height": img.height,
            "format": img.format or Path(path).suffix.lstrip(".").upper(),
            "file_size_bytes": Path(path).stat().st_size,
            "phash": str(imagehash.phash(img)),
        }
    except Exception:
        return {}


def generate_thumbnail(src_path: str, dest_path: str, size: int = 256) -> None:
    img = _open_safe(src_path)
    img.thumbnail((size, size), Image.Resampling.LANCZOS)
    Path(dest_path).parent.mkdir(parents=True, exist_ok=True)
    img.save(dest_path, "WEBP", quality=85)


def resize_image(
    path: str,
    width: int | None = None,
    height: int | None = None,
    scale: float | None = None,
    maintain_ar: bool = True,
    resample: str = "LANCZOS",
) -> tuple[int, int]:
    img = _open_safe(path)
    orig_w, orig_h = img.width, img.height
    resampler = RESAMPLE_MAP.get(resample, Image.Resampling.LANCZOS)

    if scale is not None:
        new_w = int(orig_w * scale)
        new_h = int(orig_h * scale)
    elif width and height:
        if maintain_ar:
            ratio = min(width / orig_w, height / orig_h)
            new_w = int(orig_w * ratio)
            new_h = int(orig_h * ratio)
        else:
            new_w, new_h = width, height
    elif width:
        new_w = width
        new_h = int(orig_h * (width / orig_w)) if maintain_ar else orig_h
    elif height:
        new_h = height
        new_w = int(orig_w * (height / orig_h)) if maintain_ar else orig_w
    else:
        raise ValueError("Provide width, height, or scale")

    resized = img.resize((new_w, new_h), resampler)
    resized.save(path)
    return new_w, new_h


def crop_image(path: str, x: int, y: int, width: int, height: int) -> tuple[int, int]:
    img = _open_safe(path)
    cropped = img.crop((x, y, x + width, y + height))
    cropped.save(path)
    return cropped.width, cropped.height


def crop_to_aspect(path: str, target_ar: float, strategy: str = "center") -> tuple[int, int]:
    img = _open_safe(path)
    orig_w, orig_h = img.width, img.height
    current_ar = orig_w / orig_h

    if current_ar > target_ar:
        new_w = int(orig_h * target_ar)
        new_h = orig_h
    else:
        new_w = orig_w
        new_h = int(orig_w / target_ar)

    if strategy == "center":
        x = (orig_w - new_w) // 2
        y = (orig_h - new_h) // 2
    else:
        x, y = 0, 0

    cropped = img.crop((x, y, x + new_w, y + new_h))
    cropped.save(path)
    return cropped.width, cropped.height


def convert_and_save(src_path: str, dest_path: str, fmt: str = "PNG", quality: int = 95) -> None:
    img = _open_safe(src_path)
    if fmt.upper() == "JPEG" and img.mode == "RGBA":
        img = img.convert("RGB")
    img.save(dest_path, fmt.upper(), quality=quality)
