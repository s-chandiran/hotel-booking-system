/**
 * Centralized HTTP client for the existing Express backend.
 * - Base URL from VITE_API_BASE_URL.
 * - Cookie sessions: credentials are always included; no tokens in browser storage.
 * - Failures are thrown as ApiError, never converted into success.
 */
export const API_BASE_URL = (import.meta.env["VITE_API_BASE_URL"] as string | undefined) ?? "";

/** Sample data is used until VITE_USE_MOCK is set to "false" and real API contracts are wired. */
export const USE_MOCK = (import.meta.env["VITE_USE_MOCK"] as string | undefined) !== "false";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  if (res.status === 401) {
    if (typeof window !== "undefined") window.dispatchEvent(new Event("session-expired"));
    throw new ApiError(401, "Your session has expired. Please sign in again.");
  }
  const body = res.headers.get("content-type")?.includes("application/json")
    ? await res.json().catch(() => null)
    : null;
  if (!res.ok) {
    throw new ApiError(res.status, body?.message ?? `Request failed (${res.status})`, body);
  }
  return body as T;
}
