import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { datasetsApi } from "../api/datasets";
import { captionsApi } from "../api/captions";

const COLORS = ["#e94560", "#6366f1", "#22d3ee", "#a78bfa", "#34d399", "#fb923c"];

function formatSize(mb: number) {
  return mb > 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(1)} MB`;
}

export default function StatsPage() {
  const { datasetId } = useParams<{ datasetId: string }>();

  const { data: stats, isLoading } = useQuery({
    queryKey: ["dataset-stats", datasetId],
    queryFn: () => datasetsApi.stats(datasetId!),
    enabled: !!datasetId,
  });

  const { data: tagStats = [] } = useQuery({
    queryKey: ["tag-stats", datasetId],
    queryFn: () => captionsApi.tagStats(datasetId!),
    enabled: !!datasetId,
  });

  if (isLoading) return <div className="p-8 text-gray-500">Loading stats...</div>;
  if (!stats) return <div className="p-8 text-gray-500">No data</div>;

  const arData = Object.entries(stats.aspect_ratio_distribution).map(([k, v]) => ({ name: k, count: v }));
  const fmtData = Object.entries(stats.format_distribution).map(([k, v]) => ({ name: k, count: v }));
  const scoreData = Object.entries(stats.score_distribution).map(([k, v]) => ({ name: k, count: v }));
  const topTags = tagStats.slice(0, 20);

  return (
    <div className="p-6 space-y-6">
      <h2 className="text-xl font-semibold">Dataset Statistics</h2>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total Images", value: stats.image_count },
          { label: "Captioned", value: `${stats.caption_coverage_pct}%` },
          { label: "Total Size", value: formatSize(stats.total_size_mb) },
          { label: "Avg Dimensions", value: stats.avg_width ? `${Math.round(stats.avg_width)}×${Math.round(stats.avg_height!)}` : "—" },
        ].map(({ label, value }) => (
          <div key={label} className="card p-4 text-center">
            <div className="text-2xl font-bold text-white">{value}</div>
            <div className="text-xs text-gray-500 mt-1">{label}</div>
          </div>
        ))}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card p-4">
          <h3 className="text-sm font-medium text-gray-400 mb-3">Aspect Ratios</h3>
          <ResponsiveContainer width="100%" height={160}>
            <PieChart>
              <Pie data={arData} dataKey="count" nameKey="name" cx="50%" cy="50%" outerRadius={60} label={({ name }) => name}>
                {arData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip contentStyle={{ background: "#16213e", border: "1px solid #374151" }} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="card p-4">
          <h3 className="text-sm font-medium text-gray-400 mb-3">Formats</h3>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={fmtData}>
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#9ca3af" }} />
              <YAxis tick={{ fontSize: 11, fill: "#9ca3af" }} />
              <Tooltip contentStyle={{ background: "#16213e", border: "1px solid #374151" }} />
              <Bar dataKey="count" fill="#e94560" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card p-4">
          <h3 className="text-sm font-medium text-gray-400 mb-3">Aesthetic Scores</h3>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={scoreData}>
              <XAxis dataKey="name" tick={{ fontSize: 9, fill: "#9ca3af" }} />
              <YAxis tick={{ fontSize: 11, fill: "#9ca3af" }} />
              <Tooltip contentStyle={{ background: "#16213e", border: "1px solid #374151" }} />
              <Bar dataKey="count" fill="#6366f1" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Top tags */}
      {topTags.length > 0 && (
        <div className="card p-4">
          <h3 className="text-sm font-medium text-gray-400 mb-3">Top 20 Tags</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={topTags} layout="vertical">
              <XAxis type="number" tick={{ fontSize: 11, fill: "#9ca3af" }} />
              <YAxis dataKey="tag" type="category" width={120} tick={{ fontSize: 10, fill: "#9ca3af" }} />
              <Tooltip contentStyle={{ background: "#16213e", border: "1px solid #374151" }} />
              <Bar dataKey="count" fill="#22d3ee" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
