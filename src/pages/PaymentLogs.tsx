import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { ADV_PCT } from "../lib/payout";

type Log = {
  id: string;
  provider: string;
  provider_tx_id: string | null;
  booking_id: string | null;
  bill_code: string | null;
  amount: number;
  content: string | null;
  result: string;
  note: string | null;
  created_at: string;
  // cột bổ sung bởi sql/030_transaction_audit.sql (có thể chưa tồn tại)
  client_id?: string | null;
  photographer_user_id?: string | null;
  client_label?: string | null;
  photographer_label?: string | null;
  package_name?: string | null;
  fee_amount?: number | null;
  actor_email?: string | null;
};

type Who = { name: string; email: string };
type Parties = { client: Who; ptg: Who; pkg: string };

const RESULT_LABEL: Record<string, string> = {
  matched: "Đã tự xác nhận",
  manual: "Admin đánh dấu tay",
  unmatched: "Không khớp lịch hẹn",
  underpaid: "Thiếu tiền",
  ignored: "Bỏ qua (cần xem)",
  payout_advance: `Đã ứng ${ADV_PCT}% cho PTG`,
  payout_final: "Đã quyết toán PTG",
  processing: "Đang xử lý",
};
const GOOD = ["matched", "manual", "payout_advance", "payout_final"];

const money = (n: number) => `${Number(n || 0).toLocaleString("vi-VN")}đ`;

export default function PaymentLogs() {
  const [rows, setRows] = useState<Log[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [parties, setParties] = useState<Record<string, Parties>>({});

  async function load() {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
      .from("payment_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(300);
    if (err) setError(err.message);
    else {
      const logs = (data as Log[]) || [];
      setRows(logs);
      await loadParties(logs);
    }
    setLoading(false);
  }

  /** Tra tài khoản khách / PTG của từng log qua booking_id → bookings → profiles */
  async function loadParties(logs: Log[]) {
    const ids = [...new Set(logs.map((l) => l.booking_id).filter(Boolean))] as string[];
    if (!ids.length) return setParties({});
    const bks: Record<string, unknown>[] = [];
    for (let i = 0; i < ids.length; i += 150) {
      const { data: b } = await supabase
        .from("bookings")
        .select("id,client_id,client_name,photographer_user_id,photographer_name,package_name")
        .in("id", ids.slice(i, i + 150));
      bks.push(...((b as Record<string, unknown>[]) || []));
    }
    const pids = [...new Set(bks.flatMap((b) => [b.client_id, b.photographer_user_id]).filter(Boolean))] as string[];
    const profs = new Map<string, { full_name?: string; username?: string; email?: string }>();
    for (let i = 0; i < pids.length; i += 150) {
      const { data: p } = await supabase.from("profiles").select("id,full_name,username,email").in("id", pids.slice(i, i + 150));
      ((p as { id: string; full_name?: string; username?: string; email?: string }[]) || []).forEach((x) => profs.set(x.id, x));
    }
    const who = (id: unknown, fallback: unknown): Who => {
      const p = id ? profs.get(id as string) : undefined;
      return { name: p?.full_name || p?.username || p?.email || (fallback as string) || "—", email: p?.email || "" };
    };
    const out: Record<string, Parties> = {};
    for (const b of bks)
      out[b.id as string] = {
        client: who(b.client_id, b.client_name),
        ptg: who(b.photographer_user_id, b.photographer_name),
        pkg: (b.package_name as string) || "",
      };
    setParties(out);
  }
  useEffect(() => { load(); }, []);

  const list = useMemo(
    () => (onlyIssues ? rows.filter((r) => !GOOD.includes(r.result)) : rows),
    [rows, onlyIssues],
  );
  const issues = rows.filter((r) => !GOOD.includes(r.result)).length;

  return (
    <>
      <div className="topbar">
        <h2>Log giao dịch</h2>
        <button className="btn btn-ghost" onClick={load}>Làm mới</button>
      </div>

      <div className="tabs">
        <button type="button" className={!onlyIssues ? "active" : ""} onClick={() => setOnlyIssues(false)}>
          Tất cả ({rows.length})
        </button>
        <button type="button" className={onlyIssues ? "active" : ""} onClick={() => setOnlyIssues(true)}>
          Cần xem ({issues})
        </button>
      </div>

      {error && (
        <div className="card" style={{ color: "#b91c1c" }}>
          {error}
          <p className="muted">Cần chạy sql/022_payments_auto.sql</p>
        </div>
      )}

      {loading ? (
        <p className="muted">Đang tải…</p>
      ) : list.length === 0 ? (
        <div className="card">Chưa có giao dịch nào.</div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Thời gian</th><th>Nguồn</th><th>Mã lịch hẹn</th><th>Khách (TK)</th><th>PTG (TK)</th>
                <th>Số tiền</th><th>Phí Memento</th><th>Nội dung CK</th><th>Kết quả</th><th>Admin thao tác</th><th>Ghi chú</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id}>
                  <td style={{ whiteSpace: "nowrap", fontSize: 12 }}>{new Date(r.created_at).toLocaleString("vi-VN")}</td>
                  <td style={{ fontSize: 12 }}>{r.provider}</td>
                  <td><code>{r.bill_code || "—"}</code></td>
                  {(() => {
                    const pt = r.booking_id ? parties[r.booking_id] : undefined;
                    const c = pt?.client ?? { name: r.client_label || "—", email: "" };
                    const g = pt?.ptg ?? { name: r.photographer_label || "—", email: "" };
                    return (
                      <>
                        <td style={{ fontSize: 12 }}><b>{c.name}</b><div className="muted" style={{ fontSize: 11 }}>{c.email}</div></td>
                        <td style={{ fontSize: 12 }}><b>{g.name}</b><div className="muted" style={{ fontSize: 11 }}>{g.email}</div></td>
                      </>
                    );
                  })()}
                  <td style={{ fontWeight: 700 }}>{money(r.amount)}</td>
                  <td style={{ fontSize: 12 }}>{r.fee_amount ? money(r.fee_amount) : "—"}</td>
                  <td style={{ fontSize: 12, maxWidth: 200 }}>{r.content || "—"}</td>
                  <td>
                    <span className={`badge ${GOOD.includes(r.result) ? "ok" : "warn"}`}>
                      {RESULT_LABEL[r.result] || r.result}
                    </span>
                  </td>
                  <td style={{ fontSize: 12 }}>{r.actor_email || "—"}</td>
                  <td style={{ fontSize: 12, maxWidth: 260 }}>{r.note || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
