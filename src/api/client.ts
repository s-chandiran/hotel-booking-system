/**
 * Centralized HTTP client.
 * - Calls the same-origin BFF (src/server/bff): VITE_API_BASE_URL stays empty in normal use.
 * - Cookie sessions: the JWT lives in an HttpOnly cookie set by the BFF; no tokens in browser
 *   JavaScript or storage.
 * - State-changing requests carry the X-StayDesk-CSRF header the BFF requires.
 * - Failures are thrown as ApiError, never converted into success.
 */
export const API_BASE_URL = (import.meta.env["VITE_API_BASE_URL"] as string | undefined) ?? "";

export const CSRF_HEADER = "X-StayDesk-CSRF";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
    public code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ApiRequestOptions {
  /** Don't broadcast "session-expired" on 401 (login form, initial session probe). */
  silent401?: boolean;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function errorParts(body: unknown, status: number): { message: string; code?: string } {
  const b = body as { error?: { code?: unknown; message?: unknown }; message?: unknown } | null;
  const nested = b?.error;
  const message =
    (typeof nested?.message === "string" && nested.message) ||
    (typeof b?.message === "string" && b.message) ||
    `Request failed (${status})`;
  const code = typeof nested?.code === "string" ? nested.code : undefined;
  return code ? { message, code } : { message };
}

export async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
  options: ApiRequestOptions = {},
): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers: Record<string, string> = { Accept: "application/json" };
  if (init.body !== undefined && init.body !== null) headers["Content-Type"] = "application/json";
  if (!SAFE_METHODS.has(method)) headers[CSRF_HEADER] = "1";

  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    method,
    credentials: "same-origin",
    headers: { ...headers, ...((init.headers as Record<string, string> | undefined) ?? {}) },
  });
  const body =
    res.status === 204
      ? null
      : res.headers.get("content-type")?.includes("application/json")
        ? await res.json().catch(() => null)
        : null;

  if (res.status === 401) {
    if (!options.silent401 && typeof window !== "undefined")
      window.dispatchEvent(new Event("session-expired"));
    const { message, code } = errorParts(body, 401);
    throw new ApiError(401, message, body, code);
  }
  if (!res.ok) {
    const { message, code } = errorParts(body, res.status);
    throw new ApiError(res.status, message, body, code);
  }
  return body as T;
}
