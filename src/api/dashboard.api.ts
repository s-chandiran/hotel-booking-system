import { queryOptions } from "@tanstack/react-query";
import { apiRequest } from "./client";
import { endpoints } from "./endpoints";
import type { DashboardData } from "@/types/dashboard";

async function fetchDashboard(signal?: AbortSignal): Promise<DashboardData> {
  return apiRequest<DashboardData>(endpoints.dashboard, { signal: signal ?? null });
}

export const dashboardQuery = () =>
  queryOptions({
    queryKey: ["dashboard"],
    queryFn: ({ signal }) => fetchDashboard(signal),
    staleTime: 30_000,
  });
