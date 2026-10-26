import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

type Req = {
  id: string;
  code: string | null;
  title: string | null;
  requester_id: string | null;
  requester_name: string | null;
  genres: string[] | null;
  city: string | null;
  venue: string | null;
  shoot_start: string | null;
  shoot_end: string | null;
  budget_min: number | null;
  budget_max: number | null;
  deadline: string | null;
  status: "open" | "matched" | "closed" | "expired";
  offer_count: number | null;
  note: string | null;
  created_at: string;
};

type Offer = {
  offer_id: string;
  photographer_user_id: string;
  name: string;
  price: number;
  message: string | null;
  status: "pending" | "chosen" | "rejected" | "withdrawn";
  updated_at: string;
};

const PAGE = 50;
const vnd = (n: number | null | undefined) => `${Number(n || 0).toLocaleString("vi-VN")}đ`;
const when = (s: string | null) => (s ? new Date(s).toLocaleString("vi-VN") : "—");

const STATUS: Record<Req["status"], { label: string; bg: string; fg: string }> = {
  open: { label: "Đang tìm PTG", bg: "#d1fae5", fg: "#065f46" },
  matched: { label: "Đã chọn PTG", bg: "#ede9fe", fg: "#5b21b6" },
  closed: { label: "Đã đóng", bg: "#e5e7eb", fg: "#374151" },
  expired: { label: "Hết hạn", bg: "#fef3c7", fg: "#92400e" },
};
const OFFER_LABEL: Record<Offer["status"], string> = {
  pending: "Đang chờ", chosen: "Được chọn", rejected: "Không được chọn", withdrawn: "Đã rút",
};

type Filter = "all" | Req["status"];
const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "Tất cả" },
  { id: "open", label: "Đang tìm PTG" },
  { id: "matched", label: "Đã chọn PTG" },
  { id: "expired", label: "Hết hạn" },
  { id: "closed", label: "Đã đóng" },
];

/** Đơn tìm PTG: toàn bộ bài đăng của khách + danh sách PTG đã nhận (giá, lời nhắn). */
export default function Requests() {
  const [rows, setRows] = useState<Req[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [offers, setOffers] = useState<Record<string, Offer[] | "loading" | string>>({});
  const [totals, setTotals] = useState<Record<string, number>>({});

  const load = useCallback(async (from: number) => {
    setLoading(true);
    const { data, error: err } = await supabase
      .from("photo_requests").select("*").order("created_at", { ascending: false }).range(from, from + PAGE - 1);
    if (err) { setError(err.message); setLoading(false); return; }
    const list = (data as Req[]) || [];
    setRows((cur) => (from === 0 ? list : [...cur, ...list.filter((x) => !cur.some((c) => c.id === x.id))]));
    setHasMore(list.length === PAGE);
    setLoading(false);
  }, []);

  useEffect(() => { void load(0); }, [load]);

  // Số liệu tổng (không phụ thuộc phân trang)
  useEffect(() => {
    (async () => {
      const count = async (s?: string) => {
        let qy = supabase.from("photo_requests").select("id", { count: "exact", head: true });
        if (s) qy = qy.eq("status", s);
        const { count: n } = await qy;
        return n ?? 0;
      };
      const [all, o, m, offersN] = await Promise.all([
        count(), count("open"), count("matched"),
        supabase.from("photo_request_offers").select("id", { count: "exact", head: true }).then((r) => r.count ?? 0),
      ]);
      setTotals({ all, open: o, matched: m, offers: offersN });
    })();
  }, []);

  async function toggle(id: string) {
    if (open === id) { setOpen(null); return; }
    setOpen(id);
    if (Array.isArray(offers[id])) return;
    setOffers((c) => ({ ...c, [id]: "loading" }));
    const { data, error: err } = await supabase.rpc("list_request_offers", { p_request_id: id });
    setOffers((c) => ({ ...c, [id]: err ? err.message : ((data as Offer[]) || []).map((x) => ({ ...x, price: Number(x.price) })) }));
  }

  const filtered = useMemo(() => {
    let list = rows;
    if (filter !== "all") list = list.filter((r) => r.status === filter);
    const s = q.trim().toLowerCase();
    if (s) list = list.filter((r) =>
      (r.title || "").toLowerCase().includes(s) || (r.requester_name || "").toLowerCase().includes(s) ||
      (r.code || "").toLowerCase().includes(s) || (r.city || "").toLowerCase().includes(s));
    return list;
  }, [rows, filter, q]);

  return (
    <div>
      <h2>📢 Đơn tìm PTG</h2>
      <p className="muted" style={{ marginBottom: 12 }}>
        Tất cả bài đăng của khách đang tìm nhiếp ảnh gia, cùng các PTG đã nhận đơn và giá họ đề xuất.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10, marginBottom: 14 }}>
        {[
          ["Tổng bài đăng", totals.all], ["Đang tìm PTG", totals.open],
          ["Đã chọn PTG", totals.matched], ["Tổng lượt nhận đơn", totals.offers],
        ].map(([label, n]) => (
          <div key={label as string} className="card" style={{ padding: 12 }}>
            <div className="muted" style={{ fontSize: 12 }}>{label}</div>
            <div style={{ fontWeight: 800, fontSize: 22 }}>{n ?? "…"}</div>
          </div>
        ))}
      </div>

      {error && <div className="card" style={{ color: "#b91c1c", marginBottom: 12 }}>{error}</div>}

      <div className="tabs" style={{ marginBottom: 12 }}>
        {FILTERS.map((f) => (
          <button key={f.id} type="button" className={filter === f.id ? "active" : ""} onClick={() => setFilter(f.id)}>{f.label}</button>
        ))}
      </div>
      <input className="search" placeholder="Tìm tiêu đề, người đăng, mã đơn, tỉnh…" value={q} onChange={(e) => setQ(e.target.value)} />

      {loading && rows.length === 0 ? <p className="muted">Đang tải…</p>
        : filtered.length === 0 ? <div className="card">Không có đơn nào.</div>
        : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {filtered.map((r) => {
              const st = STATUS[r.status] ?? STATUS.open;
              const isOpen = open === r.id;
              const of = offers[r.id];
              return (
                <div key={r.id} className="card">
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                    <div>
                      <span style={{ display: "inline-block", fontSize: 11, fontWeight: 700, background: st.bg, color: st.fg, padding: "3px 10px", borderRadius: 999, marginBottom: 6 }}>
                        {st.label}
                      </span>
                      <div style={{ fontWeight: 800, fontSize: 15 }}>{r.title || "Đơn tìm PTG"}</div>
                      <div className="muted" style={{ fontSize: 12 }}>
                        #{r.code || r.id.slice(0, 8)} · {r.requester_name || "—"} · đăng {when(r.created_at)}
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontWeight: 800 }}>
                        {r.budget_min || r.budget_max ? `${vnd(r.budget_min)} – ${vnd(r.budget_max)}` : "Thỏa thuận"}
                      </div>
                      <div className="muted" style={{ fontSize: 12 }}>{r.offer_count ?? 0} PTG đã nhận đơn</div>
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 10, fontSize: 13 }}>
                    <div><span className="muted">Thể loại: </span>{(r.genres || []).join(", ") || "—"}</div>
                    <div><span className="muted">Địa điểm: </span>{[r.city, r.venue].filter(Boolean).join(" · ") || "—"}</div>
                    <div><span className="muted">Chụp: </span>{when(r.shoot_start)} → {when(r.shoot_end)}</div>
                    <div><span className="muted">Hạn tìm PTG: </span>{when(r.deadline)}</div>
                  </div>
                  {r.note && <div style={{ marginTop: 8, fontSize: 13 }}><span className="muted">Ghi chú: </span>{r.note}</div>}

                  <button type="button" className="btn" style={{ marginTop: 10 }} onClick={() => void toggle(r.id)}>
                    {isOpen ? "Ẩn" : "Xem"} danh sách PTG nhận đơn ({r.offer_count ?? 0})
                  </button>

                  {isOpen && (
                    <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                      {of === "loading" ? <p className="muted">Đang tải…</p>
                        : typeof of === "string" ? <p style={{ color: "#b91c1c" }}>{of}</p>
                        : !of || of.length === 0 ? <p className="muted">Chưa có PTG nào nhận đơn.</p>
                        : of.map((o) => (
                          <div key={o.offer_id} style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 10, background: o.status === "chosen" ? "#f5f3ff" : "#fff" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                              <strong>{o.name}</strong>
                              <span><strong>{vnd(o.price)}</strong> · <span className="muted">{OFFER_LABEL[o.status]}</span></span>
                            </div>
                            {o.message && <div style={{ fontSize: 13, marginTop: 4, whiteSpace: "pre-wrap" }}>{o.message}</div>}
                            <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>Cập nhật {when(o.updated_at)}</div>
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              );
            })}
            {hasMore && (
              <button type="button" className="btn" disabled={loading} onClick={() => void load(rows.length)}>
                {loading ? "Đang tải…" : "Tải thêm"}
              </button>
            )}
          </div>
        )}
    </div>
  );
}
