import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import PayoutCard from "../components/PayoutCard";
import {
  ADV_PCT,
  COMM_PCT,
  FINAL_PCT,
  PTG_PCT,
  calcAdvance,
  calcFee,
  calcFinal,
  fetchPtgBanks,
  formatVnd,
  type BankLookup,
} from "../lib/payout";

type Booking = {
  id: string;
  client_id: string;
  client_name: string | null;
  client_avatar: string | null;
  photographer_user_id: string | null;
  photographer_id: number | null;
  photographer_name: string;
  package_name: string;
  package_price: number;
  booking_date: string;
  start_time: string;
  end_time: string;
  client_note: string | null;
  ptg_note: string | null;
  status: string;
  payment_status: string | null;
  payment_ref: string | null;
  paid_at: string | null;
  deposit_paid_at: string | null;
  ptg_advance_paid_at: string | null;
  ptg_final_paid_at: string | null;
  drive_url: string | null;
  drive_submitted_at: string | null;
  handover_note: string | null;
  client_approved_at: string | null;
  client_success_at: string | null;
  ptg_success_at: string | null;
  drive_released_at: string | null;
  shoot_done_at: string | null;
  shoot_confirm_client_at?: string | null;
  shoot_confirm_ptg_at?: string | null;
  updated_at?: string | null;
  created_at: string;
  /** "request" = đơn chụp đăng bài (khách chốt PTG từ bài tìm PTG) · "direct" = đơn khách chọn tôi */
  source?: "direct" | "request" | null;
  request_id?: string | null;
};

type SourceFilter = "all" | "request" | "direct";
const SOURCE_FILTERS: { id: SourceFilter; label: string }[] = [
  { id: "all", label: "Mọi loại đơn" },
  { id: "request", label: "📢 Đơn chụp đăng bài" },
  { id: "direct", label: "⭐ Đơn khách chọn tôi" },
];

/** Pipeline stages — chỉ hiện action của bước hiện tại */
type Stage =
  | "await_ptg"
  | "await_pay"
  | "need_advance" // user paid → admin chuyển cọc (ADVANCE_RATE)
  | "active"
  | "handover"
  | "await_dual_confirm"
  | "need_final" // both confirmed → admin chuyển phần còn lại
  | "need_release" // final paid → admin gửi drive user
  | "done"
  | "rejected";

const SILENCE_HOURS = 48;

type FilterId = Stage | "all" | "action" | "late";

const STAGE_FILTERS: { id: FilterId; label: string }[] = [
  { id: "action", label: "Cần xử lý" },
  { id: "late", label: `Im lặng > ${SILENCE_HOURS}h` },
  { id: "all", label: "Tất cả" },
  { id: "need_advance", label: `Chuyển cọc ${ADV_PCT}%` },
  { id: "active", label: "Đang hiệu lực" },
  { id: "handover", label: "Bàn giao" },
  { id: "await_dual_confirm", label: "Chờ 2 bên xác nhận" },
  { id: "need_final", label: `Chuyển ${FINAL_PCT}%` },
  { id: "need_release", label: "Gửi Drive user" },
  { id: "done", label: "Hoàn thành" },
];

function stageOf(b: Booking): Stage {
  if (b.status === "rejected" || b.status === "cancelled") return "rejected";
  if (b.status === "completed" || b.drive_released_at) return "done";
  if (b.ptg_final_paid_at && !b.drive_released_at) return "need_release";
  if (b.client_success_at && b.ptg_success_at && !b.ptg_final_paid_at) return "need_final";
  if (b.status === "closing" && b.client_success_at && b.ptg_success_at && !b.ptg_final_paid_at)
    return "need_final";
  if (
    (b.status === "handover" || b.status === "closing" || b.drive_url) &&
    !(b.client_success_at && b.ptg_success_at)
  )
    return "await_dual_confirm";
  if (b.status === "handover" || (b.drive_url && !b.client_success_at && !b.ptg_success_at))
    return "handover";
  if (b.status === "active" || (b.ptg_advance_paid_at && !b.drive_url)) return "active";
  if (
    b.status === "processing" ||
    ((b.status === "deposit_paid" || b.status === "paid" || b.deposit_paid_at) &&
      !b.ptg_advance_paid_at)
  )
    return "need_advance";
  if (b.status === "confirmed") return "await_pay";
  if (b.status === "pending") return "await_ptg";
  return "active";
}

function stageLabel(s: Stage) {
  const map: Record<Stage, string> = {
    await_ptg: "Chờ PTG nhận đơn",
    await_pay: "Chờ khách thanh toán",
    need_advance: `Cần chuyển cọc ${ADV_PCT}% cho PTG`,
    active: "Đơn đang hiệu lực",
    handover: "Bàn giao ảnh",
    await_dual_confirm: "Chờ 2 bên xác nhận hoàn tất",
    need_final: `Cần chuyển ${FINAL_PCT}% còn lại cho PTG`,
    need_release: "Cần gửi Drive cho user",
    done: "Hoàn thành đơn",
    rejected: "Từ chối / Hủy",
  };
  return map[s];
}

function stageColor(s: Stage) {
  if (s === "done") return "#16a34a";
  if (s === "rejected") return "#ef4444";
  if (s === "need_advance" || s === "need_final" || s === "need_release") return "#f59e0b";
  return "#0c3d35";
}

/* ───────── Timeline từng bước + phát hiện bên im lặng ───────── */

function todayVN(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function fmtTime(iso?: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
}

const hoursSince = (iso: string) => (Date.now() - new Date(iso).getTime()) / 3600000;

type FlowStepInfo = {
  label: string;
  done: boolean;
  /** dòng phụ: ai đã / chưa xác nhận */
  chips?: { who: string; at?: string | null; late?: boolean }[];
  note?: string;
  late?: boolean;
};

type FlowInfo = { steps: FlowStepInfo[]; currentIdx: number; late: boolean; lateText: string | null };

function flowInfo(b: Booking): FlowInfo {
  const bothShoot = !!(b.shoot_confirm_client_at && b.shoot_confirm_ptg_at) || !!b.shoot_done_at;
  const bothFinal = !!(b.client_success_at && b.ptg_success_at);
  const shootDay = (b.booking_date || "").slice(0, 10) <= todayVN();
  let lateText: string | null = null;

  // Bước 3: xác nhận buổi chụp
  let shootLate = false;
  let shootNote: string | undefined;
  if (!bothShoot) {
    if (!shootDay) shootNote = `Chưa đến ngày chụp (${b.booking_date})`;
    else if (b.shoot_confirm_client_at && !b.shoot_confirm_ptg_at) {
      shootLate = hoursSince(b.shoot_confirm_client_at) > SILENCE_HOURS;
      if (shootLate) lateText = `PTG chưa xác nhận buổi chụp hơn ${SILENCE_HOURS} giờ`;
    } else if (b.shoot_confirm_ptg_at && !b.shoot_confirm_client_at) {
      shootLate = hoursSince(b.shoot_confirm_ptg_at) > SILENCE_HOURS;
      if (shootLate) lateText = `Khách chưa xác nhận buổi chụp hơn ${SILENCE_HOURS} giờ`;
    } else {
      // chưa ai xác nhận: tính từ hết ngày chụp
      const end = new Date(`${(b.booking_date || "").slice(0, 10)}T23:59:59+07:00`).getTime();
      shootLate = Date.now() - end > SILENCE_HOURS * 3600000;
      if (shootLate) lateText = `Chưa bên nào xác nhận buổi chụp, quá ${SILENCE_HOURS} giờ sau ngày chụp`;
    }
  }

  // Bước 4: PTG gửi Drive
  let driveLate = false;
  if (bothShoot && !b.drive_url) {
    const a = b.shoot_confirm_client_at || "";
    const p = b.shoot_confirm_ptg_at || "";
    const since = (a > p ? a : p) || b.shoot_done_at || b.updated_at || null;
    if (since && hoursSince(since) > SILENCE_HOURS) {
      driveLate = true;
      lateText = `PTG chưa gửi link Drive hơn ${SILENCE_HOURS} giờ`;
    }
  }

  // Bước 5: xác nhận hoàn tất
  let finalLate = false;
  if (b.drive_url && !bothFinal) {
    if (b.client_success_at && !b.ptg_success_at && hoursSince(b.client_success_at) > SILENCE_HOURS) {
      finalLate = true;
      lateText = `PTG chưa xác nhận hoàn tất hơn ${SILENCE_HOURS} giờ`;
    } else if (b.ptg_success_at && !b.client_success_at && hoursSince(b.ptg_success_at) > SILENCE_HOURS) {
      finalLate = true;
      lateText = `Khách chưa xác nhận hoàn tất hơn ${SILENCE_HOURS} giờ (khách im → vẫn trả PTG, giao ảnh cho khách)`;
    }
  }

  const steps: FlowStepInfo[] = [
    { label: "Khách thanh toán", done: !!b.deposit_paid_at, note: fmtTime(b.deposit_paid_at) },
    { label: "Admin ứng cọc cho PTG", done: !!b.ptg_advance_paid_at, note: fmtTime(b.ptg_advance_paid_at) },
    {
      label: "Xác nhận buổi chụp xong (2 bên)",
      done: bothShoot,
      note: shootNote,
      late: shootLate,
      chips: bothShoot && !b.shoot_confirm_client_at && !b.shoot_confirm_ptg_at
        ? [{ who: "Khách", at: b.shoot_done_at }, { who: "PTG", at: b.shoot_done_at }]
        : [
            { who: "Khách", at: b.shoot_confirm_client_at, late: shootLate && !b.shoot_confirm_client_at },
            { who: "PTG", at: b.shoot_confirm_ptg_at, late: shootLate && !b.shoot_confirm_ptg_at },
          ],
    },
    { label: "PTG gửi link Drive", done: !!b.drive_url, late: driveLate, note: fmtTime(b.drive_submitted_at) },
    {
      label: "Xác nhận hoàn tất đơn (2 bên)",
      done: bothFinal,
      late: finalLate,
      chips: [
        { who: "Khách", at: b.client_success_at, late: finalLate && !b.client_success_at },
        { who: "PTG", at: b.ptg_success_at, late: finalLate && !b.ptg_success_at },
      ],
    },
    { label: "Admin chuyển phần còn lại cho PTG", done: !!b.ptg_final_paid_at, note: fmtTime(b.ptg_final_paid_at) },
    { label: "Admin gửi Drive cho khách", done: !!b.drive_released_at, note: fmtTime(b.drive_released_at) },
  ];
  const idx = steps.findIndex((s) => !s.done);
  return { steps, currentIdx: idx === -1 ? steps.length : idx, late: !!lateText, lateText };
}

function FlowTimeline({ b }: { b: Booking }) {
  const f = flowInfo(b);
  return (
    <div className="flow">
      <div className="flow-title">Tiến trình đơn</div>
      {f.lateText && (
        <div style={{ color: "#b91c1c", fontWeight: 700, fontSize: 12, marginBottom: 6 }}>
          ⚠️ {f.lateText}. Kiểm tra mục «Xử lý report» nếu có báo cáo của đơn này.
        </div>
      )}
      {f.steps.map((s, i) => {
        const cls = s.done ? "done" : s.late ? "late" : i === f.currentIdx ? "now" : "";
        return (
          <div key={s.label} className={`flow-step ${cls}`}>
            <span className="flow-mark">{s.done ? "✓" : i + 1}</span>
            <div>
              <div style={{ fontWeight: s.done || i === f.currentIdx ? 700 : 500 }}>{s.label}</div>
              {s.chips && (
                <div style={{ marginTop: 2 }}>
                  {s.chips.map((c) => (
                    <span key={c.who} className={`who-chip ${c.at ? "ok" : c.late ? "late" : "wait"}`}>
                      {c.who}: {c.at ? `✓ ${fmtTime(c.at)}` : "chưa"}
                    </span>
                  ))}
                </div>
              )}
              {s.note && <div className="flow-sub">{s.note}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Đơn đã vào giai đoạn chụp trở đi → hiện timeline */
function showFlow(st: Stage): boolean {
  return ["active", "handover", "await_dual_confirm", "need_final", "need_release", "done"].includes(st);
}

export default function Bookings() {
  const [rows, setRows] = useState<Booking[]>([]);
  const [bankLookup, setBankLookup] = useState<BankLookup | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterId>("action");
  const [q, setQ] = useState("");
  const [source, setSource] = useState<SourceFilter>("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
      .from("bookings")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(300);
    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }
    const list = (data as Booking[]) || [];
    setRows(list);

    // Chỉ cần thông tin ngân hàng cho các đơn đang chờ admin chuyển tiền
    const needBank = list.filter((r) => ["need_advance", "need_final"].includes(stageOf(r)));
    setBankLookup(needBank.length ? await fetchPtgBanks(needBank) : { byBooking: {}, userOf: {}, errors: [] });
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    let list = rows;
    if (source !== "all") list = list.filter((b) => (b.source === "request" ? "request" : "direct") === source);
    if (filter === "action") {
      list = list.filter(
        (b) =>
          ["need_advance", "need_final", "need_release", "await_dual_confirm"].includes(stageOf(b)) ||
          (showFlow(stageOf(b)) && flowInfo(b).late)
      );
    } else if (filter === "late") {
      list = list.filter((b) => showFlow(stageOf(b)) && stageOf(b) !== "done" && flowInfo(b).late);
    } else if (filter !== "all") {
      list = list.filter((b) => stageOf(b) === filter);
    }
    const s = q.trim().toLowerCase();
    if (s) {
      list = list.filter(
        (b) =>
          (b.client_name || "").toLowerCase().includes(s) ||
          (b.photographer_name || "").toLowerCase().includes(s) ||
          (b.package_name || "").toLowerCase().includes(s) ||
          (b.payment_ref || "").toLowerCase().includes(s) ||
          b.id.toLowerCase().includes(s)
      );
    }
    return list;
  }, [rows, filter, q, source]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { action: 0 };
    for (const b of rows) {
      const s = stageOf(b);
      c[s] = (c[s] || 0) + 1;
      const late = showFlow(s) && s !== "done" && flowInfo(b).late;
      if (late) c.late = (c.late || 0) + 1;
      if (["need_advance", "need_final", "need_release", "await_dual_confirm"].includes(s) || late) c.action++;
    }
    return c;
  }, [rows]);

  /**
   * Cập nhật đơn. `requireNull` = tên cột phải đang trống thì mới ghi (chặn xác nhận 2 lần / 2 admin cùng lúc).
   * Supabase không báo lỗi khi RLS chặn hoặc không có dòng nào khớp, nên phải tự kiểm tra số dòng bị đổi.
   */
  async function patch(id: string, body: Record<string, unknown>, requireNull?: string) {
    setBusy(id);
    setMsg(null);
    setError(null);
    let q = supabase
      .from("bookings")
      .update({ ...body, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (requireNull) q = q.is(requireNull, null);
    const { data, error: err } = await q.select("id");
    setBusy(null);
    if (err) {
      setError(err.message);
    } else if (!data || data.length === 0) {
      setError(
        "Không cập nhật được đơn (0 dòng bị đổi): đơn đã được xử lý trước đó, hoặc tài khoản này không có quyền sửa bảng bookings. Bấm «Làm mới» để xem trạng thái thật.",
      );
    } else {
      setMsg("Đã cập nhật");
      await load();
    }
  }

  /** Lý do không có thông tin ngân hàng của PTG (hiện trong PayoutCard) */
  function bankProblem(b: Booking): string | null {
    if (!bankLookup) return "Đang tải thông tin ngân hàng…";
    if (bankLookup.errors.length) {
      return `Không đọc được dữ liệu ngân hàng: ${bankLookup.errors.join("; ")}. Thường do tài khoản đăng nhập chưa có quyền admin (RLS) hoặc sai tên cột.`;
    }
    if (!bankLookup.userOf[b.id]) {
      return "Đơn này chưa gắn tài khoản photographer (photographer_user_id trống) và không tra được qua photographer_id, nên không biết lấy số tài khoản của ai. Gắn lại photographer cho đơn rồi bấm «Làm mới».";
    }
    return "Photographer chưa nhập số tài khoản ngân hàng (cả hồ sơ đăng ký lẫn trang photographer). Nhờ họ cập nhật trong Cài đặt, rồi bấm «Làm mới».";
  }

  async function markUserPaid(b: Booking) {
    if (!confirm("Xác nhận đã nhận đủ tiền user chuyển khoản?")) return;
    await patch(b.id, {
      status: "processing",
      payment_status: "deposit_paid",
      deposit_paid_at: new Date().toISOString(),
      paid_at: new Date().toISOString(),
    }, "deposit_paid_at");
  }

  async function payAdvance(b: Booking) {
    const amt = calcAdvance(b.package_price);
    if (
      !confirm(
        `Xác nhận đã chuyển ${formatVnd(amt)} (${ADV_PCT}% cọc) cho ${b.photographer_name}?\nĐơn sẽ chuyển sang «Đang hiệu lực».`
      )
    )
      return;
    await patch(b.id, {
      status: "active",
      ptg_advance_paid_at: new Date().toISOString(),
    }, "ptg_advance_paid_at");
  }

  async function payFinal(b: Booking) {
    if (!b.client_success_at || !b.ptg_success_at) {
      setError(`Cần cả 2 bên xác nhận hoàn tất trước khi chuyển ${FINAL_PCT}%.`);
      return;
    }
    const amt = calcFinal(b.package_price);
    if (
      !confirm(
        `Xác nhận đã chuyển ${formatVnd(amt)} (${FINAL_PCT}%) cho ${b.photographer_name}?\n(PTG tổng nhận ${PTG_PCT}%, Memento giữ phí ${COMM_PCT}% = ${formatVnd(calcFee(b.package_price))})`
      )
    )
      return;
    await patch(b.id, {
      status: "closing",
      ptg_final_paid_at: new Date().toISOString(),
      payment_status: "fully_paid",
    }, "ptg_final_paid_at");
  }

  async function releaseDrive(b: Booking) {
    if (!b.ptg_final_paid_at) {
      setError(`Cần chuyển ${FINAL_PCT}% cho PTG trước khi gửi Drive cho user.`);
      return;
    }
    if (!b.drive_url) {
      setError("Chưa có link Drive từ photographer.");
      return;
    }
    if (!confirm("Gửi Drive đầy đủ cho user và đánh dấu hoàn thành đơn?")) return;
    await patch(b.id, {
      status: "completed",
      drive_released_at: new Date().toISOString(),
      final_paid_at: new Date().toISOString(),
      payment_status: "fully_paid",
    }, "drive_released_at");
  }

  return (
    <>
      <div className="topbar">
        <h2>Quản lý đơn (pipeline)</h2>
        <button className="btn btn-ghost" onClick={load} type="button">
          Làm mới
        </button>
      </div>

      <div className="card" style={{ marginBottom: 14, fontSize: 13, lineHeight: 1.55 }}>
        <strong>Thứ tự bắt buộc (không nhảy bước):</strong>
        <br />
        PTG nhận đơn → User thanh toán 100% → <strong>Admin chuyển {ADV_PCT}% cọc PTG</strong> → Đơn hiệu lực →
        <strong>Đến ngày chụp: 2 bên xác nhận buổi chụp</strong> → PTG gửi Drive → <strong>2 bên xác nhận hoàn tất</strong> → <strong>Admin chuyển {FINAL_PCT}%</strong> →{" "}
        <strong>Admin gửi Drive user</strong> → Hoàn thành.
        <br />
        App: sau khi user CK hiện «Đang xử lý đơn»; sau khi admin ứng {ADV_PCT}% hiện «Đơn đang hiệu lực».
      </div>

      {msg && (
        <div className="card" style={{ borderColor: "#86efac", background: "#f0fdf4", marginBottom: 12 }}>
          {msg}
        </div>
      )}
      {error && (
        <div className="card" style={{ color: "#b91c1c", marginBottom: 12 }}>
          {error}
        </div>
      )}

      <div className="tabs" style={{ marginBottom: 12 }}>
        {STAGE_FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            className={filter === f.id ? "active" : ""}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
            {f.id === "action" ? ` (${counts.action || 0})` : counts[f.id] ? ` (${counts[f.id]})` : ""}
          </button>
        ))}
      </div>

      <div className="tabs" style={{ marginBottom: 12 }}>
        {SOURCE_FILTERS.map((f) => (
          <button key={f.id} type="button" className={source === f.id ? "active" : ""} onClick={() => setSource(f.id)}>
            {f.label}
            {f.id !== "all" ? ` (${rows.filter((b) => (b.source === "request" ? "request" : "direct") === f.id).length})` : ""}
          </button>
        ))}
      </div>

      <input
        className="search"
        placeholder="Tìm khách, PTG, gói, mã bill…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      {loading ? (
        <p className="muted">Đang tải…</p>
      ) : filtered.length === 0 ? (
        <div className="card">Không có đơn ở bước này.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {filtered.map((b) => {
            const st = stageOf(b);
            const total = Number(b.package_price) || 0;
            const open = expanded === b.id;
            return (
              <div
                key={b.id}
                className="card"
                style={{
                  borderColor: stageColor(st),
                  borderWidth: 2,
                  borderStyle: "solid",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div>
                    <span
                      style={{
                        display: "inline-block",
                        fontSize: 11,
                        fontWeight: 700,
                        color: "#fff",
                        background: stageColor(st),
                        padding: "3px 10px",
                        borderRadius: 999,
                        marginBottom: 6,
                      }}
                    >
                      {stageLabel(st)}
                    </span>
                    <span
                      style={{
                        display: "inline-block", marginLeft: 6, fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 999, marginBottom: 6,
                        background: b.source === "request" ? "#ede9fe" : "#e0f2fe",
                        color: b.source === "request" ? "#5b21b6" : "#075985",
                      }}
                    >
                      {b.source === "request" ? "📢 Đơn chụp đăng bài" : "⭐ Khách chọn tôi"}
                    </span>
                    <div style={{ fontWeight: 800, fontSize: 15 }}>{b.package_name}</div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {b.booking_date} · {b.start_time}–{b.end_time} · #{b.id.slice(0, 8)}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontWeight: 800, fontSize: 16 }}>{formatVnd(total)}</div>
                    {b.payment_ref && (
                      <code style={{ fontSize: 11 }}>{b.payment_ref}</code>
                    )}
                  </div>
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 10,
                    marginTop: 12,
                    fontSize: 13,
                  }}
                >
                  <div style={{ background: "#f8faf9", borderRadius: 10, padding: 10 }}>
                    <div className="muted" style={{ fontSize: 11 }}>Khách</div>
                    <strong>{b.client_name || b.client_id.slice(0, 8)}</strong>
                    {b.client_success_at ? (
                      <div style={{ color: "#16a34a", fontSize: 11, marginTop: 4 }}>✓ Đã xác nhận hoàn tất</div>
                    ) : st === "await_dual_confirm" || st === "handover" ? (
                      <div style={{ color: "#b45309", fontSize: 11, marginTop: 4 }}>Chưa xác nhận</div>
                    ) : null}
                  </div>
                  <div style={{ background: "#f8faf9", borderRadius: 10, padding: 10 }}>
                    <div className="muted" style={{ fontSize: 11 }}>Photographer</div>
                    <strong>{b.photographer_name}</strong>
                    {b.ptg_success_at ? (
                      <div style={{ color: "#16a34a", fontSize: 11, marginTop: 4 }}>✓ Đã xác nhận hoàn tất</div>
                    ) : st === "await_dual_confirm" || st === "handover" ? (
                      <div style={{ color: "#b45309", fontSize: 11, marginTop: 4 }}>Chưa xác nhận</div>
                    ) : null}
                  </div>
                </div>

                {/* Money summary */}
                <div style={{ marginTop: 10, fontSize: 12, lineHeight: 1.5 }} className="muted">
                  Ứng {ADV_PCT}%: <strong>{formatVnd(calcAdvance(total))}</strong>
                  {b.ptg_advance_paid_at ? " ✓" : " — chưa"}
                  {" · "}
                  Còn {FINAL_PCT}%: <strong>{formatVnd(calcFinal(total))}</strong>
                  {b.ptg_final_paid_at ? " ✓" : " — chưa"}
                  {" · "}
                  Phí {COMM_PCT}%: <strong>{formatVnd(calcFee(total))}</strong>
                </div>

                {showFlow(st) && <FlowTimeline b={b} />}

                {(st === "need_advance" || st === "need_final") && (
                  <PayoutCard
                    title={
                      st === "need_advance"
                        ? `Chuyển cọc ${ADV_PCT}% cho photographer`
                        : `Chuyển ${FINAL_PCT}% còn lại cho photographer`
                    }
                    amount={st === "need_advance" ? calcAdvance(total) : calcFinal(total)}
                    content={`MMT ${st === "need_advance" ? "COC" : "QT"} ${b.id.slice(0, 8).toUpperCase()}`}
                    ptgName={b.photographer_name}
                    candidates={bankLookup?.byBooking[b.id] ?? []}
                    problem={bankProblem(b)}
                  />
                )}

                {b.drive_url && (
                  <div style={{ marginTop: 8, fontSize: 12 }}>
                    Drive:{" "}
                    <a href={b.drive_url} target="_blank" rel="noreferrer">
                      {b.drive_url}
                    </a>
                  </div>
                )}

                {/* ONLY current-step actions */}
                <div className="actions" style={{ marginTop: 12 }}>
                  {st === "await_pay" && (
                    <button
                      type="button"
                      className="btn btn-ok"
                      disabled={busy === b.id}
                      onClick={() => markUserPaid(b)}
                    >
                      ✓ Đã nhận tiền user → Đang xử lý
                    </button>
                  )}

                  {st === "need_advance" && (
                    <button
                      type="button"
                      className="btn btn-ok"
                      disabled={busy === b.id}
                      onClick={() => payAdvance(b)}
                    >
                      💸 Đã chuyển cọc {ADV_PCT}% ({formatVnd(calcAdvance(total))}) → Đơn hiệu lực
                    </button>
                  )}

                  {st === "await_dual_confirm" && (
                    <div style={{ fontSize: 12, color: "#92400e", width: "100%" }}>
                      Đang chờ xác nhận trên app:
                      <br />
                      Khách: {b.client_success_at ? "✓" : "…"} · PTG: {b.ptg_success_at ? "✓" : "…"}
                      <br />
                      <span className="muted">Chỉ khi đủ 2 ✓ mới hiện nút chuyển {FINAL_PCT}%.</span>
                    </div>
                  )}

                  {st === "need_final" && (
                    <button
                      type="button"
                      className="btn btn-ok"
                      disabled={busy === b.id}
                      onClick={() => payFinal(b)}
                    >
                      💸 Đã chuyển {FINAL_PCT}% ({formatVnd(calcFinal(total))}) cho PTG
                    </button>
                  )}

                  {st === "need_release" && (
                    <button
                      type="button"
                      className="btn btn-ok"
                      disabled={busy === b.id || !b.drive_url}
                      onClick={() => releaseDrive(b)}
                    >
                      📁 Gửi Drive cho user → Hoàn thành đơn
                    </button>
                  )}

                  {st === "done" && (
                    <span style={{ color: "#16a34a", fontWeight: 700, fontSize: 13 }}>✓ Đơn đã hoàn thành</span>
                  )}

                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => setExpanded(open ? null : b.id)}
                  >
                    {open ? "Thu gọn" : "Chi tiết"}
                  </button>
                </div>

                {open && (
                  <div style={{ marginTop: 12, fontSize: 12, lineHeight: 1.6 }} className="muted">
                    <div>Ghi chú khách: {b.client_note || "—"}</div>
                    <div>Ghi chú PTG: {b.ptg_note || "—"}</div>
                    <div>Status DB: {b.status}</div>
                    <div>deposit_paid_at: {b.deposit_paid_at || "—"}</div>
                    <div>ptg_advance_paid_at: {b.ptg_advance_paid_at || "—"}</div>
                    <div>shoot_confirm_client_at: {b.shoot_confirm_client_at || "—"}</div>
                    <div>shoot_confirm_ptg_at: {b.shoot_confirm_ptg_at || "—"}</div>
                    <div>client_success_at: {b.client_success_at || "—"}</div>
                    <div>ptg_success_at: {b.ptg_success_at || "—"}</div>
                    <div>ptg_final_paid_at: {b.ptg_final_paid_at || "—"}</div>
                    <div>drive_released_at: {b.drive_released_at || "—"}</div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
