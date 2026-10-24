import { useEffect, useMemo, useState } from "react";
import { supabase, type ProfileRow } from "../lib/supabase";
import { Transcript, type ChatReport } from "./ChatReports";

type Booking = {
  id: string;
  client_id: string;
  client_name: string | null;
  photographer_user_id: string | null;
  photographer_name: string;
  package_name: string;
  package_price: number;
  booking_date: string;
  status: string;
  payment_status: string | null;
  payment_ref: string | null;
  deposit_paid_at: string | null;
  created_at: string;
};

type PayLog = {
  id: string;
  booking_id: string | null;
  bill_code: string | null;
  amount: number;
  result: string;
  note: string | null;
  created_at: string;
};

type Report = {
  id: string;
  reporter_id: string;
  reported_user_id: string;
  reason: string;
  description: string;
  status: string;
  created_at: string;
};

type Who = { id: string; full_name: string | null; username: string | null; email: string | null; role?: string };

type Tab = "info" | "tx" | "chat" | "reports";

const money = (n: number) => `${Number(n || 0).toLocaleString("vi-VN")}đ`;
const fmt = (s?: string | null) => (s ? new Date(s).toLocaleString("vi-VN") : "—");

const PAID_STATUS = ["deposit_paid", "handover", "final_payment", "completed", "paid"];
const isPaid = (b: Booking) =>
  PAID_STATUS.includes(b.status) ||
  !!b.deposit_paid_at ||
  ["paid", "deposit_paid", "fully_paid"].includes(b.payment_status || "");

export default function UserDetail({
  userId,
  onBack,
  onOpenUser,
  onChanged,
}: {
  userId: string;
  onBack: () => void;
  onOpenUser: (id: string) => void;
  onChanged?: () => void;
}) {
  const [tab, setTab] = useState<Tab>("info");
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [app, setApp] = useState<Record<string, unknown> | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [logs, setLogs] = useState<PayLog[]>([]);
  const [chatReports, setChatReports] = useState<ChatReport[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [who, setWho] = useState<Record<string, Who>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);
  const [openChatReport, setOpenChatReport] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [banReason, setBanReason] = useState("");
  const [confirmDelete, setConfirmDelete] = useState("");
  const [deleted, setDeleted] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    setChatError(null);

    const { data: p, error: pe } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
    if (pe) setError(pe.message);
    setProfile((p as ProfileRow) || null);

    const { data: a } = await supabase.from("photographer_applications").select("*").eq("user_id", userId).maybeSingle();
    setApp((a as Record<string, unknown>) || null);

    const { data: bk, error: be } = await supabase
      .from("bookings")
      .select("*")
      .or(`client_id.eq.${userId},photographer_user_id.eq.${userId}`)
      .order("created_at", { ascending: false })
      .limit(300);
    if (be) setError(be.message);
    const bl = (bk as Booking[]) || [];
    setBookings(bl);

    if (bl.length) {
      const { data: pl } = await supabase
        .from("payment_logs")
        .select("*")
        .in("booking_id", bl.map((b) => b.id))
        .order("created_at", { ascending: false });
      setLogs((pl as PayLog[]) || []);
    } else setLogs([]);

    // Admin không đọc được tin nhắn người dùng; chỉ thấy các hội thoại đã bị báo cáo (message_reports)
    const { data: mr, error: me } = await supabase
      .from("message_reports")
      .select("*")
      .or(`reporter_id.eq.${userId},reported_user_id.eq.${userId}`)
      .order("created_at", { ascending: false });
    if (me) setChatError(me.message);
    const cr = (mr as ChatReport[]) || [];
    setChatReports(cr);

    const { data: rp } = await supabase
      .from("profile_reports")
      .select("*")
      .or(`reporter_id.eq.${userId},reported_user_id.eq.${userId}`)
      .order("created_at", { ascending: false });
    const rl = (rp as Report[]) || [];
    setReports(rl);

    const ids = new Set<string>();
    cr.forEach((r) => { ids.add(r.reporter_id); ids.add(r.reported_user_id); });
    rl.forEach((r) => { ids.add(r.reporter_id); ids.add(r.reported_user_id); });
    bl.forEach((b) => { ids.add(b.client_id); if (b.photographer_user_id) ids.add(b.photographer_user_id); });
    ids.delete(userId);
    if (ids.size) {
      const { data: ps } = await supabase
        .from("profiles")
        .select("id, full_name, username, email, role")
        .in("id", Array.from(ids));
      const map: Record<string, Who> = {};
      for (const w of (ps as Who[]) || []) map[w.id] = w;
      setWho(map);
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, [userId]);

  const nameOf = (id: string) => {
    if (id === userId) return profile?.full_name || profile?.username || "Tài khoản này";
    const w = who[id];
    return w?.full_name || w?.username || w?.email || id.slice(0, 8);
  };

  const isAdmin = profile?.role === "admin";
  const isBanned = !!profile?.banned_at;

  async function ban() {
    if (isAdmin) return;
    if (!window.confirm(`Ban tài khoản "${nameOf(userId)}"? Họ sẽ bị đăng xuất và không thể đăng nhập lại.`)) return;
    setBusy(true);
    const { error: err } = await supabase.rpc("admin_ban_user", { p_user_id: userId, p_reason: banReason.trim() || null });
    setBusy(false);
    if (err) return setError(err.message);
    setBanReason("");
    await load();
    onChanged?.();
  }

  async function unban() {
    setBusy(true);
    const { error: err } = await supabase.rpc("admin_unban_user", { p_user_id: userId });
    setBusy(false);
    if (err) return setError(err.message);
    await load();
    onChanged?.();
  }

  async function remove() {
    if (isAdmin) return;
    setBusy(true);
    const { error: err } = await supabase.rpc("admin_delete_user", { p_user_id: userId });
    setBusy(false);
    if (err) return setError(err.message);
    setDeleted(true);
    onChanged?.();
  }

  const paidBookings = bookings.filter(isPaid);
  const reportsAgainst = reports.filter((r) => r.reported_user_id === userId);
  const reportsBy = reports.filter((r) => r.reporter_id === userId);

  if (deleted) {
    return (
      <>
        <div className="topbar"><h2>Đã xóa tài khoản</h2></div>
        <div className="card">
          Tài khoản và dữ liệu liên quan đã được xóa.
          <div className="actions"><button className="btn btn-primary" onClick={onBack}>← Quay lại</button></div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="topbar">
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <button className="btn btn-ghost" onClick={onBack}>← Quay lại</button>
          <h2 style={{ margin: 0 }}>{profile?.full_name || profile?.username || userId.slice(0, 8)}</h2>
          {profile && <span className="badge draft">{profile.role}</span>}
          {isBanned && <span className="badge rejected">Đã bị ban</span>}
        </div>
        <button className="btn btn-ghost" onClick={load}>Làm mới</button>
      </div>

      {error && <div className="card" style={{ borderColor: "#fecaca", color: "#b91c1c" }}>Lỗi: {error}</div>}

      <div className="tabs">
        <button className={tab === "info" ? "active" : ""} onClick={() => setTab("info")}>Thông tin</button>
        <button className={tab === "tx" ? "active" : ""} onClick={() => setTab("tx")}>Giao dịch ({bookings.length})</button>
        <button className={tab === "chat" ? "active" : ""} onClick={() => setTab("chat")}>Chat bị báo cáo ({chatReports.length})</button>
        <button className={tab === "reports" ? "active" : ""} onClick={() => setTab("reports")}>
          Report ({reportsAgainst.length} bị báo cáo · {reportsBy.length} đã gửi)
        </button>
      </div>

      {loading ? <p className="muted">Đang tải…</p> : !profile ? (
        <div className="card">Không tìm thấy tài khoản (có thể đã bị xóa).</div>
      ) : (
        <>
          {tab === "info" && (
            <>
              <div className="card">
                <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
                  {profile.avatar_url ? <img className="avatar-lg" src={profile.avatar_url} alt="" /> : <div className="avatar-lg" />}
                  <div className="grid grid-2" style={{ flex: 1, minWidth: 260 }}>
                    <Field label="Họ tên" v={profile.full_name} />
                    <Field label="Username" v={profile.username} />
                    <Field label="Email" v={profile.email} />
                    <Field label="SĐT" v={profile.phone} />
                    <Field label="Role" v={profile.role} />
                    <Field label="Ngày tạo" v={fmt(profile.created_at)} />
                    <Field label="ID" v={profile.id} />
                    <Field label="Onboarding" v={profile.onboarding_completed ? "Đã xong" : "Chưa xong"} />
                  </div>
                </div>
              </div>

              {isBanned && (
                <div className="card" style={{ borderColor: "#fecaca" }}>
                  <strong style={{ color: "#991b1b" }}>Tài khoản đang bị ban</strong>
                  <p className="muted">Từ {fmt(profile.banned_at)} · Lý do: {profile.ban_reason || "(không ghi)"}</p>
                </div>
              )}

              {app && (
                <div className="card">
                  <strong>Hồ sơ photographer</strong>
                  <div className="grid grid-2" style={{ marginTop: 10 }}>
                    <Field label="Trạng thái hồ sơ" v={String(app.status ?? "")} />
                    <Field label="Họ tên (CCCD)" v={app.full_name as string} />
                    <Field label="Khu vực" v={Array.isArray(app.work_locations) ? (app.work_locations as string[]).join(", ") : ""} />
                    <Field label="Kinh nghiệm" v={app.experience_years as string} />
                    <Field label="Ngân hàng" v={[app.bank_name, app.bank_account, app.bank_account_name].filter(Boolean).join(" · ")} />
                    <Field label="Đơn đã thu tiền" v={`${paidBookings.length}`} />
                  </div>
                </div>
              )}

              <div className="card" style={{ borderColor: isAdmin ? "var(--border)" : "#fecaca" }}>
                <strong>Xử lý tài khoản</strong>
                {isAdmin ? (
                  <p className="muted" style={{ marginTop: 8 }}>
                    Đây là tài khoản admin — không thể ban hoặc xóa.
                  </p>
                ) : (
                  <>
                    {!isBanned ? (
                      <div style={{ marginTop: 10 }}>
                        <input
                          className="search"
                          placeholder="Lý do ban (lưu lại, tuỳ chọn)"
                          value={banReason}
                          onChange={(e) => setBanReason(e.target.value)}
                        />
                        <button className="btn btn-danger" disabled={busy} onClick={ban}>Ban tài khoản</button>
                      </div>
                    ) : (
                      <div style={{ marginTop: 10 }}>
                        <button className="btn btn-ok" disabled={busy} onClick={unban}>Gỡ ban</button>
                      </div>
                    )}
                    <hr style={{ border: 0, borderTop: "1px solid var(--border)", margin: "16px 0" }} />
                    <p className="muted">
                      Xóa vĩnh viễn tài khoản cùng lịch hẹn, chat, report, đánh giá, hồ sơ PTG liên quan. Không hoàn tác được.
                      Nhập <code>{profile.username || profile.email || "XOA"}</code> để xác nhận.
                    </p>
                    <input
                      className="search"
                      style={{ marginTop: 8 }}
                      value={confirmDelete}
                      onChange={(e) => setConfirmDelete(e.target.value)}
                      placeholder="Nhập để xác nhận"
                    />
                    <button
                      className="btn btn-danger"
                      disabled={busy || confirmDelete.trim() !== (profile.username || profile.email || "XOA")}
                      onClick={remove}
                    >
                      Xóa tài khoản và mọi dữ liệu liên quan
                    </button>
                  </>
                )}
              </div>
            </>
          )}

          {tab === "tx" && (
            <>
              <div className="grid grid-3" style={{ marginBottom: 14 }}>
                <div className="stat"><div className="n">{bookings.length}</div><div className="l">Tổng lịch hẹn</div></div>
                <div className="stat"><div className="n">{paidBookings.length}</div><div className="l">Đã thanh toán</div></div>
                <div className="stat">
                  <div className="n" style={{ fontSize: 20 }}>{money(paidBookings.reduce((s, b) => s + Number(b.package_price || 0), 0))}</div>
                  <div className="l">Tổng giá trị đã thu</div>
                </div>
              </div>
              {bookings.length === 0 ? <div className="card">Chưa có lịch hẹn.</div> : (
                <div className="card" style={{ padding: 0, overflow: "auto" }}>
                  <table className="table">
                    <thead>
                      <tr><th>Tạo lúc</th><th>Vai trò</th><th>Đối tác</th><th>Gói</th><th>Giá</th><th>Trạng thái</th><th>Mã bill</th></tr>
                    </thead>
                    <tbody>
                      {bookings.map((b) => {
                        const asClient = b.client_id === userId;
                        const otherId = asClient ? b.photographer_user_id : b.client_id;
                        return (
                          <tr key={b.id}>
                            <td style={{ fontSize: 12, whiteSpace: "nowrap" }}>{fmt(b.created_at)}</td>
                            <td>{asClient ? "Khách" : "PTG"}</td>
                            <td>
                              {otherId ? (
                                <a href="#" onClick={(e) => { e.preventDefault(); onOpenUser(otherId); }}>
                                  {asClient ? b.photographer_name : b.client_name || nameOf(otherId)}
                                </a>
                              ) : (asClient ? b.photographer_name : b.client_name) || "—"}
                            </td>
                            <td>{b.package_name}<div className="muted" style={{ fontSize: 11 }}>{b.booking_date}</div></td>
                            <td style={{ fontWeight: 700 }}>{money(b.package_price)}</td>
                            <td><span className={`badge ${isPaid(b) ? "ok" : "draft"}`}>{b.status}</span></td>
                            <td><code style={{ fontSize: 11 }}>{b.payment_ref || "—"}</code></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {logs.length > 0 && (
                <>
                  <h3 style={{ margin: "18px 0 8px" }}>Log thanh toán liên quan</h3>
                  <div className="card" style={{ padding: 0, overflow: "auto" }}>
                    <table className="table">
                      <thead><tr><th>Thời gian</th><th>Mã</th><th>Số tiền</th><th>Kết quả</th><th>Ghi chú</th></tr></thead>
                      <tbody>
                        {logs.map((l) => (
                          <tr key={l.id}>
                            <td style={{ fontSize: 12 }}>{fmt(l.created_at)}</td>
                            <td><code>{l.bill_code || "—"}</code></td>
                            <td style={{ fontWeight: 700 }}>{money(l.amount)}</td>
                            <td>{l.result}</td>
                            <td style={{ fontSize: 12 }}>{l.note || ""}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </>
          )}

          {tab === "chat" && (
            <>
              <div className="card" style={{ fontSize: 13 }}>
                Admin không đọc được tin nhắn của người dùng. Chỉ xem được hội thoại khi có người báo cáo
                (ảnh chụp tại thời điểm báo cáo).
              </div>
              {chatError && (
                <div className="card" style={{ color: "#b91c1c" }}>
                  {chatError}
                  <p className="muted">Cần chạy <code>sql/032_chat_realtime.sql</code>.</p>
                </div>
              )}
              {!chatError && chatReports.length === 0 && <div className="card">Chưa có hội thoại nào của tài khoản này bị báo cáo.</div>}
              {chatReports.map((r) => {
                const against = r.reported_user_id === userId;
                const other = against ? r.reporter_id : r.reported_user_id;
                const open = openChatReport === r.id;
                return (
                  <div className="card" key={r.id}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                      <span>
                        {against ? "Bị báo cáo bởi" : "Đã báo cáo"}{" "}
                        <a href="#" onClick={(e) => { e.preventDefault(); onOpenUser(other); }}>{nameOf(other)}</a>
                      </span>
                      <span className={`badge ${r.status === "open" ? "warn" : r.status === "reviewed" ? "ok" : "draft"}`}>{r.status}</span>
                    </div>
                    <p style={{ fontSize: 13, whiteSpace: "pre-wrap", overflowWrap: "anywhere", margin: "8px 0" }}>{r.description}</p>
                    <div className="muted" style={{ fontSize: 11 }}>{fmt(r.created_at)} · {r.transcript?.length || 0} tin nhắn</div>
                    <button className="btn btn-ghost" style={{ marginTop: 8 }} onClick={() => setOpenChatReport(open ? null : r.id)}>
                      {open ? "Ẩn hội thoại" : "Xem hội thoại"}
                    </button>
                    {open && <div style={{ marginTop: 10 }}><Transcript list={r.transcript} reporterId={r.reporter_id} nameOf={nameOf} /></div>}
                  </div>
                );
              })}
            </>
          )}

          {tab === "reports" && (
            <>
              <h3 style={{ margin: "0 0 8px" }}>Báo cáo nhắm vào tài khoản này ({reportsAgainst.length})</h3>
              <ReportList list={reportsAgainst} nameOf={nameOf} otherKey="reporter_id" otherLabel="Người báo cáo" onOpenUser={onOpenUser} />
              <h3 style={{ margin: "18px 0 8px" }}>Báo cáo do tài khoản này gửi ({reportsBy.length})</h3>
              <ReportList list={reportsBy} nameOf={nameOf} otherKey="reported_user_id" otherLabel="Người bị báo cáo" onOpenUser={onOpenUser} />
            </>
          )}
        </>
      )}
    </>
  );
}

function Field({ label, v }: { label: string; v?: string | null }) {
  return (
    <div className="field">
      <label>{label}</label>
      <p>{v || "—"}</p>
    </div>
  );
}

function ReportList({
  list, nameOf, otherKey, otherLabel, onOpenUser,
}: {
  list: Report[];
  nameOf: (id: string) => string;
  otherKey: "reporter_id" | "reported_user_id";
  otherLabel: string;
  onOpenUser: (id: string) => void;
}) {
  if (list.length === 0) return <div className="card muted">Không có.</div>;
  return (
    <>
      {list.map((r) => (
        <div className="card" key={r.id}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
            <span>
              {otherLabel}:{" "}
              <a href="#" onClick={(e) => { e.preventDefault(); onOpenUser(r[otherKey]); }}>{nameOf(r[otherKey])}</a>
            </span>
            <span className={`badge ${r.status === "open" ? "warn" : r.status === "reviewed" ? "ok" : "draft"}`}>{r.status}</span>
          </div>
          <p style={{ fontWeight: 700, fontSize: 13, margin: "8px 0 2px" }}>{r.reason}</p>
          <div style={{ fontSize: 13, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{r.description}</div>
          <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>{fmt(r.created_at)}</div>
        </div>
      ))}
    </>
  );
}
