import { useQuery } from "@tanstack/react-query";
import client from "../api/client";

interface GpuStats {
  name: string | null;
  used_mb: number;
  total_mb: number;
  utilization_pct: number | null;
}

export function useGpuStats() {
  const { data } = useQuery<GpuStats>({
    queryKey: ["gpu-stats"],
    queryFn: () => client.get<GpuStats>("/system/gpu").then((r) => r.data),
    refetchInterval: 5000,
    staleTime: 4000,
    retry: false,
  });
  return data?.name ? data : null;
}
