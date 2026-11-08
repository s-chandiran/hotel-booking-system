import { queryOptions } from "@tanstack/react-query";
import { apiRequest, USE_MOCK } from "./client";
import { endpoints } from "./endpoints";
import type { DashboardData } from "@/types/dashboard";

async function fetchDashboard(signal?: AbortSignal): Promise<DashboardData> {
  if (USE_MOCK) {
    const { dashboardMock } = await import("./mock/dashboard.mock");
    await new Promise((r) => setTimeout(r, 300));
    return dashboardMock;
  }
  return apiRequest<DashboardData>(endpoints.dashboard, { signal: signal ?? null });
}

export const dashboardQuery = () =>
  queryOptions({
    queryKey: ["dashboard"],
    queryFn: ({ signal }) => fetchDashboard(signal),
    staleTime: 30_000,
  });
