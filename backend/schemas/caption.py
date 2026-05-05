from pydantic import BaseModel


class CaptionUpdate(BaseModel):
    caption_text: str
    tags: list[str]
    caption_style: str = ""


class TagPatch(BaseModel):
    add: list[str] = []
    remove: list[str] = []


class BatchTagSet(BaseModel):
    image_ids: list[str]
    tags: list[str]
    mode: str = "append"  # "append" or "replace"


class BatchTagRemove(BaseModel):
    image_ids: list[str]
    tags: list[str]


class FindReplaceRequest(BaseModel):
    find: str
    replace: str
    use_regex: bool = False
    image_ids: list[str] | None = None


class TagStatItem(BaseModel):
    tag: str
    count: int
    category: str


class CaptionOut(BaseModel):
    image_id: str
    caption_text: str
    tags: list[str]
    caption_style: str
    captioned_by: str
