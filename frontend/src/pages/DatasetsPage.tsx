import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, FolderOpen, Trash2 } from "lucide-react";
import toast from "react-hot-toast";
import { datasetsApi } from "../api/datasets";
import type { Dataset } from "../types";
import ConfirmDialog from "../components/common/ConfirmDialog";

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

export default function DatasetsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Dataset | null>(null);
  const [importTarget, setImportTarget] = useState<Dataset | null>(null);
  const [importPath, setImportPath] = useState("");

  const { data: datasets = [], isLoading } = useQuery({
    queryKey: ["datasets"],
    queryFn: datasetsApi.list,
  });

  const createMutation = useMutation({
    mutationFn: () => datasetsApi.create(newName, newDesc),
    onSuccess: (ds) => {
      qc.invalidateQueries({ queryKey: ["datasets"] });
      setShowCreate(false);
      setNewName("");
      setNewDesc("");
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
      toast.success(`Import started (job ${data.job_id})`);
      setImportTarget(null);
      setImportPath("");
      qc.invalidateQueries({ queryKey: ["datasets"] });
    },
    onError: () => toast.error("Import failed"),
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Datasets</h2>
        <button className="btn-primary flex items-center gap-2" onClick={() => setShowCreate(true)}>
          <Plus size={16} /> New Dataset
        </button>
      </div>

      {isLoading && <p className="text-gray-500">Loading...</p>}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {datasets.map((ds) => (
          <div key={ds.id} className="card p-4 space-y-3 hover:border-gray-600 transition-colors">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <h3
                  className="font-medium text-white truncate cursor-pointer hover:text-accent"
                  onClick={() => navigate(`/datasets/${ds.id}/gallery`)}
                >
                  {ds.name}
                </h3>
                {ds.description && (
                  <p className="text-xs text-gray-500 mt-0.5 truncate">{ds.description}</p>
                )}
              </div>
              <div className="flex gap-1 shrink-0">
                <button
                  className="btn-ghost btn-sm p-1.5"
                  onClick={() => { setImportTarget(ds); setImportPath(""); }}
                  title="Import from folder"
                >
                  <FolderOpen size={14} />
                </button>
                <button
                  className="btn-ghost btn-sm p-1.5 text-red-400 hover:text-red-300"
                  onClick={() => setDeleteTarget(ds)}
                  title="Delete dataset"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="bg-surface rounded p-2">
                <div className="text-lg font-bold text-white">{ds.image_count}</div>
                <div className="text-xs text-gray-500">Images</div>
              </div>
              <div className="bg-surface rounded p-2">
                <div className="text-lg font-bold text-accent">
                  {ds.image_count ? Math.round((ds.captioned_count / ds.image_count) * 100) : 0}%
                </div>
                <div className="text-xs text-gray-500">Captioned</div>
              </div>
              <div className="bg-surface rounded p-2">
                <div className="text-lg font-bold text-white">{formatSize(ds.total_size_bytes)}</div>
                <div className="text-xs text-gray-500">Size</div>
              </div>
            </div>

            <button
              className="btn-secondary w-full text-sm"
              onClick={() => navigate(`/datasets/${ds.id}/gallery`)}
            >
              Open Gallery
            </button>
          </div>
        ))}
      </div>

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="card p-6 w-full max-w-md space-y-4">
            <h3 className="font-semibold text-lg">New Dataset</h3>
            <div>
              <label className="label">Name</label>
              <input
                className="input"
                placeholder="My Dataset"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && newName && createMutation.mutate()}
                autoFocus
              />
            </div>
            <div>
              <label className="label">Description (optional)</label>
              <input className="input" placeholder="..." value={newDesc} onChange={(e) => setNewDesc(e.target.value)} />
            </div>
            <div className="flex gap-3 justify-end">
              <button className="btn-ghost" onClick={() => setShowCreate(false)}>Cancel</button>
              <button className="btn-primary" onClick={() => createMutation.mutate()} disabled={!newName || createMutation.isPending}>
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Import Modal */}
      {importTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="card p-6 w-full max-w-md space-y-4">
            <h3 className="font-semibold text-lg">Import from Folder</h3>
            <p className="text-sm text-gray-400">Into: <span className="text-white">{importTarget.name}</span></p>
            <div>
              <label className="label">Folder Path</label>
              <input
                className="input"
                placeholder="C:\Users\Tom\Pictures\training_images"
                value={importPath}
                onChange={(e) => setImportPath(e.target.value)}
              />
            </div>
            <div className="flex gap-3 justify-end">
              <button className="btn-ghost" onClick={() => setImportTarget(null)}>Cancel</button>
              <button className="btn-primary" onClick={() => importMutation.mutate()} disabled={!importPath || importMutation.isPending}>
                Import
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirm */}
      {deleteTarget && (
        <ConfirmDialog
          title="Delete Dataset"
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
