import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import ChatReports from "./ChatReports";

type Report = {
  id: string;
  reporter_id: string;
  reported_user_id: string;
  reported_name: string | null;
  booking_id: string | null;
  reason: string;
  description: string;
  report_type?: "profile" | "price";
  subject?: "profile" | "photo" | "review";
  photo_url?: string | null;
  review_id?: string | null;
  status: "open" | "reviewed" | "dismissed";
  admin_note: string | null;
  created_at: string;
};

type ReviewInfo = { id: string; comment: string; rating: number; hidden: boolean };

type Who = { id: string; full_name: string | null; username: string | null; email: string | null; role?: string; banned_at?: string | null };

const FILTERS = [
  { id: "open", label: "Chờ xử lý" },
  { id: "reviewed", label: "Đã xử lý" },
  { id: "dismissed", label: "Bỏ qua" },
  { id: "all", label: "Tất cả" },
] as const;

function ProfileReports({ onOpenUser }: { onOpenUser: (id: string) => void }) {
  const [rows, setRows] = useState<Report[]>([]);
  const [who, setWho] = useState<Record<string, Who>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("open");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [reviews, setReviews] = useState<Record<string, ReviewInfo>>({});
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "profile" | "photo" | "review" | "price">("all");

  async function load() {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
      .from("profile_reports")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }
    const list = (data as Report[]) || [];
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
    const reviewIds = Array.from(new Set(list.map((r) => r.review_id).filter(Boolean) as string[]));
    if (reviewIds.length) {
      const { data: rv } = await supabase
        .from("photographer_reviews")
        .select("id, comment, rating, hidden")
        .in("id", reviewIds);
      const rmap: Record<string, ReviewInfo> = {};
      for (const x of (rv as ReviewInfo[]) || []) rmap[x.id] = x;
      setReviews(rmap);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function setReviewHidden(r: Report, hidden: boolean) {
    if (!r.review_id) return;
    const { error: err } = await supabase.rpc("admin_set_review_hidden", {
      p_review_id: r.review_id,
      p_hidden: hidden,
      p_reason: hidden ? r.reason : null,
    });
    if (err) setError(err.message);
    else load();
  }

  async function setStatus(r: Report, status: Report["status"]) {
    const { error: err } = await supabase
      .from("profile_reports")
      .update({
        status,
        admin_note: notes[r.id]?.trim() || r.admin_note,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", r.id);
    if (err) setError(err.message);
    else load();
  }

  const kindOf = (r: Report) => (r.report_type === "price" ? "price" : r.subject || "profile");

  // Số report đã nhận của từng người bị báo cáo (mọi trạng thái) — để nhìn ra người bị báo cáo nhiều lần
  const countAgainst = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of rows) m[r.reported_user_id] = (m[r.reported_user_id] || 0) + 1;
    return m;
  }, [rows]);

  async function banUser(r: Report) {
    const target = who[r.reported_user_id];
    if (target?.role === "admin") return;
    const label = name(r.reported_user_id, r.reported_name);
    if (!window.confirm(`Ban tài khoản "${label}"? Họ sẽ bị đăng xuất và không đăng nhập lại được.`)) return;
    const { error: err } = await supabase.rpc("admin_ban_user", {
      p_user_id: r.reported_user_id,
      p_reason: `Report: ${r.reason}`,
    });
    if (err) return setError(err.message);
    await setStatus(r, "reviewed");
  }

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter !== "all" && r.status !== filter) return false;
      if (typeFilter !== "all" && kindOf(r) !== typeFilter) return false;
      if (!s) return true;
      const hay = [
        r.reason, r.description, r.reported_name,
        who[r.reporter_id]?.full_name, who[r.reporter_id]?.email, who[r.reporter_id]?.username,
        who[r.reported_user_id]?.full_name, who[r.reported_user_id]?.email, who[r.reported_user_id]?.username,
      ].join(" ").toLowerCase();
      return hay.includes(s);
    });
  }, [rows, filter, typeFilter, q, who]);

  const name = (id: string, fallback?: string | null) => {
    const w = who[id];
    return w?.full_name || w?.username || w?.email || fallback || id.slice(0, 8);
  };

  return (
    <>
      <div className="topbar">
        <h2>Report profile / ảnh / bình luận / giá</h2>
        <button className="btn btn-ghost" onClick={load}>Làm mới</button>
      </div>

      <div className="tabs">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            className={filter === f.id ? "active" : ""}
            onClick={() => setFilter(f.id)}
          >
            {f.label} ({f.id === "all" ? rows.length : rows.filter((r) => r.status === f.id).length})
          </button>
        ))}
      </div>

      <div className="tabs">
        {([["all", "Mọi loại"], ["profile", "Profile"], ["photo", "Ảnh"], ["review", "Bình luận"], ["price", "Giá / giao dịch"]] as const).map(([id, label]) => (
          <button key={id} type="button" className={typeFilter === id ? "active" : ""} onClick={() => setTypeFilter(id)}>
            {label}
          </button>
        ))}
      </div>

      <input
        className="search"
        placeholder="Tìm theo tên, email, lý do, nội dung…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      {error && (
        <div className="card" style={{ borderColor: "#fecaca", color: "#b91c1c", marginBottom: 12 }}>
          <p style={{ fontWeight: 700 }}>Lỗi: {error}</p>
          <p style={{ fontSize: 12, marginTop: 8 }}>
            Cần chạy <code>sql/021_profile_reports.sql</code> trong Supabase.
          </p>
        </div>
      )}

      {loading ? (
        <p className="muted">Đang tải…</p>
      ) : filtered.length === 0 ? (
        <div className="card">Không có báo cáo nào.</div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {filtered.map((r) => (
            <div className="card" key={r.id}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <a href="#" onClick={(e) => { e.preventDefault(); onOpenUser(r.reported_user_id); }}>
                    <strong>{name(r.reported_user_id, r.reported_name)}</strong>
                  </a>
                  {who[r.reported_user_id]?.banned_at && <span className="badge rejected" style={{ marginLeft: 6 }}>Đã bị ban</span>}
                  {who[r.reported_user_id]?.role === "admin" && <span className="badge draft" style={{ marginLeft: 6 }}>admin</span>}
                  <span className="muted"> bị báo cáo bởi </span>
                  <a href="#" onClick={(e) => { e.preventDefault(); onOpenUser(r.reporter_id); }}>
                    <strong>{name(r.reporter_id)}</strong>
                  </a>
                  {countAgainst[r.reported_user_id] > 1 && (
                    <span className="muted"> · bị báo cáo {countAgainst[r.reported_user_id]} lần</span>
                  )}
                  <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                    {new Date(r.created_at).toLocaleString("vi-VN")}
                    {r.booking_id ? ` · đơn ${r.booking_id.slice(0, 8)}…` : ""}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
                <span className="badge" style={{ background: r.report_type === "price" ? "#dbeafe" : r.subject === "review" ? "#fef3c7" : "#fce7f3", color: r.report_type === "price" ? "#1e40af" : r.subject === "review" ? "#92400e" : "#9d174d" }}>
                  {r.report_type === "price" ? "Giá / giao dịch" : r.subject === "review" ? "Bình luận" : r.subject === "photo" ? "Ảnh trong hồ sơ" : "Profile"}
                </span>
                <span className={`badge ${r.status === "open" ? "warn" : r.status === "reviewed" ? "ok" : "draft"}`}>
                  {r.status === "open" ? "Chờ xử lý" : r.status === "reviewed" ? "Đã xử lý" : "Bỏ qua"}
                </span>
                </div>
              </div>
              <p style={{ marginTop: 10, fontWeight: 700, fontSize: 13 }}>Lý do: {r.reason}</p>
              <div style={{ marginTop: 4, fontSize: 13, whiteSpace: "pre-wrap", maxHeight: 140, overflowY: "auto", overflowWrap: "anywhere" }}>
                {r.description}
              </div>
              {r.photo_url && (
                <a href={r.photo_url} target="_blank" rel="noreferrer">
                  <img src={r.photo_url} alt="Ảnh bị báo cáo" style={{ marginTop: 8, width: 120, height: 120, objectFit: "cover", borderRadius: 8, border: "1px solid #e2e8f0" }} />
                </a>
              )}
              {r.review_id && reviews[r.review_id] && (
                <div style={{ marginTop: 8, padding: 8, background: "#f8fafc", borderRadius: 8, fontSize: 12 }}>
                  <strong>Bình luận hiện tại ({reviews[r.review_id].rating}★):</strong>{" "}
                  {reviews[r.review_id].hidden ? <em>đã bị ẩn</em> : null}
                  <div style={{ whiteSpace: "pre-wrap", maxHeight: 100, overflowY: "auto", overflowWrap: "anywhere" }}>
                    {reviews[r.review_id].comment || "(không có nội dung)"}
                  </div>
                  <button
                    className="btn btn-ghost"
                    style={{ marginTop: 6 }}
                    onClick={() => setReviewHidden(r, !reviews[r.review_id as string].hidden)}
                  >
                    {reviews[r.review_id].hidden ? "Hiện lại bình luận" : "Ẩn bình luận này"}
                  </button>
                </div>
              )}

              <input
                className="search"
                style={{ marginTop: 10 }}
                placeholder="Ghi chú admin (tuỳ chọn)"
                defaultValue={r.admin_note || ""}
                onChange={(e) => setNotes((p) => ({ ...p, [r.id]: e.target.value }))}
              />
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button className="btn btn-primary" onClick={() => onOpenUser(r.reported_user_id)}>Xem tài khoản bị báo cáo</button>
                <button className="btn btn-ghost" onClick={() => onOpenUser(r.reporter_id)}>Xem người báo cáo</button>
                <button className="btn btn-ok" onClick={() => setStatus(r, "reviewed")}>Đánh dấu đã xử lý</button>
                <button className="btn btn-ghost" onClick={() => setStatus(r, "dismissed")}>Bỏ qua</button>
                {who[r.reported_user_id]?.role !== "admin" && !who[r.reported_user_id]?.banned_at && (
                  <button className="btn btn-danger" onClick={() => banUser(r)}>Ban người bị báo cáo</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/** Trang "Xử lý report": gộp mọi loại report. Hội thoại chat nằm ở tab riêng vì lấy từ bảng message_reports. */
export default function Reports({ onOpenUser }: { onOpenUser: (id: string) => void }) {
  const [source, setSource] = useState<"profile" | "chat">("profile");
  return (
    <>
      <div className="tabs" style={{ marginBottom: 18 }}>
        <button type="button" className={source === "profile" ? "active" : ""} onClick={() => setSource("profile")}>
          Profile · Ảnh · Bình luận · Giá
        </button>
        <button type="button" className={source === "chat" ? "active" : ""} onClick={() => setSource("chat")}>
          Hội thoại chat
        </button>
      </div>
      {source === "profile" ? <ProfileReports onOpenUser={onOpenUser} /> : <ChatReports onOpenUser={onOpenUser} />}
    </>
  );
}
