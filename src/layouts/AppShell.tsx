import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Bell, ChevronLeft, ChevronRight, Hotel, LogOut, Menu, Search, X } from "lucide-react";
import { navGroups, allNavItems } from "./nav";
import { initials, logout, meQuery, roleLabel } from "@/api/auth.api";
import { cn } from "@/lib/utils";

function SidebarNav({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  return (
    <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-4" aria-label="Main">
      {navGroups.map((g) => (
        <div key={g.label}>
          {!collapsed && (
            <p className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/50">
              {g.label}
            </p>
          )}
          <ul className="space-y-1">
            {g.items.map(({ to, label, icon: Icon }) => (
              <li key={to}>
                <Link
                  to={to}
                  onClick={onNavigate}
                  activeOptions={{ exact: to === "/" }}
                  title={collapsed ? label : undefined}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                    collapsed && "justify-center px-0",
                  )}
                  activeProps={{ className: "!bg-sidebar-primary !text-sidebar-primary-foreground" }}
                >
                  <Icon className="size-[18px] shrink-0" />
                  {!collapsed && <span className="truncate">{label}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function Brand({ collapsed }: { collapsed: boolean }) {
  return (
    <div className={cn("flex h-16 items-center gap-3 border-b border-sidebar-border px-5", collapsed && "justify-center px-0")}>
      <div className="grid size-9 place-items-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
        <Hotel className="size-5" />
      </div>
      {!collapsed && (
        <div className="leading-tight">
          <p className="text-sm font-bold text-sidebar-accent-foreground">StayDesk</p>
          <p className="text-xs text-sidebar-foreground/60">Hotel management</p>
        </div>
      )}
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const current = allNavItems.find((i) => (i.to === "/" ? pathname === "/" : pathname.startsWith(i.to)));
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data: user } = useQuery(meQuery());
  const [signingOut, setSigningOut] = useState(false);
  const displayName = user ? (user.full_name ?? user.username) : "Front Desk";
  const displayRole = user ? roleLabel(user.role) : "Front Desk";

  async function onLogout() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await logout();
    } catch {
      // The cookie is HttpOnly; if the BFF call failed we still drop local state below.
    } finally {
      queryClient.clear();
      setSigningOut(false);
      await navigate({ to: "/login" });
    }
  }

  return (
    <div className="flex min-h-screen bg-background">
      {/* Desktop / tablet sidebar */}
      <aside
        className={cn(
          "sticky top-0 hidden h-screen shrink-0 flex-col bg-sidebar transition-[width] md:flex",
          collapsed ? "w-[72px]" : "w-64",
        )}
      >
        <Brand collapsed={collapsed} />
        <SidebarNav collapsed={collapsed} />
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="m-3 flex items-center justify-center gap-2 rounded-lg py-2 text-xs text-sidebar-foreground hover:bg-sidebar-accent"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronRight className="size-4" /> : <><ChevronLeft className="size-4" /> Collapse</>}
        </button>
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-foreground/40" onClick={() => setMobileOpen(false)} />
          <aside className="relative flex h-full w-72 flex-col bg-sidebar">
            <button onClick={() => setMobileOpen(false)} className="absolute right-3 top-4 text-sidebar-foreground" aria-label="Close menu">
              <X className="size-5" />
            </button>
            <Brand collapsed={false} />
            <SidebarNav collapsed={false} onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex h-16 items-center gap-3 border-b border-border bg-card/90 px-4 backdrop-blur md:px-6">
          <button className="md:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Menu className="size-5" />
          </button>
          <div className="min-w-0">
            <p className="truncate text-xs text-muted-foreground">StayDesk / {current?.label ?? "Page"}</p>
            <h1 className="truncate text-base font-semibold md:text-lg">{current?.label ?? "StayDesk"}</h1>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <label className="hidden items-center gap-2 rounded-lg border border-input bg-background px-3 py-2 text-sm text-muted-foreground lg:flex">
              <Search className="size-4" />
              <input placeholder="Search bookings, guests…" className="w-56 bg-transparent outline-none placeholder:text-muted-foreground" />
            </label>
            <button className="relative rounded-lg p-2 hover:bg-muted" aria-label="Notifications">
              <Bell className="size-5" />
              <span className="absolute right-2 top-2 size-2 rounded-full bg-primary" />
            </button>
            <div className="flex items-center gap-2 rounded-lg py-1 pl-1 pr-2">
              <div className="grid size-8 place-items-center rounded-full bg-accent text-xs font-bold text-accent-foreground">
                {user ? initials(user.full_name, user.username) : "FD"}
              </div>
              <span className="hidden text-sm font-medium sm:block" title={displayRole}>{displayName}</span>
            </div>
            <button
              onClick={onLogout}
              disabled={signingOut}
              className="rounded-lg p-2 text-muted-foreground hover:bg-muted disabled:opacity-50"
              aria-label="Log out"
              title="Log out"
            >
              <LogOut className="size-5" />
            </button>
          </div>
        </header>
        <main className="flex-1 p-4 md:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
