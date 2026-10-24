import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

type Row = {
  id: string;
  user_id: string;
  photographer_name: string | null;
  bank_name: string;
  bank_code: string | null;
  bank_account: string;
  bank_account_name: string | null;
  status: string;
  admin_note: string | null;
  created_at: string;
};

export default function BankChanges() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<"pending" | "all">("pending");

  async function load() {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
      .from("bank_change_requests")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    if (err) setError(err.message);
    else setRows((data as Row[]) || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function decide(row: Row, approved: boolean) {
    setBusy(row.id);
    setError(null);
    try {
      const { error: err } = await supabase.rpc("admin_review_bank_change", {
        p_request_id: row.id,
        p_approve: approved,
        p_note: null,
      });
      if (err) throw err;
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : (e as { message?: string })?.message || "Lỗi duyệt");
    } finally {
      setBusy(null);
    }
  }

  const list = filter === "pending" ? rows.filter((r) => r.status === "pending") : rows;

  return (
    <>
      <div className="topbar">
        <h2>Duyệt đổi TK ngân hàng</h2>
        <button className="btn btn-ghost" onClick={load}>
          Làm mới
        </button>
      </div>

      <div className="tabs">
        <button type="button" className={filter === "pending" ? "active" : ""} onClick={() => setFilter("pending")}>
          Chờ duyệt ({rows.filter((r) => r.status === "pending").length})
        </button>
        <button type="button" className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>
          Tất cả ({rows.length})
        </button>
      </div>

      {error && (
        <div className="card" style={{ color: "#b91c1c" }}>
          {error}
          <p className="muted">Cần chạy SQL 021_ptg_bank_accounts.sql và 022_payments_auto.sql</p>
        </div>
      )}

      {loading ? (
        <p className="muted">Đang tải…</p>
      ) : list.length === 0 ? (
        <div className="card">Không có yêu cầu.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {list.map((r) => (
            <div key={r.id} className="card">
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <div>
                  <strong>{r.photographer_name || r.user_id}</strong>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {new Date(r.created_at).toLocaleString("vi-VN")} · {r.status}
                  </div>
                </div>
                <span className={`badge ${r.status === "pending" ? "warn" : r.status === "approved" ? "ok" : ""}`}>
                  {r.status}
                </span>
              </div>
              <div style={{ marginTop: 10, fontSize: 13, lineHeight: 1.6 }}>
                <div>
                  <span className="muted">Ngân hàng:</span> <strong>{r.bank_name}</strong> ({r.bank_code})
                </div>
                <div>
                  <span className="muted">STK:</span> <strong>{r.bank_account}</strong>
                </div>
                <div>
                  <span className="muted">Chủ TK:</span> <strong>{r.bank_account_name}</strong>
                </div>
              </div>
              {r.status === "pending" && (
                <div className="actions">
                  <button className="btn btn-ok" disabled={busy === r.id} onClick={() => decide(r, true)}>
                    ✓ Duyệt & áp dụng
                  </button>
                  <button className="btn btn-danger" disabled={busy === r.id} onClick={() => decide(r, false)}>
                    ✕ Từ chối
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
