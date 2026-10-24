import { useEffect, useMemo, useState } from "react";
import { supabase, type Application, type AppStatus } from "../lib/supabase";

const FILTERS: { id: AppStatus | "all"; label: string }[] = [
  { id: "all", label: "Tất cả" },
  { id: "submitted", label: "Chờ duyệt" },
  { id: "approved", label: "Đã duyệt" },
  { id: "rejected", label: "Từ chối" },
  { id: "draft", label: "Nháp" },
];

export default function Applications({ onOpen }: { onOpen: (userId: string) => void }) {
  const [rows, setRows] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<AppStatus | "all">("submitted");
  const [q, setQ] = useState("");

  async function load() {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
      .from("photographer_applications")
      .select("*")
      .order("submitted_at", { ascending: false, nullsFirst: false });
    if (err) setError(err.message);
    else setRows((data as Application[]) || []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length };
    for (const r of rows) c[r.status] = (c[r.status] || 0) + 1;
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    let list = rows;
    if (filter !== "all") list = list.filter((r) => r.status === filter);
    const s = q.trim().toLowerCase();
    if (s) {
      list = list.filter(
        (r) =>
          (r.full_name || "").toLowerCase().includes(s) ||
          (r.phone || "").includes(s) ||
          r.user_id.toLowerCase().includes(s)
      );
    }
    return list;
  }, [rows, filter, q]);

  return (
    <>
      <div className="topbar">
        <h2>Hồ sơ nhiếp ảnh gia</h2>
        <button className="btn btn-ghost" onClick={load}>Làm mới</button>
      </div>

      <div className="grid grid-3" style={{ marginBottom: 16 }}>
        <div className="stat">
          <div className="n">{counts.submitted || 0}</div>
          <div className="l">Chờ duyệt</div>
        </div>
        <div className="stat">
          <div className="n">{counts.approved || 0}</div>
          <div className="l">Đã duyệt</div>
        </div>
        <div className="stat">
          <div className="n">{counts.rejected || 0}</div>
          <div className="l">Từ chối</div>
        </div>
      </div>

      <div className="tabs">
        {FILTERS.map((f) => (
          <button key={f.id} className={filter === f.id ? "active" : ""}
            onClick={() => setFilter(f.id)}>
            {f.label} ({counts[f.id] || 0})
          </button>
        ))}
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <input
          style={{ width: "100%", padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 10 }}
          placeholder="Tìm theo tên, SĐT, user_id..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {error && <div className="card" style={{ color: "var(--danger)" }}>{error}</div>}
      {loading ? (
        <p className="muted">Đang tải...</p>
      ) : filtered.length === 0 ? (
        <div className="card muted">Không có hồ sơ nào.</div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Họ tên</th>
                <th>SĐT</th>
                <th>Trạng thái</th>
                <th>Gửi lúc</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.user_id} className="clickable" onClick={() => onOpen(r.user_id)}>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      {r.avatar_url ? (
                        <img src={r.avatar_url} alt="" style={{ width: 36, height: 36, borderRadius: "50%", objectFit: "cover" }} />
                      ) : (
                        <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#e5e7eb" }} />
                      )}
                      <strong>{r.full_name || "—"}</strong>
                    </div>
                  </td>
                  <td>{r.phone || "—"}</td>
                  <td><span className={`badge ${r.status}`}>{labelStatus(r.status)}</span></td>
                  <td className="muted">{r.submitted_at ? new Date(r.submitted_at).toLocaleString("vi-VN") : "—"}</td>
                  <td><button className="btn btn-ghost" onClick={(e) => { e.stopPropagation(); onOpen(r.user_id); }}>Xem</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function labelStatus(s: string) {
  if (s === "submitted") return "Chờ duyệt";
  if (s === "approved") return "Đã duyệt";
  if (s === "rejected") return "Từ chối";
  if (s === "draft") return "Nháp";
  return s;
}
