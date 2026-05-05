import { NavLink, useMatch } from "react-router-dom";
import {
  Database,
  Images,
  Sparkles,
  Star,
  Download,
  Tag,
  BarChart2,
} from "lucide-react";
import clsx from "clsx";

export default function Sidebar() {
  const match = useMatch("/datasets/:datasetId/*");
  const datasetId = match?.params?.datasetId;

  const datasetLinks = datasetId
    ? [
        { to: `/datasets/${datasetId}/gallery`, icon: Images, label: "Gallery" },
        { to: `/datasets/${datasetId}/captioning`, icon: Sparkles, label: "Captioning" },
        { to: `/datasets/${datasetId}/quality`, icon: Star, label: "Quality" },
        { to: `/datasets/${datasetId}/stats`, icon: BarChart2, label: "Stats" },
        { to: `/datasets/${datasetId}/export`, icon: Download, label: "Export" },
      ]
    : [];

  return (
    <aside className="w-56 bg-surface-card border-r border-gray-700/50 flex flex-col h-full shrink-0">
      <div className="p-4 border-b border-gray-700/50">
        <h1 className="text-accent font-bold text-lg tracking-tight">Dataset Manager</h1>
      </div>

      <nav className="flex-1 p-2 space-y-1 overflow-y-auto">
        <NavLink
          to="/datasets"
          className={({ isActive }) =>
            clsx("flex items-center gap-3 px-3 py-2 rounded text-sm transition-colors",
              isActive ? "bg-accent text-white" : "text-gray-300 hover:bg-surface-hover")
          }
        >
          <Database size={16} />
          Datasets
        </NavLink>

        <NavLink
          to="/booru"
          className={({ isActive }) =>
            clsx("flex items-center gap-3 px-3 py-2 rounded text-sm transition-colors",
              isActive ? "bg-accent text-white" : "text-gray-300 hover:bg-surface-hover")
          }
        >
          <Tag size={16} />
          Booru Browser
        </NavLink>

        {datasetLinks.length > 0 && (
          <>
            <div className="pt-3 pb-1 px-3 text-xs text-gray-500 uppercase tracking-wider">
              Active Dataset
            </div>
            {datasetLinks.map(({ to, icon: Icon, label }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  clsx("flex items-center gap-3 px-3 py-2 rounded text-sm transition-colors",
                    isActive ? "bg-accent text-white" : "text-gray-300 hover:bg-surface-hover")
                }
              >
                <Icon size={16} />
                {label}
              </NavLink>
            ))}
          </>
        )}
      </nav>
    </aside>
  );
}
