import { useEffect, useState } from "react";
import { supabase, type Application } from "../lib/supabase";

export default function ApplicationDetail({
  userId,
  onBack,
  onOpenHistory,
  onOpenChat,
}: {
  userId: string;
  onBack: () => void;
  onOpenHistory: (mode: "transactions" | "bookings") => void;
  onOpenChat?: (t: { userId: string; name: string; avatar?: string | null }) => void;
}) {
  const [app, setApp] = useState<Application | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
      .from("photographer_applications")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (err) setError(err.message);
    else {
      const row = data as Application;
      setApp(row);
      setNote(row?.admin_note || row?.reviewer_note || "");
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, [userId]);

  async function decide(status: "approved" | "rejected") {
    if (!app) return;
    const ok = window.confirm(
      status === "approved"
        ? `Duyệt hồ sơ của ${app.full_name || userId}?\n→ Role photographer + hiện trên marketplace (Search/Home).`
        : `Từ chối hồ sơ của ${app.full_name || userId}?`
    );
    if (!ok) return;

    setBusy(true);
    setMsg(null);
    setError(null);

    // RPC security definer: update status + publish/unpublish photographers
    const { data, error: rpcErr } = await supabase.rpc("admin_set_application_status", {
      p_user_id: userId,
      p_status: status,
      p_note: note.trim() || null,
    });

    if (rpcErr) {
      setError(rpcErr.message + " — Chạy sql/014_admin_approve_and_publish.sql trên Supabase.");
      setBusy(false);
      return;
    }

    setMsg(
      status === "approved"
        ? "Đã duyệt: profile đã publish lên marketplace, user khác tìm/filter được."
        : "Đã từ chối hồ sơ."
    );
    console.log("[admin decide]", data);
    setBusy(false);
    await load();
  }

  if (loading) return <p className="muted">Đang tải hồ sơ...</p>;
  if (error && !app) {
    return (
      <div>
        <button className="btn btn-ghost" onClick={onBack}>← Quay lại</button>
        <div className="card" style={{ color: "var(--danger)", marginTop: 12 }}>{error}</div>
      </div>
    );
  }
  if (!app) {
    return (
      <div>
        <button className="btn btn-ghost" onClick={onBack}>← Quay lại</button>
        <div className="card muted" style={{ marginTop: 12 }}>Không tìm thấy hồ sơ.</div>
      </div>
    );
  }

  const pins = [
    ...(app.standalone_pins || []),
    ...(app.boards || []).flatMap((b) => b.pins || []),
    ...(app.rental_pins || []),
    ...(app.rental_boards || []).flatMap((b) => b.pins || []),
  ].filter(Boolean);

  return (
    <div>
      <div className="topbar">
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <button className="btn btn-ghost" onClick={onBack}>← Quay lại</button>
          <h2 style={{ margin: 0 }}>{app.full_name || "Hồ sơ PTG"}</h2>
          <span className={`badge ${app.status}`}>{app.status}</span>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => onOpenHistory?.("transactions")}
            title="Toàn bộ tiền đã thu từ khách của PTG này"
          >
            Lịch sử giao dịch
          </button>
          <button
            type="button"
            className="btn"
            style={{ background: "#0f766e", color: "white" }}
            onClick={() =>
              onOpenChat?.({
                userId,
                name: app.full_name || userId.slice(0, 8),
                avatar: app.avatar_url,
              })
            }
          >
            💬 Chat
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => onOpenHistory?.("bookings")}
            title="Mọi lịch hẹn + trạng thái chi tiết"
          >
            Lịch hẹn
          </button>
        </div>
      </div>

      {msg && <div className="card" style={{ borderColor: "#86efac", background: "#f0fdf4" }}>{msg}</div>}
      {error && <div className="card" style={{ color: "var(--danger)" }}>{error}</div>}

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        {app.banner_url ? (
          <img src={app.banner_url} alt="banner" className="banner-preview" style={{ borderRadius: 0, border: "none" }} />
        ) : (
          <div className="banner-preview" style={{ borderRadius: 0, border: "none", height: 120 }} />
        )}
        <div style={{ padding: 16, display: "flex", gap: 14, alignItems: "center", marginTop: -36 }}>
          {app.avatar_url ? (
            <img src={app.avatar_url} alt="" className="avatar-lg" />
          ) : (
            <div className="avatar-lg" />
          )}
          <div>
            <div style={{ fontWeight: 800, fontSize: 18 }}>{app.full_name || "—"}</div>
            <div className="muted">{app.phone || "—"} · {userId}</div>
          </div>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <h3 style={{ marginTop: 0, fontSize: 15 }}>Thông tin</h3>
          <Field label="Ngày sinh" value={app.birth_date} />
          <Field label="Khu vực" value={(app.work_locations || []).join(", ")} />
          <Field label="Kinh nghiệm" value={app.experience_years} />
          <Field label="Mô hình" value={app.work_model} />
          <Field label="Ngôn ngữ" value={(app.languages || []).join(", ")} />
          <Field label="Thiết bị" value={app.equipment} />
          <Field label="Styles" value={(app.selected_styles || []).join(", ")} />
          <Field
            label="Skills"
            value={[
              app.skill_makeup ? "Makeup" : null,
              app.skill_edit ? "Edit" : null,
              app.skill_rental ? "Rental" : null,
            ].filter(Boolean).join(" · ") || "—"}
          />
          <Field label="Link minh chứng" value={app.proof_link} link />
          <Field label="Gửi lúc" value={app.submitted_at ? new Date(app.submitted_at).toLocaleString("vi-VN") : null} />
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0, fontSize: 15 }}>Giới thiệu</h3>
          <Field label="Bio" value={app.bio} />
          <Field label="Mô tả phong cách" value={app.style_description} />
          <Field label="Chi tiết KN" value={app.experience_detail} />
          <h3 style={{ fontSize: 15 }}>Bảng giá</h3>
          <PriceGroups groups={app.price_groups} />
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0, fontSize: 15 }}>CCCD</h3>
        <div className="thumb-row">
          {app.cccd_front_url ? (
            <a href={app.cccd_front_url} target="_blank" rel="noreferrer"><img src={app.cccd_front_url} alt="trước" /></a>
          ) : <span className="muted">Chưa có mặt trước</span>}
          {app.cccd_back_url ? (
            <a href={app.cccd_back_url} target="_blank" rel="noreferrer"><img src={app.cccd_back_url} alt="sau" /></a>
          ) : <span className="muted">Chưa có mặt sau</span>}
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0, fontSize: 15 }}>Portfolio + Rental ({pins.length} ảnh)</h3>
        {pins.length === 0 ? (
          <p className="muted">Chưa có ảnh</p>
        ) : (
          <div className="thumb-row">
            {pins.map((url, i) => (
              <a key={url + i} href={url} target="_blank" rel="noreferrer">
                <img src={url} alt="" />
              </a>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0, fontSize: 15 }}>Duyệt hồ sơ</h3>
        <label className="muted" style={{ display: "block", marginBottom: 6, fontWeight: 700 }}>
          Ghi chú admin (hiện trên app user khi bị từ chối / chờ)
        </label>
        <textarea className="note" value={note} onChange={(e) => setNote(e.target.value)}
          placeholder="Lý do từ chối / ghi chú nội bộ..." />
        <div className="actions">
          <button className="btn btn-ok" disabled={busy || app.status === "approved"}
            onClick={() => decide("approved")}>
            ✓ Chấp nhận → publish marketplace
          </button>
          <button className="btn btn-danger" disabled={busy || app.status === "rejected"}
            onClick={() => decide("rejected")}>
            ✕ Từ chối
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, link }: { label: string; value?: string | null; link?: boolean }) {
  return (
    <div className="field">
      <label>{label}</label>
      {link && value ? (
        <a href={value} target="_blank" rel="noreferrer">{value}</a>
      ) : (
        <p style={{ whiteSpace: "pre-wrap" }}>{value || "—"}</p>
      )}
    </div>
  );
}

type PriceLine = { id?: string; name?: string; price?: string | number; detail?: string };
type PriceGroup = { id?: string; title?: string; category?: string; lines?: PriceLine[] };

const CATEGORY_LABEL: Record<string, string> = {
  photo: "Chụp ảnh",
  rental: "Thuê studio / đồ",
  makeup: "Makeup",
  edit: "Chỉnh sửa",
  editor: "Chỉnh sửa",
  others: "Khác (tự đặt)",
};

function formatVnd(v?: string | number) {
  const n = Number(String(v ?? "").replace(/[^0-9.]/g, ""));
  return n ? n.toLocaleString("vi-VN") + " đ" : "—";
}

function PriceGroups({ groups }: { groups: unknown[] | null | undefined }) {
  const list = (groups || []) as PriceGroup[];
  if (list.length === 0) return <p className="muted">Chưa có bảng giá</p>;
  return (
    <div>
      {list.map((g, i) => (
        <div key={g.id || i} style={{ marginBottom: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>
            {g.title || "Nhóm giá"}
            {g.category && (
              <span className="muted" style={{ marginLeft: 8, fontWeight: 400 }}>
                ({CATEGORY_LABEL[g.category] || g.category})
              </span>
            )}
          </div>
          <table>
            <tbody>
              {(g.lines || []).map((l, j) => (
                <tr key={l.id || j}>
                  <td>
                    {l.name || "—"}
                    {l.detail ? <div className="muted">{l.detail}</div> : null}
                  </td>
                  <td style={{ textAlign: "right", fontWeight: 700, whiteSpace: "nowrap" }}>
                    {formatVnd(l.price)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
