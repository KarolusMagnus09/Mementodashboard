import { useEffect, useState } from "react";
import { supabase, type ProfileRow } from "../lib/supabase";

type RoleFilter = "all" | "customer" | "photographer" | "admin" | "banned";

export default function Profiles({ onOpenUser }: { onOpenUser: (id: string) => void }) {
  const [rows, setRows] = useState<ProfileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<RoleFilter>("all");
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const { data, error: err } = await supabase
      .from("profiles")
      .select("*")
      .order("created_at", { ascending: false });
    if (err) setError(err.message);
    else {
      setError(null);
      setRows((data as ProfileRow[]) || []);
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function ban(r: ProfileRow) {
    if (r.role === "admin") return;
    const reason = window.prompt(`Ban "${r.full_name || r.username || r.email}"?\nNhập lý do (có thể để trống):`);
    if (reason === null) return;
    setBusyId(r.id);
    const { error: err } = await supabase.rpc("admin_ban_user", { p_user_id: r.id, p_reason: reason.trim() || null });
    setBusyId(null);
    if (err) setError(err.message);
    else load();
  }

  async function unban(r: ProfileRow) {
    setBusyId(r.id);
    const { error: err } = await supabase.rpc("admin_unban_user", { p_user_id: r.id });
    setBusyId(null);
    if (err) setError(err.message);
    else load();
  }

  const filtered = rows.filter((r) => {
    if (filter === "banned" ? !r.banned_at : filter !== "all" && r.role !== filter) return false;
    const s = q.trim().toLowerCase();
    if (!s) return true;
    return (
      (r.full_name || "").toLowerCase().includes(s) ||
      (r.username || "").toLowerCase().includes(s) ||
      (r.email || "").toLowerCase().includes(s) ||
      (r.phone || "").includes(s) ||
      r.id.toLowerCase().includes(s)
    );
  });

  const count = (f: RoleFilter) =>
    f === "all" ? rows.length : f === "banned" ? rows.filter((r) => r.banned_at).length : rows.filter((r) => r.role === f).length;

  return (
    <>
      <div className="topbar">
        <h2>Danh sách người dùng ({rows.length})</h2>
        <button className="btn btn-ghost" onClick={load}>Làm mới</button>
      </div>

      <div className="tabs">
        {([["all", "Tất cả"], ["customer", "Khách"], ["photographer", "Photographer"], ["admin", "Admin"], ["banned", "Đã bị ban"]] as const).map(([id, label]) => (
          <button key={id} type="button" className={filter === id ? "active" : ""} onClick={() => setFilter(id)}>
            {label} ({count(id)})
          </button>
        ))}
      </div>

      <input
        className="search"
        placeholder="Tìm tên, username, email, SĐT, ID..."
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {error && <div className="card" style={{ color: "var(--danger)" }}>{error}</div>}
      {loading ? (
        <p className="muted">Đang tải...</p>
      ) : (
        <div className="card" style={{ padding: 0, overflow: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Tên</th>
                <th>Username</th>
                <th>Email</th>
                <th>SĐT</th>
                <th>Role</th>
                <th>Trạng thái</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="clickable" onClick={() => onOpenUser(r.id)}>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {r.avatar_url ? (
                        <img src={r.avatar_url} alt="" style={{ width: 28, height: 28, borderRadius: "50%", objectFit: "cover" }} />
                      ) : null}
                      {r.full_name || "—"}
                    </div>
                  </td>
                  <td>{r.username || "—"}</td>
                  <td className="muted">{r.email || "—"}</td>
                  <td>{r.phone || "—"}</td>
                  <td><span className="badge draft">{r.role}</span></td>
                  <td>
                    {r.banned_at
                      ? <span className="badge rejected" title={r.ban_reason || ""}>Đã bị ban</span>
                      : <span className="badge ok">Hoạt động</span>}
                  </td>
                  <td onClick={(e) => e.stopPropagation()} style={{ whiteSpace: "nowrap" }}>
                    <button className="btn btn-ghost" onClick={() => onOpenUser(r.id)}>Chi tiết</button>{" "}
                    {r.role !== "admin" && (r.banned_at ? (
                      <button className="btn btn-ok" disabled={busyId === r.id} onClick={() => unban(r)}>Gỡ ban</button>
                    ) : (
                      <button className="btn btn-danger" disabled={busyId === r.id} onClick={() => ban(r)}>Ban</button>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
