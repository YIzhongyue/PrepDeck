import { useEffect, useState } from "react";
import type { AdminUsersListResponse, InviteUserResponse, Role, UpdateUserResponse, User, UserStatus } from "@prepdeck/shared";
import { AdminIcon, AdminModal } from "../../components/AdminModal";
import { apiFetch, ApiError } from "../../lib/api";
import { DANGER, initials } from "./shared";

const STATUS_COLOR: Record<UserStatus, string> = { active: "var(--color-accent-2)", invited: "var(--color-accent-600)", revoked: "var(--color-neutral-500)" };

// FR-1.2/FR-1.4 — Authorized Users: invite, change role, revoke/restore.
export function UsersPanel({ myId, onCount }: { myId: string; onCount: (n: number) => void }) {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("user");
  const [password, setPassword] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | UserStatus>("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);

  useEffect(() => {
    apiFetch<AdminUsersListResponse>("/api/admin/users")
      .then(({ users }) => setUsers(users))
      .catch(() => setLoadError("Could not load the Authorized Users list."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { onCount(users.length); }, [users.length, onCount]);

  const invite = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    setInviteBusy(true);
    setInviteError(null);
    apiFetch<InviteUserResponse>("/api/admin/users", {
      method: "POST",
      body: JSON.stringify({ email: trimmed, role, password: password.trim() || undefined })
    })
      .then(({ user }) => {
        setUsers((prev) => prev.concat(user));
        setEmail("");
        setPassword("");
        setRole("user");
        setInviteOpen(false);
      })
      .catch((err) => setInviteError(err instanceof ApiError ? err.message : "Could not invite this account."))
      .finally(() => setInviteBusy(false));
  };

  const updateUser = (id: string, patch: { role?: Role; status?: "active" | "revoked"; googleSub?: null }) => {
    return apiFetch<UpdateUserResponse>(`/api/admin/users/${id}`, { method: "PATCH", body: JSON.stringify(patch) })
      .then(({ user }) => {
        setUsers((prev) => prev.map((u) => (u.id === id ? user : u)));
        return user;
      });
  };

  const revoke = (u: User) => {
    if (!window.confirm(`Revoke access for ${u.email}? Historical data is kept; this can be undone with Restore.`)) return;
    updateUser(u.id, { status: "revoked" }).catch((err) => window.alert(err instanceof ApiError ? err.message : "Could not update this account."));
  };

  // FR-1.9: an account answers to the Google account that first signed into it,
  // not to its address, so a person whose Google account was replaced (a
  // Workspace migration onto a custom domain, say) is turned away rather than
  // silently adopting the existing data. Clearing the link lets the next
  // successful sign-in on this address claim the account — which is also
  // exactly why it is a deliberate Admin act with a warning, not automatic.
  const resetGoogleLink = (u: User) => {
    if (!window.confirm(`Reset the Google link for ${u.email}? The next Google account that signs in with this address takes over this account and all of its data. Only do this if you know the account changed hands legitimately.`)) return;
    updateUser(u.id, { googleSub: null }).catch((err) => window.alert(err instanceof ApiError ? err.message : "Could not update this account."));
  };

  const editableSelectedIds = selected.filter((id) => id !== myId);

  const bulkApply = (patch: { role?: Role; status?: "active" | "revoked" }) => {
    if (editableSelectedIds.length === 0) return;
    setBulkBusy(true);
    Promise.all(editableSelectedIds.map((id) => updateUser(id, patch)))
      .then(() => setSelected([]))
      .catch((err) => window.alert(err instanceof ApiError ? err.message : "Could not update the selected accounts."))
      .finally(() => setBulkBusy(false));
  };

  const bulkRevoke = () => {
    if (editableSelectedIds.length === 0) return;
    if (!window.confirm(`Revoke access for ${editableSelectedIds.length} account${editableSelectedIds.length === 1 ? "" : "s"}? This can be undone with Restore.`)) return;
    bulkApply({ status: "revoked" });
  };

  const counts: Record<"all" | UserStatus, number> = {
    all: users.length,
    active: users.filter((u) => u.status === "active").length,
    invited: users.filter((u) => u.status === "invited").length,
    revoked: users.filter((u) => u.status === "revoked").length
  };

  const byStatus = users.filter((u) => statusFilter === "all" || u.status === statusFilter);
  const visibleUsers = byStatus.filter((user) => user.email.toLowerCase().includes(search.trim().toLowerCase()));
  const allVisibleSelected = visibleUsers.length > 0 && visibleUsers.every((u) => selected.includes(u.id));

  const toggleAll = () => {
    setSelected((prev) => (
      allVisibleSelected
        ? prev.filter((id) => !visibleUsers.some((u) => u.id === id))
        : Array.from(new Set(prev.concat(visibleUsers.map((u) => u.id))))
    ));
  };
  const toggleOne = (id: string) => setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : prev.concat(id)));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div className="admin-toolbar">
        <label className="admin-search">
          <AdminIcon name="search" />
          <span className="sr-only">Search people</span>
          <input placeholder="Search people…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <div className="admin-filter-group">
          {(["all", "active", "invited", "revoked"] as const).map((id) => (
            <button
              key={id}
              type="button"
              className={statusFilter === id ? "admin-filter-pill is-active" : "admin-filter-pill"}
              onClick={() => { setStatusFilter(id); setSelected([]); }}
            >
              {id === "all" ? "All" : id.charAt(0).toUpperCase() + id.slice(1)} <span className="admin-filter-count">{counts[id]}</span>
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-primary" style={{ marginLeft: "auto" }} onClick={() => setInviteOpen(true)}>
          <AdminIcon name="plus" /> Invite people
        </button>
      </div>

      {selected.length > 0 && (
        <div className="admin-bulk-bar">
          <strong>{selected.length} selected</strong>
          <span className="admin-bulk-divider" />
          <button type="button" className="btn btn-secondary" disabled={bulkBusy || editableSelectedIds.length === 0} onClick={() => bulkApply({ role: "admin" })}>Make admin</button>
          <button type="button" className="btn btn-secondary" disabled={bulkBusy || editableSelectedIds.length === 0} onClick={() => bulkApply({ role: "user" })}>Make user</button>
          <button type="button" className="btn btn-secondary" style={{ color: DANGER }} disabled={bulkBusy || editableSelectedIds.length === 0} onClick={bulkRevoke}>Revoke access</button>
          <button type="button" className="admin-bulk-clear" onClick={() => setSelected([])}>Clear</button>
        </div>
      )}

      <div className="card elev-sm" style={{ padding: 0, overflow: "hidden" }}>
        {loadError && <p style={{ margin: 0, padding: 20, fontSize: 13, color: DANGER }}>{loadError}</p>}
        {loading && !loadError && <p style={{ margin: 0, padding: 20, fontSize: 13, opacity: 0.7 }}>Loading…</p>}
        {!loading && !loadError && (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5, minWidth: 800 }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "1px solid var(--color-divider)" }}>
                  <th style={{ padding: "11px 18px", width: 44 }}><input type="checkbox" checked={allVisibleSelected} onChange={toggleAll} style={{ width: 15, height: 15, accentColor: "var(--color-accent)", cursor: "pointer" }} /></th>
                  <th style={{ padding: "11px 18px" }}>Person</th>
                  <th style={{ padding: "11px 18px" }}>Role</th>
                  <th style={{ padding: "11px 18px" }}>Status</th>
                  <th style={{ padding: "11px 18px" }}>Last sign-in</th>
                  <th style={{ padding: "11px 18px" }} />
                </tr>
              </thead>
              <tbody>
                {visibleUsers.map((u) => {
                  const isMe = u.id === myId;
                  const displayName = u.displayName || u.email.split("@")[0] || u.email;
                  return (
                    <tr key={u.id} style={{ borderBottom: "1px solid var(--color-divider)", background: selected.includes(u.id) ? "var(--color-accent-100)" : "transparent" }}>
                      <td style={{ padding: "14px 18px" }}>
                        <input type="checkbox" checked={selected.includes(u.id)} onChange={() => toggleOne(u.id)} style={{ width: 15, height: 15, accentColor: "var(--color-accent)", cursor: "pointer" }} />
                      </td>
                      <td style={{ padding: "14px 18px" }}>
                        <span style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                          <span className="admin-avatar">{initials(displayName)}</span>
                          <span style={{ minWidth: 0 }}>
                            <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
                              <span style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{displayName}</span>
                              {isMe && <span className="tag tag-neutral" style={{ fontSize: 10 }}>you</span>}
                            </span>
                            <span style={{ display: "block", fontSize: 11.5, color: "var(--color-text-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{u.email}</span>
                          </span>
                        </span>
                      </td>
                      <td style={{ padding: "14px 18px" }}>
                        <select
                          className="admin-role-select"
                          value={u.role}
                          disabled={isMe}
                          onChange={(e) => updateUser(u.id, { role: e.target.value as Role }).catch((err) => window.alert(err instanceof ApiError ? err.message : "Could not update this account."))}
                        >
                          <option value="user">User</option>
                          <option value="admin">Admin</option>
                        </select>
                      </td>
                      <td style={{ padding: "14px 18px" }}>
                        <span style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, textTransform: "capitalize" }}>
                          <span className="admin-status-dot" style={{ color: STATUS_COLOR[u.status] }} />{u.status}
                        </span>
                      </td>
                      <td style={{ padding: "14px 18px", fontSize: 12.5, color: "var(--color-text-muted)" }}>{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : "—"}</td>
                      <td style={{ padding: "14px 18px", textAlign: "right" }}>
                        {!isMe && (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, justifyContent: "flex-end" }}>
                            {u.googleSub && (
                              <button type="button" className="btn btn-ghost" style={{ padding: "7px 12px", fontSize: 12.5 }} title="Unlink the Google account this row answers to, so the next sign-in with this address claims it" onClick={() => resetGoogleLink(u)}>Reset link</button>
                            )}
                            {u.status === "revoked" ? (
                              <button type="button" className="btn btn-secondary" style={{ padding: "7px 14px", fontSize: 12.5 }} onClick={() => updateUser(u.id, { status: "active" }).catch((err) => window.alert(err instanceof ApiError ? err.message : "Could not update this account."))}>Restore</button>
                            ) : (
                              <button type="button" className="btn btn-ghost" style={{ padding: "7px 12px", fontSize: 12.5, color: DANGER }} onClick={() => revoke(u)}>Revoke</button>
                            )}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {visibleUsers.length === 0 && <tr><td colSpan={6} className="admin-empty">No users match “{search || (statusFilter === "all" ? "" : statusFilter)}”.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p style={{ margin: "2px 2px 0", fontSize: 11.5, color: "var(--color-text-muted)" }}>
        Invited accounts activate on their first Google sign-in. Revoking keeps all historical data and can be undone.
      </p>

      {inviteOpen && (
        <AdminModal icon="users" title="Invite an account" subtitle="Access starts on their first Google sign-in." onClose={() => setInviteOpen(false)}>
          <form onSubmit={invite} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div className="admin-modal-fields">
              <div className="field" style={{ flex: "1 1 100%" }}>
                <label>Google email</label>
                <input className="input" type="email" placeholder="name@company.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
              <div className="field" style={{ flex: "1 1 140px" }}>
                <label>Role</label>
                <select className="input" value={role} onChange={(e) => setRole(e.target.value as Role)}>
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div className="field" style={{ flex: "1 1 220px" }}>
                <label>Temporary password</label>
                <input className="input" type="text" placeholder="optional — dev / local only" value={password} onChange={(e) => setPassword(e.target.value)} />
                <p className="admin-modal-hint">Only used while this deployment signs in with email + password.</p>
              </div>
            </div>
            {inviteError && <p style={{ margin: 0, fontSize: 12, color: DANGER }}>{inviteError}</p>}
            <div className="admin-modal-foot">
              <p>Created with status “invited”.</p>
              <button type="button" className="btn btn-secondary" onClick={() => setInviteOpen(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={inviteBusy || !email.trim()}>{inviteBusy ? "Inviting…" : "Send invite"}</button>
            </div>
          </form>
        </AdminModal>
      )}
    </div>
  );
}
