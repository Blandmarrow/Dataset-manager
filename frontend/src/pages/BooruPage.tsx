import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Tag } from "lucide-react";
import { booruApi } from "../api/booru";
import clsx from "clsx";

const CATEGORY_COLORS: Record<string, string> = {
  character: "text-blue-400",
  artist: "text-purple-400",
  copyright: "text-yellow-400",
  meta: "text-gray-400",
  general: "text-gray-300",
};

const CATEGORY_BADGES: Record<string, string> = {
  character: "badge-blue",
  artist: "bg-purple-900/60 text-purple-300 badge",
  copyright: "badge-yellow",
  meta: "badge-gray",
  general: "badge-gray",
};

export default function BooruPage() {
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<"safebooru" | "gelbooru">("safebooru");
  const [limit, setLimit] = useState(50);
  const [search, setSearch] = useState("");

  const { data: tags = [], isLoading, error } = useQuery({
    queryKey: ["booru-search", search, source, limit],
    queryFn: () => booruApi.search(search, source, limit),
    enabled: search.length > 0,
  });

  const handleSearch = () => {
    if (query.trim()) setSearch(query.trim());
  };

  return (
    <div className="p-6 space-y-5 max-w-4xl">
      <h2 className="text-xl font-semibold flex items-center gap-2"><Tag size={20} /> Booru Tag Browser</h2>

      {/* Search */}
      <div className="flex gap-3">
        <input
          className="input flex-1"
          placeholder="Search tags (e.g. 1girl, sword, long_hair...)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
        />
        <select className="input w-36" value={source} onChange={(e) => setSource(e.target.value as "safebooru" | "gelbooru")}>
          <option value="safebooru">Safebooru</option>
          <option value="gelbooru">Gelbooru</option>
        </select>
        <select className="input w-24" value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
          <option value={20}>20</option>
          <option value={50}>50</option>
          <option value={100}>100</option>
        </select>
        <button className="btn-primary flex items-center gap-2" onClick={handleSearch}>
          <Search size={14} /> Search
        </button>
      </div>

      {/* Results */}
      {isLoading && <p className="text-gray-500">Searching {source}...</p>}
      {error && <p className="text-red-400 text-sm">Search failed. Check your connection.</p>}
      {!isLoading && search && tags.length === 0 && (
        <p className="text-gray-500">No tags found for "{search}"</p>
      )}

      {tags.length > 0 && (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700/50 text-xs text-gray-500 uppercase">
                <th className="text-left p-3">Tag</th>
                <th className="text-left p-3">Category</th>
                <th className="text-right p-3">Posts</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {tags.map((tag) => (
                <tr key={tag.tag} className="border-b border-gray-700/30 hover:bg-surface-hover transition-colors">
                  <td className="p-3">
                    <span className={clsx("font-mono", CATEGORY_COLORS[tag.category] ?? "text-gray-300")}>
                      {tag.tag}
                    </span>
                  </td>
                  <td className="p-3">
                    <span className={CATEGORY_BADGES[tag.category] ?? "badge-gray"}>{tag.category}</span>
                  </td>
                  <td className="p-3 text-right text-gray-400 tabular-nums">
                    {tag.count.toLocaleString()}
                  </td>
                  <td className="p-3">
                    <button
                      className="btn-ghost btn-sm text-xs"
                      onClick={() => navigator.clipboard.writeText(tag.tag)}
                      title="Copy tag"
                    >
                      Copy
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-gray-600">
        Tags sourced from <span className="capitalize">{source}</span>. Results cached for 5 minutes.
      </p>
    </div>
  );
}
