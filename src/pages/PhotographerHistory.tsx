import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import {
  ADV_PCT,
  COMM_PCT,
  FINAL_PCT,
  PTG_PCT,
  calcAdvance,
  calcFee,
  calcFinal,
  calcPtgTotal,
  formatVnd,
} from "../lib/payout";

type Booking = {
  id: string;
  client_id: string;
  client_name: string | null;
  client_avatar: string | null;
  photographer_user_id: string | null;
  photographer_name: string;
  package_name: string;
  package_price: number;
  package_category: string | null;
  booking_date: string;
  start_time: string;
  end_time: string;
  status: string;
  payment_status: string | null;
  payment_ref: string | null;
  deposit_amount: number | null;
  deposit_paid_at: string | null;
  final_paid_at: string | null;
  drive_url: string | null;
  client_note: string | null;
  ptg_note: string | null;
  created_at: string;
};

const FILTERS = [
  { id: "all", label: "Tất cả" },
  { id: "pending", label: "Chờ xác nhận" },
  { id: "confirmed", label: "Chờ thanh toán" },
  { id: "deposit_paid", label: "Đang chụp" },
  { id: "handover", label: "Bàn giao" },
  { id: "completed", label: "Hoàn tất" },
  { id: "rejected", label: "Từ chối / Hủy" },
] as const;

export default function PhotographerHistory({
  userId,
  name,
  mode,
  onBack,
}: {
  userId: string;
  name?: string | null;
  mode: "transactions" | "bookings";
  onBack: () => void;
}) {
  const [rows, setRows] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");
  const [q, setQ] = useState("");

  async function load() {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
      .from("bookings")
      .select("*")
      .eq("photographer_user_id", userId)
      .order("created_at", { ascending: false })
      .limit(300);
    if (err) setError(err.message);
    else setRows((data as Booking[]) || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, [userId]);

  const paidLike = (b: Booking) =>
    ["deposit_paid", "handover", "final_payment", "completed", "paid"].includes(b.status) ||
    !!b.deposit_paid_at ||
    b.payment_status === "paid" ||
    b.payment_status === "deposit_paid" ||
    b.payment_status === "fully_paid";

  const stats = useMemo(() => {
    const paid = rows.filter(paidLike);
    const revenue = paid.reduce((s, b) => s + Number(b.package_price || 0), 0);
    const commission = paid.reduce((s, b) => s + calcFee(b.package_price), 0);
    const toPtg = paid.reduce((s, b) => s + calcPtgTotal(b.package_price), 0);
    const advanceDue = paid.reduce((s, b) => s + calcAdvance(b.package_price), 0);
    return { count: paid.length, revenue, commission, toPtg, advanceDue };
  }, [rows]);

  const filtered = useMemo(() => {
    let list = rows;
    if (mode === "transactions") {
      list = list.filter(paidLike);
    } else if (filter !== "all") {
      if (filter === "rejected") list = list.filter((b) => b.status === "rejected" || b.status === "cancelled");
      else if (filter === "completed")
        list = list.filter((b) => b.status === "completed" || b.status === "paid");
      else list = list.filter((b) => b.status === filter);
    }
    const s = q.trim().toLowerCase();
    if (s) {
      list = list.filter(
        (b) =>
          (b.client_name || "").toLowerCase().includes(s) ||
          (b.package_name || "").toLowerCase().includes(s) ||
          (b.payment_ref || "").toLowerCase().includes(s) ||
          b.id.toLowerCase().includes(s)
      );
    }
    return list;
  }, [rows, filter, q, mode]);

  return (
    <div>
      <div className="topbar">
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <button type="button" className="btn btn-ghost" onClick={onBack}>
            ← Quay lại
          </button>
          <h2 style={{ margin: 0 }}>
            {mode === "transactions" ? "Lịch sử giao dịch" : "Lịch hẹn"} · {name || userId.slice(0, 8)}
          </h2>
        </div>
        <button type="button" className="btn btn-ghost" onClick={load}>
          Làm mới
        </button>
      </div>

      <div className="card" style={{ marginBottom: 14, fontSize: 13, lineHeight: 1.55 }}>
        <strong>Luồng tiền (deal 100%):</strong> User trả đủ → Memento giữ → ứng PTG <strong>{ADV_PCT}%</strong> →
        khi hoàn tất chuyển thêm <strong>{FINAL_PCT}%</strong> (PTG tổng {PTG_PCT}%) · platform hoa hồng <strong>{COMM_PCT}%</strong>.
      </div>

      {mode === "transactions" && (
        <div className="grid grid-3" style={{ marginBottom: 16 }}>
          <div className="stat">
            <div className="n">{stats.count}</div>
            <div className="l">Đơn đã thu</div>
          </div>
          <div className="stat">
            <div className="n" style={{ fontSize: 18 }}>{formatVnd(stats.revenue)}</div>
            <div className="l">Tổng user đã trả</div>
          </div>
          <div className="stat">
            <div className="n" style={{ fontSize: 18 }}>{formatVnd(stats.commission)}</div>
            <div className="l">Hoa hồng {COMM_PCT}%</div>
          </div>
          <div className="stat">
            <div className="n" style={{ fontSize: 18 }}>{formatVnd(stats.advanceDue)}</div>
            <div className="l">Ứng PTG {ADV_PCT}%</div>
          </div>
          <div className="stat">
            <div className="n" style={{ fontSize: 18 }}>{formatVnd(stats.toPtg)}</div>
            <div className="l">Tổng phải trả PTG {PTG_PCT}%</div>
          </div>
        </div>
      )}

      {mode === "bookings" && (
        <div className="tabs">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={filter === f.id ? "active" : ""}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      <input
        className="search"
        placeholder="Tìm khách, gói, mã bill..."
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      {error && (
        <div className="card" style={{ color: "#b91c1c" }}>
          {error}
        </div>
      )}

      {loading ? (
        <p className="muted">Đang tải…</p>
      ) : filtered.length === 0 ? (
        <div className="card">Không có dữ liệu.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {filtered.map((b) => {
            const total = Number(b.package_price) || 0;
            const paid = paidLike(b);
            return (
              <div key={b.id} className="card">
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div>
                    <strong>{b.package_name}</strong>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {b.booking_date} · {b.start_time}–{b.end_time} · {b.status}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontWeight: 800 }}>{formatVnd(total)}</div>
                    {b.payment_ref && (
                      <code style={{ fontSize: 11 }}>{b.payment_ref}</code>
                    )}
                  </div>
                </div>
                <div style={{ marginTop: 10, fontSize: 13, display: "grid", gap: 4 }}>
                  <div>
                    <span className="muted">Khách:</span>{" "}
                    <strong>{b.client_name || b.client_id.slice(0, 8)}</strong>
                  </div>
                  {b.client_note && (
                    <div>
                      <span className="muted">Ghi chú khách:</span> {b.client_note}
                    </div>
                  )}
                  {b.ptg_note && (
                    <div>
                      <span className="muted">Ghi chú PTG:</span> {b.ptg_note}
                    </div>
                  )}
                  {mode === "transactions" && paid && (
                    <div
                      style={{
                        marginTop: 8,
                        padding: 10,
                        borderRadius: 10,
                        background: "#f0fdf4",
                        border: "1px solid #bbf7d0",
                        fontSize: 12,
                        lineHeight: 1.5,
                      }}
                    >
                      User đã trả: <strong>{formatVnd(total)}</strong>
                      <br />
                      Ứng PTG {ADV_PCT}%: <strong>{formatVnd(calcAdvance(total))}</strong>
                      <br />
                      Còn chuyển khi xong {FINAL_PCT}%: <strong>{formatVnd(calcFinal(total))}</strong>
                      <br />
                      Hoa hồng Memento {COMM_PCT}%: <strong>{formatVnd(calcFee(total))}</strong>
                      <br />
                      {b.deposit_paid_at && (
                        <>Thu lúc: {new Date(b.deposit_paid_at).toLocaleString("vi-VN")}</>
                      )}
                    </div>
                  )}
                  {b.drive_url && (
                    <a href={b.drive_url} target="_blank" rel="noreferrer">
                      Drive bàn giao
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
