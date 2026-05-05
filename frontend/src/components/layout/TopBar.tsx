import { useState } from "react";
import { Power } from "lucide-react";
import { useJobStore } from "../../store/jobStore";
import { useAllJobsSSE } from "../../hooks/useSSE";
import ConfirmDialog from "../common/ConfirmDialog";

export default function TopBar() {
  useAllJobsSSE();
  const jobs = useJobStore((s) => s.activeJobs);
  const runningJobs = [...jobs.values()].filter((j) => j.status === "running");
  const active = runningJobs[0];
  const [showConfirm, setShowConfirm] = useState(false);
  const [shuttingDown, setShuttingDown] = useState(false);

  async function handleShutdown() {
    setShowConfirm(false);
    setShuttingDown(true);
    await fetch("/api/v1/shutdown", { method: "POST" }).catch(() => {});
  }

  return (
    <>
      <header className="h-10 bg-surface-card border-b border-gray-700/50 flex items-center px-4 gap-4 shrink-0">
        {active ? (
          <div className="flex items-center gap-3 flex-1">
            <div className="w-2 h-2 rounded-full bg-accent animate-pulse" />
            <span className="text-xs text-gray-400 truncate">{active.message || active.job_type}</span>
            <div className="flex-1 max-w-xs bg-gray-700 rounded-full h-1.5">
              <div
                className="bg-accent h-1.5 rounded-full transition-all duration-300"
                style={{ width: `${active.percent ?? 0}%` }}
              />
            </div>
            <span className="text-xs text-gray-500 tabular-nums">
              {active.done ?? 0}/{active.total ?? 0}
            </span>
          </div>
        ) : (
          <div className="flex-1 text-xs text-gray-600">{shuttingDown ? "Server shutting down…" : "Ready"}</div>
        )}
        {runningJobs.length > 1 && (
          <span className="badge-gray">{runningJobs.length} jobs</span>
        )}
        <button
          className="btn-ghost p-1 text-gray-500 hover:text-red-400 disabled:opacity-40"
          title="Shut down server"
          disabled={shuttingDown}
          onClick={() => setShowConfirm(true)}
        >
          <Power size={15} />
        </button>
      </header>

      {showConfirm && (
        <ConfirmDialog
          title="Shut down server?"
          message="This will stop the Dataset Manager server process. You will need to restart it from the terminal."
          confirmLabel="Shut down"
          danger
          onConfirm={handleShutdown}
          onCancel={() => setShowConfirm(false)}
        />
      )}
    </>
  );
}
