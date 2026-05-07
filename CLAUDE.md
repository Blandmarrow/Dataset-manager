# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Launch

```powershell
.\setup.ps1        # First time only — creates venv, installs deps, builds frontend
.\start.ps1        # Production: runs migrations, rebuilds frontend if any src file is newer than dist, serves on :8000
.\start_dev.ps1    # Dev mode: backend on :8000 (hot reload) + Vite frontend on :5173
```

To shut down the running server, click the power icon button in the top-right of the TopBar (confirms before shutting down), or press Ctrl+C in the terminal.

### Backend (always run from `backend/` with venv active)

```powershell
cd backend
..\venv\Scripts\Activate.ps1
alembic upgrade head                     # apply migrations
alembic revision --autogenerate -m "msg" # generate new migration
```

### Frontend

```powershell
cd frontend
npm run dev      # Vite dev server on :5173 (proxies /api to :8000)
npm run build    # TypeScript check + Vite production build → frontend/dist/
npm run lint     # ESLint
```

## Architecture

### Data flow

HTTP request → FastAPI router → service layer (pure business logic, no HTTP) → SQLAlchemy async session → SQLite.

Long-running operations (captioning, quality scoring, import, export, batch ops) are queued: the router creates a `BackgroundJob` DB record, enqueues a coroutine in `workers/job_queue.py`, and immediately returns `{job_id}`. The worker runs the job, emits SSE progress events via `workers/progress.py`, and updates the job row when done. The frontend subscribes to `GET /api/v1/jobs/stream/{job_id}` (or `/stream/all/events` for the global progress bar).

### Key invariants

- **tags_json is the source of truth.** `image.tags_json` (JSON column) is always kept in sync with the `tags` table via `_sync_tags()` in `caption_service.py` — both written in the same transaction. Never write the `tags` table directly.
- **Always `ImageOps.exif_transpose()` first.** Every Pillow operation in `image_service.py` calls this before anything else to correct orientation from EXIF data.
- **Absolute DB path.** `config.py` derives the database URL from `Path(__file__).parent.parent` so it resolves correctly regardless of the working directory when uvicorn is launched.
- **Path traversal guard.** `_safe_path()` in `routers/images.py` validates that resolved file paths stay within `settings.datasets_dir`.

### ML model management

`ml/model_manager.py` is a singleton that tracks loaded models and their VRAM usage. Before loading a model it calls `_evict_lru(needed_mb)` to free space. Each model_id gets its own `asyncio.Lock` to serialize inference. All inference runs in `loop.run_in_executor(None, _sync_fn)` to avoid blocking the event loop. Ollama models are not tracked — Ollama manages its own VRAM.

Model IDs and their captioner/scorer modules:
| Prefix | Module |
|---|---|
| `florence2*` | `ml/florence_captioner.py` |
| `paligemma2` | `ml/paligemma_captioner.py` (needs `HF_TOKEN` in `.env`; accept license at huggingface.co/google/paligemma2-3b-pt-448) |

`HF_TOKEN` from `.env` is injected into `os.environ` early in `main.py` so all `hf_hub_download` calls pick it up automatically.
| `ollama:*` | `ml/ollama_captioner.py` (HTTP calls to localhost:11434) |

**Target resolution preprocessing**: `CaptionJobRequest` accepts optional `target_width` / `target_height`. When set, `ml/image_utils.py::preprocess_for_caption()` center-crops each image to the target aspect ratio and resizes it to the exact target resolution before inference. This ensures captions describe the composition the model will actually see at training time. All three captioners (Florence-2, PaliGemma-2, Ollama) call this utility; Ollama's existing `max_px` scale-down runs afterward on the already-cropped image. Omitting both fields leaves behavior unchanged.
| `aesthetic` | `ml/aesthetic_scorer.py` (auto-downloads weights from `camenduru/improved-aesthetic-predictor` via `hf_hub_download`; also used for CLIP zero-shot watermark detection and CLIP embedding extraction) |
| `dino` | `ml/dino_scorer.py` (`facebook/dinov2-base` via HuggingFace `transformers`; ~1.2 GB VRAM; used for DINOv2 embedding extraction) |

Quality scorers and what they add to `Image`:
| Module | Columns written | Notes |
|---|---|---|
| `ml/technical_scorer.py` | `blur_score`, `noise_score`, `uniformity_score`, `color_score`, `saturation_score`; flags `is_blurry`, `is_noisy`, `is_uniform` | Pure OpenCV/numpy, no GPU |
| `ml/aesthetic_scorer.py` | `aesthetic_score` (1–10), `watermark_score` (0–1), flag `has_watermark`, `clip_embedding` (BLOB, float16) | CLIP ViT-L-14; text encoder used for zero-shot watermark; image encoder for embeddings |
| `ml/dino_scorer.py` | `dino_embedding` (BLOB, float16) | DINOv2 CLS token, 768-dim |
| `ml/similarity_scorer.py` | — | CPU-only; `compute_style_similarity(ref_bytes, cand_bytes)` returns cosine similarity list |

Flag thresholds (defined as constants in their respective modules):
| Flag | Column | Threshold | Constant |
|---|---|---|---|
| `is_blurry` | `blur_score` (Laplacian variance) | < 80 | `BLUR_THRESHOLD` in `technical_scorer.py` |
| `is_noisy` | `noise_score` (smooth-region std dev) | > 15 | `NOISE_THRESHOLD` in `technical_scorer.py` |
| `is_uniform` | `uniformity_score` (grayscale std dev) | < 12 | `UNIFORMITY_THRESHOLD` in `technical_scorer.py` |
| `has_watermark` | `watermark_score` (CLIP zero-shot, 0–1) | ≥ 0.6 | `WATERMARK_THRESHOLD` in `aesthetic_scorer.py` |

Recommended training-data thresholds (surfaced in the QualityPage score guide):
- **Aesthetic**: ≥ 5.0 minimum; ≥ 6.5 for curated sets; < 4.0 reject
- **Watermark**: exclude any image with `has_watermark = True`
- **Blur / Noise / Uniform**: exclude flagged images unless the flag matches intentional style
- **Style similarity**: ≥ 0.5 cosine similarity as a starting point for style-consistent filtering

Style similarity flow: (1) run scoring with `run_embeddings=True` to store `clip_embedding`/`dino_embedding` per image; (2) call `POST /quality/style-similarity` with `reference_image_ids` and/or `reference_embeddings` (base64 float16 bytes) to write `style_similarity_score` for all images via CPU numpy matmul — no job queue needed. Local reference files (not in the dataset) can be embedded on-the-fly via `POST /quality/embed-references` (multipart upload → returns base64 embeddings to pass as `reference_embeddings`).

**TorchDynamo is disabled** (`TORCHDYNAMO_DISABLE=1` set in `main.py`). Triton is unavailable on Windows and single-image inference gains nothing from `torch.compile`, so it is disabled for the entire process. Do not remove this without re-testing all ML inference paths on Windows.

**Venv ML packages**: torch, transformers, open_clip, etc. are installed in the system Python (`C:\Users\Tom\AppData\Local\Programs\Python\Python310`) and exposed to the venv via `venv/lib/site-packages/system_ml_packages.pth`. The venv was created with `--system-site-packages` and `huggingface-hub` is pinned to `>=0.30,<1.0` in the venv to stay compatible with those system packages.

### Database

SQLite in WAL mode (`synchronous=NORMAL`). ORM models live in `backend/models/`. Alembic migrations in `backend/alembic/versions/`. The Alembic `env.py` strips `+aiosqlite` from the URL when running synchronous migrations.

### SSE progress

`ProgressBroadcaster` (singleton in `workers/progress.py`) maintains per-job `asyncio.Queue`s. Emitting a progress event pushes to the job-specific channel and the `"all"` channel. A 25-second heartbeat comment keeps proxies from closing idle connections. Streams close when status becomes `completed`, `failed`, or `cancelled`.

### Frontend state

- **TanStack Query** — all server state (datasets, images, captions, jobs). Query keys follow `["resource", id]` pattern.
- **Zustand stores** — `datasetStore` (active dataset), `selectionStore` (Set of selected image IDs), `jobStore` (Map of active job progress from SSE), `promptPresetsStore` (saved AI prompt presets, persisted to localStorage).
- **`useJobSSE(jobId)`** — opens `EventSource` for one job, writes progress to `jobStore`.
- **`useAllJobsSSE()`** — opened at app root in `TopBar`, drives the global progress bar.
- **Job completion → cache invalidation**: pages that trigger background jobs (`QualityPage`, `SelectionToolbar`, `ImageDetailPage`) watch their job ID in `jobStore` via `useEffect` and call `qc.invalidateQueries` when status becomes `"completed"`. Always follow this pattern when adding new job-triggering UI.
- **SelectionToolbar score modal**: the "Run Scoring" action accepts four boolean toggles — `run_technical`, `run_aesthetic`, `run_watermark` (CLIP zero-shot watermark detection), and `run_embeddings` (CLIP + DINOv2 embedding extraction for style similarity). `run_watermark` and `run_embeddings` default to `false` since they add significant VRAM/time overhead.

### Layout

**Sidebar** uses `useMatch("/datasets/:datasetId/*")` (not `useParams`) to detect the active dataset, because the Sidebar renders outside the `<Routes>` tree and `useParams` would always return `{}` there.

### Gallery filters

`GalleryPage` supports the following filter controls:

- **Search bar** — debounced 350 ms; passes `search` param to `GET /images/`; filters by filename OR caption text (case-insensitive).
- **Caption filter** — All / Captioned / Uncaptioned.
- **Quality flag** — dropdown with options: None, Blurry (`is_blurry`), Noisy (`is_noisy`), Near-uniform (`is_uniform`), Watermarked (`has_watermark`), Duplicate (`is_duplicate`). All values map directly to `quality_flag` param.
- **Score filters** — multi-chip system: each active filter is a `{field, min?, max?}` chip with a × remove button. An "Add score filter" form lets the user pick any of the 8 score fields and enter optional min/max bounds. Multiple chips are combined as AND conditions via the JSON-encoded `score_filters` param. The older single `score_field`/`min_score`/`max_score` params are not used by GalleryPage (retained only for StatsPage BucketPanel backward compat).

### Gallery navigation state

`GalleryPage` persists two keys to `sessionStorage` (keyed by `datasetId`):

| Key | Contents | Purpose |
|---|---|---|
| `gallery-state-${datasetId}` | `{ page, sortIdx, captionedFilter, scrollTop }` | Restores page/sort/filter/scroll when returning from detail view |
| `gallery-nav-${datasetId}` | `{ ids, page, sort, order, captionedFilter }` | Ordered image ID list + query context for prev/next navigation in the detail view |

`ImageDetailPage` reads `gallery-nav-*` to support arrow-key navigation. When the user reaches the boundary of the current page it pre-fetches the adjacent page (`useQuery`, `enabled: atEnd / atStart`) and on crossing writes the new page's context back to `gallery-nav-*` and updates `gallery-state-*` so that **Back** returns to the correct gallery page. Arrow keys are suppressed when an `<input>` or `<textarea>` has focus.

### Datasets page

`DatasetsPage` uses `queryKey: ["datasets"]` with `staleTime: 0` so the list is always refetched on mount.

**Preview strip**: `GET /datasets/` (`DatasetOut`) includes `preview_image_ids: list[str]` — up to 8 image IDs fetched in a single batch query alongside the datasets list. The card renders these as `<img src="/api/v1/images/{id}/thumbnail">` tiles. When a dataset has no images the strip falls back to deterministic colour gradients.

**Import job tracking**: after starting an import (`POST /datasets/{id}/import`) `DatasetsPage` stores the returned `job_id` and watches it in `jobStore` via `useEffect`. The `["datasets"]` query is invalidated only when the job status becomes `"completed"` — not when the job is created — so image counts update after the import actually finishes.

**Drag-and-drop upload**: `GalleryPage` supports dropping image files onto the grid (`onDragEnter`/`onDragLeave`/`onDrop` on the scroll container wrapper) — this works. `DatasetsPage` has the plumbing in place (native `dragover`/`drop` listeners via `useEffect` on `pageRef`, `data-dataset-id` attributes on cards, `dragOverId` state for the overlay) but the drop does not trigger uploads reliably — **TODO: debug and fix**. Approaches already tried without success: React synthetic `onDragEnter`+`onDragLeave`, `onDragOver`-based debounce timer, native `addEventListener` on the page container with `elementFromPoint`.

### Statistics page

`frontend/src/pages/StatsPage.tsx` renders the dataset analytics dashboard. It makes four queries:

| Query key | Source | Contents |
|---|---|---|
| `["dataset-stats", datasetId]` | `GET /datasets/{id}/stats` | All distributions (see schema below) |
| `["tag-stats", datasetId]` | `GET /captions/dataset/{id}/tag-stats` | Top 500 tags with counts |
| `["tag-cooccurrence", datasetId]` | `GET /datasets/{id}/tag-cooccurrence?limit=15` | Top-15 tag co-occurrence matrix |
| `["score-values", datasetId]` | `GET /datasets/{id}/score-values` | Raw float arrays for all 8 score fields + `megapixels`, `file_size_mb`, `caption_words` — used for client-side histogram rebucketing |

**`DatasetStats` schema** (in `backend/schemas/dataset.py`) includes these distribution dicts on top of the basic summary fields. All are computed in a single row-scan in `dataset_service.get_dataset_stats()`:

| Field | Description |
|---|---|
| `blur_distribution` | Laplacian variance bucketed into 6 ranges |
| `noise_distribution` | Smooth-region std dev bucketed into 6 ranges |
| `uniformity_distribution` | Grayscale std dev bucketed into 5 ranges |
| `watermark_distribution` | CLIP watermark score in 10 equal 0.1-wide bins |
| `color_distribution` / `saturation_distribution` | Hasler-Süsstrunk color/saturation buckets |
| `megapixel_distribution` | `width × height / 1M` bucketed into 7 ranges |
| `file_size_distribution` | File size in MB bucketed into 6 ranges |
| `file_size_summary` | `{min_mb, median_mb, p95_mb, max_mb}` |
| `aspect_ratio_fine` | 8 common AR buckets (9:16+ → 21:9+) |
| `caption_length_distribution` | Word count bucketed into 6 ranges |
| `style_similarity_distribution` | 10 equal bins (0–1 range) of `style_similarity_score`, same bucketing as `watermark_distribution` |
| `quality_flag_counts` | `{blurry, noisy, uniform, watermarked, duplicate}` counts |
| `score_coverage` | How many images have each score type computed |

Default bucket edges are defined as `DEFAULT_EDGES` in `StatsPage.tsx`. Edges on the backend (`dataset_service.py`) are used only for pre-computing the initial distributions returned by `/stats`; when the user customises edges, `rebucketValues()` runs entirely client-side against the raw `score-values` arrays — no backend call needed.

**Editable histograms (HistPanel)**: Every score/metric histogram has a pencil icon that opens an inline edge editor. The user types comma-separated boundary values (e.g. `"4, 6"` for aesthetic score), presses Apply or Enter, and the chart immediately rebuckets using the raw value arrays. A "custom" badge appears in the panel title when non-default edges are active; Reset restores the defaults. Aspect ratio and file format histograms are non-editable (no raw values to rebucket). When a customised bar is clicked, `BucketPanel` still opens with the correct `min`/`max` filter derived from the custom edges.

**Clickable bars → BucketPanel**: Every histogram bar carries a `filter` object in its chart-entry data. Clicking fires a `Bar.onClick` handler (recharts v3 pattern — use `Bar.onClick`, not `BarChart.onClick`) which opens a `BucketPanel` modal. The panel queries `GET /images/` with the filter params and shows up to 200 thumbnails. Quality flag cards are also clickable.

**`GET /images/` filter extensions** (in `backend/routers/images.py`):

| Param | Type | Effect |
|---|---|---|
| `search` | `str` | Case-insensitive LIKE filter across `original_filename` and `caption_text` (OR logic) |
| `score_field` | `str` | Which score column `min_score`/`max_score` apply to (whitelist-validated; defaults to `aesthetic_score`) |
| `score_is_null` | `bool` | Filter images where `score_field IS NULL` (used for "unscored" bucket) |
| `score_filters` | `str` (JSON) | JSON-encoded array of `{field, min?, max?}` objects; each entry adds an AND condition; fields validated against `_ALLOWED_SCORE_FIELDS` whitelist |
| `quality_flag` | `str` | Filter by JSON flag key in `quality_flags` (e.g. `is_blurry`) |
| `file_size_min` / `file_size_max` | `int` | `file_size_bytes` range (bytes) |
| `mp_min` / `mp_max` | `float` | `width × height` megapixel range |
| `ar_min` / `ar_max` | `float` | Aspect ratio `width / height` range |
| `format_filter` | `str` | Exact `Image.format` match (e.g. `PNG`) |

**ImageLightbox**: Clicking a thumbnail in `BucketPanel` opens a full-resolution lightbox with prev/next navigation, metadata footer, a "View Details →" link to `/datasets/:datasetId/image/:imageId`, and a two-step **Delete** button. Deleting an image removes it from the panel's TanStack Query cache via `queryClient.setQueryData` (no refetch) and invalidates `dataset-stats`, `tag-stats`, and `tag-cooccurrence` queries. A per-thumbnail ×-on-hover delete button with an inline confirm overlay provides the same action from the grid.

### Styling

Tailwind CSS v3 with a dark theme. Color tokens are CSS custom properties defined in `index.css` (`:root { --bg, --surface-1/2/3, --accent, --line, --fg, --warn, --bad, --info }`) and aliased in `tailwind.config.js` so they can be used as Tailwind classes. Geist/Geist Mono fonts are loaded via Google Fonts in `index.html`. Reusable component classes are defined in `frontend/src/index.css` under `@layer components`:

| Class | Purpose |
|---|---|
| `.btn`, `.btn.primary`, `.btn.ghost`, `.btn.danger`, `.btn.sm` | Button variants |
| `.input`, `.select`, `.checkbox` | Form controls |
| `.panel`, `.panel-h`, `.panel-b` | Card container with header/body sections |
| `.form-row` | 2-col grid (200px label + 1fr control) used in CaptioningPage and ExportPage |
| `.model-row` | Radio-style model selector row with name, description, and VRAM label |
| `.stat-card` | Metric card with large value, label, and optional delta |
| `.hist` / `.hist-axis` | CSS grid bar chart; set `--cols` and `gridTemplateRows: "1fr"` inline; bars use percentage `height` |
| `.flag-card` | 3-col grid (icon, label/desc, count) for quality flags |
| `.badge`, `.badge.dot`, `.badge.good/warn/bad/info/solid` | Semantic badge variants |
| `.icon-btn` | 30×30 ghost icon button |
| `.sel-bar` | Sticky bottom pill bar for selection actions |
| `.crumbs` | Breadcrumb navigation |
| `.nav-section`, `.nav-tail` | Sidebar section header and count badge |
| `.tabs`, `.tab` | Tab bar with accent underline active state |

**CSS hist bars**: The `.hist` class sets `display: grid; align-items: end; height: 90px`. For percentage `height` on bar children to resolve, you must also set `gridTemplateRows: "1fr"` as an inline style on the `.hist` div. Without this the single implicit row has no definite height and percentage heights collapse to 0.

### System GPU stats

`GET /api/v1/system/gpu` (router: `backend/routers/system.py`) returns `{ name, used_mb, total_mb, utilization_pct }` using `torch.cuda.memory_allocated()` and `torch.cuda.get_device_properties(0)`. Returns `{ name: null }` when CUDA is unavailable. The Sidebar's GPU meter (`useGpuStats` hook in `frontend/src/hooks/useGpuStats.ts`) polls this every 5 s via TanStack Query.

### Captioning post-processing

`CaptionJobRequest` (in `backend/routers/captioning.py`) accepts three post-processing flags:

| Field | Default | Effect |
|---|---|---|
| `append_tags` | `true` | After generating a caption, merge existing `tags_json` into it. For tag/booru styles: deduplicate and rebuild comma-separated string. For prose styles: append existing tags as a comma-separated suffix. |
| `strip_refusals` | `true` | Remove common AI refusal phrases from generated captions via `_REFUSAL_RE` compiled regex. |
| `save_backup` | `false` | Before calling `set_caption`, write the existing `.txt` sidecar to `.txt.bak`. |

All three captioners (Florence-2, PaliGemma-2, Ollama) emit `throughput_ips` (float, images/sec) and `vram_used_mb` (int) in every SSE progress event. Ollama always reports `vram_used_mb: 0` since Ollama manages its own VRAM.

### Export page

`ExportPage.tsx` supports 3 format buttons: kohya, ai-toolkit, plain folder. All three are fully implemented. The left panel uses `.form-row` layout throughout.

**Filters** (applied in `export_service.py::_is_excluded()`, shared by all three formats):

| Control | Param sent | Backend behaviour |
|---|---|---|
| Aesthetic ≥ N | `aesthetic_min: float` | Excludes images where `aesthetic_score` is NULL or below threshold |
| Has caption | `captioned_only: bool` | Excludes images with no `caption_text` and empty `tags_json` |
| Per-flag checkboxes (Blurry / Noisy / Near-uniform / Watermarked / Duplicate) | `exclude_flags: str` (comma-separated flag names, e.g. `"is_blurry,has_watermark"`) | Excludes images where any of the named keys in `quality_flags` JSON is truthy |
| Style similarity ≥ N | `style_sim_min: float` | Excludes images where `style_similarity_score` is NULL or below threshold |

Filter params are debounced 350 ms on the frontend; the preview query (`GET /export/preview/{dataset_id}`) reacts to changes and returns `{ will_export, total, excluded_low_aesthetic, excluded_uncaptioned, excluded_flagged, excluded_style_sim, sample_files }`.

**Caption format** (`caption_format: "txt" | "caption" | "jsonl"`): controls sidecar extension for kohya/ai-toolkit; `"jsonl"` writes a single `captions.jsonl` in the output root instead of per-image sidecars. Hidden for plain folder (always writes `captions.jsonl` + `tags.csv`).

**Resize** (`resize_to: int | None`): after copying/converting, resizes the longest side to the given pixel count via Pillow (only downscales; originals untouched). Skips the PIL round-trip entirely when `resize_to=None` and `output_format="original"`.

**Plain folder** output structure:
```
output_dir/
  images/        ← copied/converted images
  captions.jsonl ← {"file": "name.png", "caption": "...", "tags": [...]} per line
  tags.csv       ← file,tag rows (one row per tag per image)
```
