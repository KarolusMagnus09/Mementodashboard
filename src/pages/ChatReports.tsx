import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

type TranscriptMsg = { id: string; sender_id: string; role: "client" | "photographer"; body: string; created_at: string };
type BookingCtx = { id: string; package_name: string; package_price: number; status: string; booking_date: string };

export type ChatReport = {
  id: string;
  conversation_id: string | null;
  reporter_id: string;
  reported_user_id: string;
  description: string;
  transcript: TranscriptMsg[];
  context: { client_id?: string; ptg_user_id?: string; bookings?: BookingCtx[] };
  status: "open" | "reviewed" | "dismissed";
  admin_note: string | null;
  created_at: string;
};

type Who = { id: string; full_name: string | null; username: string | null; email: string | null; role?: string; banned_at?: string | null };

const FILTERS = [
  { id: "open", label: "Chờ xử lý" },
  { id: "reviewed", label: "Đã xử lý" },
  { id: "dismissed", label: "Bỏ qua" },
  { id: "all", label: "Tất cả" },
] as const;

const fmt = (s?: string | null) => (s ? new Date(s).toLocaleString("vi-VN") : "—");
const money = (n: number) => `${Number(n || 0).toLocaleString("vi-VN")}đ`;

/** Bubble hội thoại từ transcript (ảnh chụp tại thời điểm báo cáo). Dùng chung với trang chi tiết tài khoản. */
export function Transcript({ list, reporterId, nameOf }: { list: TranscriptMsg[]; reporterId: string; nameOf: (id: string) => string }) {
  if (!list?.length) return <p className="muted">Hội thoại trống.</p>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 420, overflowY: "auto", padding: 8, background: "#f8fafc", borderRadius: 10 }}>
      {list.map((m) => {
        const mine = m.sender_id === reporterId;
        return (
          <div key={m.id} style={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "78%" }}>
            <div style={{
              background: mine ? "#d1fae5" : "#fff", border: "1px solid var(--border)", borderRadius: 12,
              padding: "8px 12px", fontSize: 13, whiteSpace: "pre-wrap", overflowWrap: "anywhere",
            }}>{m.body}</div>
            <div className="muted" style={{ fontSize: 10, textAlign: mine ? "right" : "left" }}>
              {nameOf(m.sender_id)} ({m.role === "client" ? "khách" : "PTG"}) · {fmt(m.created_at)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function ChatReports({ onOpenUser }: { onOpenUser: (id: string) => void }) {
  const [rows, setRows] = useState<ChatReport[]>([]);
  const [who, setWho] = useState<Record<string, Who>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("open");
  const [q, setQ] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [openId, setOpenId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
      .from("message_reports")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }
    const list = (data as ChatReport[]) || [];
    setRows(list);
    const ids = Array.from(new Set(list.flatMap((r) => [r.reporter_id, r.reported_user_id])));
    if (ids.length) {
      const { data: ps } = await supabase
        .from("profiles")
        .select("id, full_name, username, email, role, banned_at")
        .in("id", ids);
      const map: Record<string, Who> = {};
      for (const p of (ps as Who[]) || []) map[p.id] = p;
      setWho(map);
    }
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const name = (id: string) => {
    const w = who[id];
    return w?.full_name || w?.username || w?.email || id.slice(0, 8);
  };

  async function setStatus(r: ChatReport, status: ChatReport["status"]) {
    const { error: err } = await supabase.rpc("admin_update_message_report", {
      p_report_id: r.id,
      p_status: status,
      p_note: notes[r.id]?.trim() || r.admin_note,
    });
    if (err) setError(err.message);
    else load();
  }

  async function banReported(r: ChatReport) {
    if (!window.confirm(`Ban tài khoản "${name(r.reported_user_id)}"? Họ sẽ bị đăng xuất và không đăng nhập lại được.`)) return;
    const { error: err } = await supabase.rpc("admin_ban_user", {
      p_user_id: r.reported_user_id,
      p_reason: `Report hội thoại: ${r.description.slice(0, 120)}`,
    });
    if (err) return setError(err.message);
    await setStatus(r, "reviewed");
  }

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter !== "all" && r.status !== filter) return false;
      if (!s) return true;
      return [r.description, name(r.reporter_id), name(r.reported_user_id), who[r.reported_user_id]?.email, who[r.reporter_id]?.email]
        .join(" ").toLowerCase().includes(s);
    });
  }, [rows, filter, q, who]);

  return (
    <>
      <div className="topbar">
        <h2>Report hội thoại chat</h2>
        <button className="btn btn-ghost" onClick={load}>Làm mới</button>
      </div>
      <div className="card" style={{ fontSize: 13 }}>
        Admin chỉ xem được nội dung chat khi có người báo cáo. Transcript là ảnh chụp toàn bộ hội thoại tại thời điểm báo cáo.
      </div>

      <div className="tabs">
        {FILTERS.map((f) => (
          <button key={f.id} type="button" className={filter === f.id ? "active" : ""} onClick={() => setFilter(f.id)}>
            {f.label} ({f.id === "all" ? rows.length : rows.filter((r) => r.status === f.id).length})
          </button>
        ))}
      </div>
      <input className="search" placeholder="Tìm theo tên, email, mô tả…" value={q} onChange={(e) => setQ(e.target.value)} />

      {error && (
        <div className="card" style={{ borderColor: "#fecaca", color: "#b91c1c" }}>
          Lỗi: {error}
          <p className="muted">Cần chạy <code>sql/032_chat_realtime.sql</code> trong Supabase.</p>
        </div>
      )}

      {loading ? <p className="muted">Đang tải…</p> : filtered.length === 0 ? (
        <div className="card">Không có báo cáo nào.</div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {filtered.map((r) => {
            const target = who[r.reported_user_id];
            const open = openId === r.id;
            return (
              <div className="card" key={r.id}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div>
                    <a href="#" onClick={(e) => { e.preventDefault(); onOpenUser(r.reported_user_id); }}><strong>{name(r.reported_user_id)}</strong></a>
                    {target?.banned_at && <span className="badge rejected" style={{ marginLeft: 6 }}>Đã bị ban</span>}
                    {target?.role === "admin" && <span className="badge draft" style={{ marginLeft: 6 }}>admin</span>}
                    <span className="muted"> bị báo cáo bởi </span>
                    <a href="#" onClick={(e) => { e.preventDefault(); onOpenUser(r.reporter_id); }}><strong>{name(r.reporter_id)}</strong></a>
                    <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{fmt(r.created_at)} · {r.transcript?.length || 0} tin nhắn</div>
                  </div>
                  <span className={`badge ${r.status === "open" ? "warn" : r.status === "reviewed" ? "ok" : "draft"}`}>
                    {r.status === "open" ? "Chờ xử lý" : r.status === "reviewed" ? "Đã xử lý" : "Bỏ qua"}
                  </span>
                </div>

                <p style={{ marginTop: 10, fontSize: 13, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                  <strong>Mô tả của người báo cáo:</strong> {r.description}
                </p>

                {r.context?.bookings && r.context.bookings.length > 0 && (
                  <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                    Đơn giữa 2 bên: {r.context.bookings.map((b) => `${b.package_name} (${money(b.package_price)}, ${b.status})`).join(" · ")}
                  </div>
                )}

                <button className="btn btn-ghost" style={{ marginTop: 10 }} onClick={() => setOpenId(open ? null : r.id)}>
                  {open ? "Ẩn hội thoại" : "Xem hội thoại"}
                </button>
                {open && <div style={{ marginTop: 10 }}><Transcript list={r.transcript} reporterId={r.reporter_id} nameOf={name} /></div>}

                <input
                  className="search"
                  style={{ marginTop: 10 }}
                  placeholder="Ghi chú admin (tuỳ chọn)"
                  defaultValue={r.admin_note || ""}
                  onChange={(e) => setNotes((p) => ({ ...p, [r.id]: e.target.value }))}
                />
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button className="btn btn-primary" onClick={() => onOpenUser(r.reported_user_id)}>Xem tài khoản bị báo cáo</button>
                  <button className="btn btn-ok" onClick={() => setStatus(r, "reviewed")}>Đánh dấu đã xử lý</button>
                  <button className="btn btn-ghost" onClick={() => setStatus(r, "dismissed")}>Bỏ qua</button>
                  {target?.role !== "admin" && !target?.banned_at && (
                    <button className="btn btn-danger" onClick={() => banReported(r)}>Ban người bị báo cáo</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
