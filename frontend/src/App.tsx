import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "react-hot-toast";

import Sidebar from "./components/layout/Sidebar";
import TopBar from "./components/layout/TopBar";
import DatasetsPage from "./pages/DatasetsPage";
import GalleryPage from "./pages/GalleryPage";
import ImageDetailPage from "./pages/ImageDetailPage";
import CaptioningPage from "./pages/CaptioningPage";
import QualityPage from "./pages/QualityPage";
import StatsPage from "./pages/StatsPage";
import ExportPage from "./pages/ExportPage";
import BooruPage from "./pages/BooruPage";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <div className="flex h-screen overflow-hidden">
          <Sidebar />
          <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
            <TopBar />
            <main className="flex-1 overflow-y-auto">
              <Routes>
                <Route path="/" element={<Navigate to="/datasets" replace />} />
                <Route path="/datasets" element={<DatasetsPage />} />
                <Route path="/booru" element={<BooruPage />} />
                <Route path="/datasets/:datasetId/gallery" element={<GalleryPage />} />
                <Route path="/datasets/:datasetId/image/:imageId" element={<ImageDetailPage />} />
                <Route path="/datasets/:datasetId/captioning" element={<CaptioningPage />} />
                <Route path="/datasets/:datasetId/quality" element={<QualityPage />} />
                <Route path="/datasets/:datasetId/stats" element={<StatsPage />} />
                <Route path="/datasets/:datasetId/export" element={<ExportPage />} />
              </Routes>
            </main>
          </div>
        </div>
        <Toaster
          position="bottom-right"
          toastOptions={{
            style: { background: "#16213e", color: "#f3f4f6", border: "1px solid #374151" },
          }}
        />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
