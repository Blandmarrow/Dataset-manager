# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Launch

```powershell
.\setup.ps1        # First time only — creates venv, installs deps, builds frontend
.\start.ps1        # Production: runs migrations, builds frontend if missing, serves on :8000
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

### Layout

**Sidebar** uses `useMatch("/datasets/:datasetId/*")` (not `useParams`) to detect the active dataset, because the Sidebar renders outside the `<Routes>` tree and `useParams` would always return `{}` there.

### Gallery navigation state

`GalleryPage` persists two keys to `sessionStorage` (keyed by `datasetId`):

| Key | Contents | Purpose |
|---|---|---|
| `gallery-state-${datasetId}` | `{ page, sortIdx, captionedFilter, scrollTop }` | Restores page/sort/filter/scroll when returning from detail view |
| `gallery-nav-${datasetId}` | `{ ids, page, sort, order, captionedFilter }` | Ordered image ID list + query context for prev/next navigation in the detail view |

`ImageDetailPage` reads `gallery-nav-*` to support arrow-key navigation. When the user reaches the boundary of the current page it pre-fetches the adjacent page (`useQuery`, `enabled: atEnd / atStart`) and on crossing writes the new page's context back to `gallery-nav-*` and updates `gallery-state-*` so that **Back** returns to the correct gallery page. Arrow keys are suppressed when an `<input>` or `<textarea>` has focus.

### Styling

Tailwind CSS v3 with a dark theme. Custom design tokens are in `tailwind.config.js` (`surface`, `accent`). Reusable component classes (`.btn`, `.btn-primary`, `.card`, `.input`, `.badge-*`) are defined in `frontend/src/index.css` under `@layer components`.
