import { queryOptions } from "@tanstack/react-query";
import { apiRequest } from "./client";

/** Public user fields returned by the BFF. The JWT itself never reaches the browser. */
export interface SessionUser {
  id: number;
  username: string;
  full_name: string | null;
  role: "front_desk" | "admin" | "super_admin" | string;
}

export const meQueryKey = ["auth", "me"] as const;

export const meQuery = () =>
  queryOptions({
    queryKey: meQueryKey,
    queryFn: ({ signal }) =>
      apiRequest<{ user: SessionUser }>("/bff/auth/me", { signal }, { silent401: true }).then(
        (r) => r.user,
      ),
    staleTime: 5 * 60_000,
    retry: false,
  });

export async function login(username: string, password: string): Promise<SessionUser> {
  const res = await apiRequest<{ user: SessionUser }>(
    "/bff/auth/login",
    { method: "POST", body: JSON.stringify({ username, password }) },
    { silent401: true },
  );
  return res.user;
}

export async function logout(): Promise<void> {
  await apiRequest<null>("/bff/auth/logout", { method: "POST" }, { silent401: true });
}

const ROLE_LABELS: Record<string, string> = {
  front_desk: "Front Desk",
  admin: "Admin",
  super_admin: "Super Admin",
};

export function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role;
}

export function initials(name: string | null | undefined, fallback: string): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  const letters =
    parts.length >= 2
      ? `${parts[0]![0]}${parts.at(-1)![0]}`
      : (parts[0]?.slice(0, 2) ?? fallback.slice(0, 2));
  return letters.toUpperCase();
}
