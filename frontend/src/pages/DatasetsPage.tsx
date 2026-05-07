import { useState, useMemo, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { datasetsApi } from "../api/datasets";
import type { Dataset } from "../types";
import ConfirmDialog from "../components/common/ConfirmDialog";
import { useJobStore } from "../store/jobStore";

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1_073_741_824) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  return `${(bytes / 1_073_741_824).toFixed(2)} GB`;
}

/* Deterministic placeholder tile gradient per card index */
const TILE_HUES = [
  ["#1f3a32","#10221c","#274d40"],
  ["#2a2520","#181412","#3a3128"],
  ["#1f3142","#0f1e2a","#2a4259"],
  ["#3a3a3a","#222222","#4a4a4a"],
  ["#3d2f24","#22180f","#503a2c"],
  ["#2a2440","#16122a","#3b3358"],
  ["#202020","#0f0f0f","#2a2a2a"],
];
function tileGrad(dsIndex: number, k: number) {
  const h = TILE_HUES[(dsIndex + k) % TILE_HUES.length];
  const angle = 135 + k * 7;
  return `linear-gradient(${angle}deg, ${h[0]}, ${h[1]} 60%, ${h[2]})`;
}

export default function DatasetsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Dataset | null>(null);
  const [importTarget, setImportTarget] = useState<Dataset | null>(null);
  const [importPath, setImportPath] = useState("");
  const [importJobId, setImportJobId] = useState<string | null>(null);
  const importJobProgress = useJobStore((s) => s.activeJobs.get(importJobId ?? ""));

  useEffect(() => {
    if (!importJobId || !importJobProgress) return;
    if (importJobProgress.status === "completed") {
      qc.invalidateQueries({ queryKey: ["datasets"] });
      setImportJobId(null);
    } else if (importJobProgress.status === "failed") {
      setImportJobId(null);
    }
  }, [importJobProgress?.status, importJobId, qc]);

  const { data: datasets = [], isLoading } = useQuery({
    queryKey: ["datasets"],
    queryFn: datasetsApi.list,
    staleTime: 0,
  });

  const filtered = useMemo(
    () => datasets.filter((d) => d.name.toLowerCase().includes(search.toLowerCase())),
    [datasets, search]
  );

  const totalImages = datasets.reduce((s, d) => s + d.image_count, 0);
  const totalSize = datasets.reduce((s, d) => s + d.total_size_bytes, 0);

  const createMutation = useMutation({
    mutationFn: () => datasetsApi.create(newName, newDesc),
    onSuccess: (ds) => {
      qc.invalidateQueries({ queryKey: ["datasets"] });
      setShowCreate(false); setNewName(""); setNewDesc("");
      toast.success(`Dataset "${ds.name}" created`);
    },
    onError: () => toast.error("Failed to create dataset"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => datasetsApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["datasets"] });
      setDeleteTarget(null);
      toast.success("Dataset deleted");
    },
  });

  const importMutation = useMutation({
    mutationFn: () => datasetsApi.importFolder(importTarget!.id, importPath),
    onSuccess: (data) => {
      toast.success(`Import started`);
      setImportTarget(null); setImportPath("");
      setImportJobId(data.job_id);
    },
    onError: () => toast.error("Import failed"),
  });

  return (
    <div style={{ padding: "24px 28px", overflowY: "auto", flex: 1 }}>
      {/* Page header */}
      <div className="page-h">
        <div>
          <h1>Datasets</h1>
          <p>
            {datasets.length} datasets · {totalImages.toLocaleString()} images · {formatSize(totalSize)} on disk
          </p>
        </div>
        <div className="phactions">
          <div className="search-wrap">
            <svg className="search-ico" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
              <circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5l3 3"/>
            </svg>
            <input
              className="input"
              placeholder="Search datasets…"
              style={{ width: 220 }}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <button className="btn" onClick={() => setImportTarget(datasets[0] ?? null)}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
              <path d="M2.5 3.5h4l1.5 2h5.5v7h-11v-9z"/>
            </svg>
            Import folder
          </button>
          <button className="btn primary" onClick={() => setShowCreate(true)}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M8 3v10M3 8h10"/>
            </svg>
            New dataset
          </button>
        </div>
      </div>

      {isLoading && <p style={{ color: "var(--fg-mute)" }}>Loading…</p>}

      {/* Dataset grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 14 }}>
        {filtered.map((ds, i) => {
          const pct = ds.image_count ? Math.round((ds.captioned_count / ds.image_count) * 100) : 0;
          return (
            <div
              key={ds.id}
              style={{
                background: "var(--surface-1)", border: "1px solid var(--line)",
                borderRadius: "var(--r-lg)", overflow: "hidden",
                cursor: "pointer", display: "flex", flexDirection: "column",
                position: "relative", transition: "border-color .15s",
              }}
              onClick={() => navigate(`/datasets/${ds.id}/gallery`)}
              onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.borderColor = "var(--line-2)")}
              onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.borderColor = "var(--line)")}
              className="ds-card-wrapper"
            >
              {/* Preview tile strip */}
              <div style={{ height: 110, background: "var(--surface-2)", display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gridTemplateRows: "1fr", gap: 1, position: "relative" }}>
                {(ds.preview_image_ids ?? []).length > 0
                  ? Array.from({ length: 8 }).map((_, k) => {
                      const imgId = ds.preview_image_ids[k % ds.preview_image_ids.length];
                      return (
                        <div key={k} style={{ height: 110, overflow: "hidden", background: "var(--surface-3)" }}>
                          <img
                            src={`/api/v1/images/${imgId}/thumbnail`}
                            alt=""
                            style={{ width: "100%", height: 110, objectFit: "cover", display: "block" }}
                          />
                        </div>
                      );
                    })
                  : Array.from({ length: 8 }).map((_, k) => (
                      <div key={k} style={{ background: tileGrad(i, k) }} />
                    ))
                }
                {/* Fade overlay */}
                <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, transparent 30%, var(--surface-1))", pointerEvents: "none" }} />
              </div>

              {/* Row actions (shown on hover via CSS hack) */}
              <div
                className="ds-row-actions"
                style={{ position: "absolute", top: 10, right: 10, display: "flex", gap: 4, opacity: 0, transition: "opacity .15s", zIndex: 2 }}
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  className="icon-btn"
                  title="Import folder"
                  style={{ width: 26, height: 26, background: "rgba(7,9,11,.7)", border: "1px solid var(--line-2)", backdropFilter: "blur(8px)" }}
                  onClick={() => { setImportTarget(ds); setImportPath(""); }}
                >
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
                    <path d="M2.5 3.5h4l1.5 2h5.5v7h-11v-9z"/>
                  </svg>
                </button>
                <button
                  className="icon-btn danger"
                  title="Delete"
                  style={{ width: 26, height: 26, background: "rgba(7,9,11,.7)", border: "1px solid var(--line-2)", backdropFilter: "blur(8px)" }}
                  onClick={() => setDeleteTarget(ds)}
                >
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
                    <path d="M3 4.5h10M5.5 4.5V3a1 1 0 011-1h3a1 1 0 011 1v1.5M5.5 7.5v4M10.5 7.5v4M4 4.5l1 9h6l1-9"/>
                  </svg>
                </button>
              </div>

              {/* Body */}
              <div style={{ padding: "14px 16px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
                <div>
                  <h3 style={{ margin: "0 0 4px", fontSize: 14.5, fontWeight: 600, letterSpacing: "-.01em" }}>{ds.name}</h3>
                  <p style={{ margin: 0, color: "var(--fg-mute)", fontSize: 12, lineHeight: 1.5, minHeight: 18 }}>
                    {ds.description || <span style={{ color: "var(--fg-soft)" }}>No description</span>}
                  </p>
                </div>

                {/* Stats row */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                  {[
                    { k: "Images", v: ds.image_count.toLocaleString(), accent: false },
                    { k: "Captioned", v: `${pct}%`, accent: true },
                    { k: "Size", v: formatSize(ds.total_size_bytes), accent: false },
                  ].map(({ k, v, accent }) => (
                    <div key={k} style={{ background: "var(--surface-2)", border: "1px solid var(--line)", borderRadius: "var(--r)", padding: "8px 10px" }}>
                      <div style={{ color: "var(--fg-dim)", fontSize: 10.5, letterSpacing: ".04em", textTransform: "uppercase" }}>{k}</div>
                      <div style={{ color: accent ? "var(--accent)" : "var(--fg)", fontSize: accent ? 16 : 14, fontWeight: 600, marginTop: 2, fontFeatureSettings: '"tnum"' }}>{v}</div>
                    </div>
                  ))}
                </div>

                {/* Meta */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--fg-dim)", fontSize: 11.5 }}>
                  <span className="mono">{ds.captioned_count}/{ds.image_count} captioned</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Hover row-actions reveal via style injection */}
      <style>{`.ds-card-wrapper:hover .ds-row-actions { opacity: 1 !important; }`}</style>

      {/* Create Modal */}
      {showCreate && (
        <div className="dialog-bg">
          <div className="dialog">
            <h3>New Dataset</h3>
            <p>Give it a name and optional description.</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 18 }}>
              <div>
                <label className="label">Name</label>
                <input className="input" placeholder="my_dataset" value={newName} autoFocus
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && newName && createMutation.mutate()} />
              </div>
              <div>
                <label className="label">Description (optional)</label>
                <input className="input" placeholder="…" value={newDesc} onChange={(e) => setNewDesc(e.target.value)} />
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="btn ghost" onClick={() => setShowCreate(false)}>Cancel</button>
              <button className="btn primary" onClick={() => createMutation.mutate()} disabled={!newName || createMutation.isPending}>Create</button>
            </div>
          </div>
        </div>
      )}

      {/* Import Modal */}
      {importTarget && (
        <div className="dialog-bg">
          <div className="dialog">
            <h3>Import from folder</h3>
            <p>Into: <strong style={{ color: "var(--fg)" }}>{importTarget.name}</strong></p>
            <div style={{ marginBottom: 18 }}>
              <label className="label">Folder path</label>
              <input className="input" placeholder="D:\datasets\my_images" value={importPath}
                onChange={(e) => setImportPath(e.target.value)} autoFocus />
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="btn ghost" onClick={() => setImportTarget(null)}>Cancel</button>
              <button className="btn primary" onClick={() => importMutation.mutate()} disabled={!importPath || importMutation.isPending}>Import</button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="Delete dataset"
          message={`Delete "${deleteTarget.name}" and all its images? This cannot be undone.`}
          confirmLabel="Delete"
          danger
          onConfirm={() => deleteMutation.mutate(deleteTarget.id)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
