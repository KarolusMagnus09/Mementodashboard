import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

type Photographer = {
  id: number;
  name: string;
  location: string;
  price: number;
  rating: number;
  bookings: number;
  specialty: string | null;
  avatar: string | null;
  cover: string | null;
  bank_name: string | null;
  bank_code: string | null;
  bank_account: string | null;
  bank_account_name: string | null;
};

export default function Photographers() {
  const [rows, setRows] = useState<Photographer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data, error: err } = await supabase
        .from("photographers")
        .select(
          "id,name,location,price,rating,bookings,specialty,avatar,cover,bank_name,bank_code,bank_account,bank_account_name"
        )
        .order("id", { ascending: true });
      if (err) setError(err.message);
      else setRows((data as Photographer[]) || []);
      setLoading(false);
    })();
  }, []);

  return (
    <>
      <div className="topbar">
        <h2>Marketplace photographers ({rows.length})</h2>
      </div>
      {error && <div className="card" style={{ color: "var(--danger)" }}>{error}</div>}
      {loading ? (
        <p className="muted">Đang tải...</p>
      ) : rows.length === 0 ? (
        <div className="card muted">Chưa có photographer trên marketplace.</div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Tên</th>
                <th>Khu vực</th>
                <th>Giá</th>
                <th>Rating</th>
                <th>Bookings</th>
                <th>Specialty</th>
                <th>TK ngân hàng</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.id}</td>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {r.avatar ? (
                        <img
                          src={r.avatar}
                          alt=""
                          style={{ width: 28, height: 28, borderRadius: "50%", objectFit: "cover" }}
                        />
                      ) : null}
                      {r.name}
                    </div>
                  </td>
                  <td>{r.location}</td>
                  <td>{Number(r.price || 0).toLocaleString("vi-VN")}đ</td>
                  <td>{r.rating}</td>
                  <td>{r.bookings}</td>
                  <td className="muted">{r.specialty || "—"}</td>
                  <td style={{ fontSize: 12, maxWidth: 180 }}>
                    {r.bank_account ? (
                      <>
                        <div>
                          {r.bank_name || r.bank_code || "—"}
                        </div>
                        <div className="muted">
                          {r.bank_account}
                          <br />
                          {r.bank_account_name}
                        </div>
                      </>
                    ) : (
                      <span style={{ color: "#b91c1c" }}>Chưa có STK</span>
                    )}
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
