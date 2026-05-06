from PIL import Image, ImageOps


def preprocess_for_caption(
    image_path: str,
    target_w: int | None,
    target_h: int | None,
) -> Image.Image:
    """Open image, correct EXIF orientation, and optionally center-crop + resize to target resolution."""
    img = Image.open(image_path).convert("RGB")
    img = ImageOps.exif_transpose(img)

    if target_w and target_h:
        target_ar = target_w / target_h
        img_ar = img.width / img.height

        if img_ar > target_ar:
            # Image is wider than target — crop left and right
            new_w = int(img.height * target_ar)
            left = (img.width - new_w) // 2
            img = img.crop((left, 0, left + new_w, img.height))
        elif img_ar < target_ar:
            # Image is taller than target — crop top and bottom
            new_h = int(img.width / target_ar)
            top = (img.height - new_h) // 2
            img = img.crop((0, top, img.width, top + new_h))

        img = img.resize((target_w, target_h), Image.Resampling.LANCZOS)

    return img
