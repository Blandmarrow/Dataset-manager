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

Model IDs and their captioner modules:
| Prefix | Module |
|---|---|
| `florence2*` | `ml/florence_captioner.py` |
| `paligemma2` | `ml/paligemma_captioner.py` (needs `HF_TOKEN` in `.env`; accept license at huggingface.co/google/paligemma2-3b-pt-448) |

`HF_TOKEN` from `.env` is injected into `os.environ` early in `main.py` so all `hf_hub_download` calls pick it up automatically.
| `ollama:*` | `ml/ollama_captioner.py` (HTTP calls to localhost:11434) |
| aesthetic predictor | `ml/aesthetic_scorer.py` (auto-downloads weights from `camenduru/improved-aesthetic-predictor` via `hf_hub_download`) |

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

### Styling

Tailwind CSS v3 with a dark theme. Custom design tokens are in `tailwind.config.js` (`surface`, `accent`). Reusable component classes (`.btn`, `.btn-primary`, `.card`, `.input`, `.badge-*`) are defined in `frontend/src/index.css` under `@layer components`.
