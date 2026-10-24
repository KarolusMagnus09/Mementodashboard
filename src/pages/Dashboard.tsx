import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { supabase } from "../lib/supabase";
import { ADV_PCT, COMM_PCT, COMMISSION_RATE, formatVnd } from "../lib/payout";
import {
  BUCKET_LABEL,
  RANGES,
  buildPerson,
  computeStats,
  displayName,
  type Booking,
  type Bucket,
  type Data,
  type PayLog,
  type Profile,
  type RangeId,
  type RankRow,
  type TxRow,
  type Review,
  type Stats,
} from "../lib/dashboardStats";
import "./dashboard-v2.css";

/** URL nhúng báo cáo Looker Studio (nguồn GA4). Đặt trong .env: VITE_GA_EMBED_URL=... */
const GA_EMBED_URL = ((import.meta.env.VITE_GA_EMBED_URL as string | undefined) || "")
  .trim()
  // tên miền cũ datastudio.google.com chuyển hướng sang lookerstudio → dễ mất đăng nhập trong iframe
  .replace("://datastudio.google.com", "://lookerstudio.google.com");
/** Link xem thường (mở tab mới, dùng đúng tài khoản Google đang đăng nhập) */
const GA_OPEN_URL = GA_EMBED_URL.replace("/embed/reporting/", "/reporting/");

/** Supabase mặc định trả tối đa 1000 dòng/lần → đọc phân trang cho đủ */
async function fetchAll<T>(table: string, cols: string): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from(table)
      .select(cols)
      .order("created_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    const rows = (data as unknown as T[]) || [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

function unwrap<T>(res: PromiseSettledResult<T[]>, errs: string[]): T[] {
  if (res.status === "fulfilled") return res.value;
  errs.push(res.reason instanceof Error ? res.reason.message : String(res.reason));
  return [];
}

const EMPTY: Data = { bookings: [], profiles: [], reviews: [], logs: [] };
const num = (n: number) => Number(n || 0).toLocaleString("vi-VN");
const short = (n: number) =>
  n >= 1e9 ? `${(n / 1e9).toFixed(1)}tỷ` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}tr` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(Math.round(n));
const fmtTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
const fmtDay = (d: Date) => d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" });
const fold = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").toLowerCase();
const PALETTE = ["#2563eb", "#7c3aed", "#0891b2", "#d97706", "#16a34a", "#db2777"];
const colorOf = (s: string) => PALETTE[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % PALETTE.length];
const initials = (name: string) => {
  const w = name.trim().split(/\s+/).filter(Boolean);
  return ((w.length > 1 ? w[w.length - 2][0] + w[w.length - 1][0] : (w[0] || "?").slice(0, 2)) || "?").toUpperCase();
};
const BUCKET_CLASS: Record<Bucket, string> = { done: "ok", processing: "pending", failed: "fail" };

/* ───────────── Thành phần nhỏ ───────────── */

function Delta({ pct, text }: { pct: number | null | undefined; text: string }) {
  if (pct == null) return <span className="chip neutral">—</span>;
  const up = pct >= 0;
  return (
    <>
      <span className={`chip ${up ? "up" : "down"}`}>
        {up ? "▲" : "▼"} {up ? "+" : ""}
        {pct.toFixed(Math.abs(pct) >= 100 ? 0 : 1)}%
      </span>
      {text}
    </>
  );
}

function Kpi({ label, icon, value, small, children }: { label: string; icon?: string; value: string; small?: string; children?: ReactNode }) {
  return (
    <div className="d-kpi">
      <div className="lab">
        {label} {icon && <span>{icon}</span>}
      </div>
      <div className="val">
        {value}
        {small && <small> {small}</small>}
      </div>
      {children && <div className="foot">{children}</div>}
    </div>
  );
}

/** Đo bề rộng thật (px) của khung chứa để vẽ biểu đồ đúng cỡ chữ, không bị co giãn làm chữ dính nhau */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** Thang chia "đẹp" (1-2-5), số đếm thì chỉ chia số nguyên */
function niceScale(rawMax: number, integer: boolean) {
  const raw = rawMax / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  let step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  if (integer) step = Math.max(1, Math.ceil(step));
  const count = Math.max(1, Math.ceil(rawMax / step - 1e-9));
  return { step, max: step * count, ticks: Array.from({ length: count }, (_, i) => step * (i + 1)) };
}

type ChartSeries = { name?: string; values: number[]; color: string };

function Bars({
  labels,
  series,
  fmt,
  unit = "",
  integer = false,
  height = 220,
  todayIndex = -1,
}: {
  labels: string[];
  series: ChartSeries[];
  fmt: (n: number) => string;
  unit?: string;
  integer?: boolean;
  height?: number;
  todayIndex?: number;
}) {
  const [ref, W] = useWidth<HTMLDivElement>();
  const n = labels.length;
  const rawMax = Math.max(0, ...series.flatMap((x) => x.values));
  const empty = n === 0 || rawMax === 0;

  let svg: ReactNode = null;
  if (!empty && W > 0) {
    const H = height, pL = 12, pR = 8, pT = 16, pB = 34;
    const sc = niceScale(rawMax, integer);
    // chừa chỗ bên trái đủ cho nhãn trục Y dài nhất
    const yTxtW = Math.max(...[0, ...sc.ticks].map((v) => fmt(v).length)) * 6.6 + 12;
    const left = pL + yTxtW;
    const cw = (W - left - pR) / n;
    const k = series.length;
    const groupW = Math.max(k * 3, Math.min(k * 22, cw * 0.62));
    const bw = (groupW - (k - 1) * 2) / k;
    const y0 = H - pB, ph = H - pT - pB;
    const yOf = (v: number) => y0 - (ph * v) / sc.max;
    // mỗi nhãn ngày cần ~ labelW px; đếm từ cuối để luôn có nhãn "hôm nay"
    const labelW = labels.reduce((m, l) => Math.max(m, l.length), 0) * 6.4 + 18;
    const step = Math.max(1, Math.ceil(labelW / cw));
    const showVals = k === 1 && cw >= 44;
    svg = (
      <svg width={W} height={H} className="d-chart" role="img">
        {[0, ...sc.ticks].map((v) => (
          <g key={v}>
            <line x1={left} y1={yOf(v)} x2={W - pR} y2={yOf(v)} className={v === 0 ? "ax" : "gl"} />
            <text x={left - 8} y={yOf(v) + 4} textAnchor="end">
              {fmt(v)}
            </text>
          </g>
        ))}
        {labels.map((l, i) => {
          const cx = left + cw * i + cw / 2;
          const isToday = i === todayIndex;
          const tip = `${isToday ? "Hôm nay · " : ""}${l}` + series.map((x) => `\n${x.name ? x.name + ": " : ""}${fmt(x.values[i])}${unit && !x.name ? " " + unit : ""}`).join("");
          return (
            <g key={i} className="d-col">
              {isToday && <rect x={left + cw * i} y={pT - 6} width={cw} height={ph + 6} className="today-bg" />}
              <rect x={left + cw * i} y={pT - 6} width={cw} height={ph + 6} className="hit">
                <title>{tip}</title>
              </rect>
              {series.map((x, j) => {
                const v = x.values[i];
                if (!(v > 0)) return null;
                const bx = cx - groupW / 2 + j * (bw + 2);
                return <rect key={j} x={bx} y={yOf(v)} width={bw} height={y0 - yOf(v)} rx={Math.min(3, bw / 2)} fill={x.color} pointerEvents="none" />;
              })}
              {showVals && series[0].values[i] > 0 && (
                <text x={cx} y={yOf(series[0].values[i]) - 5} textAnchor="middle" className="val">
                  {fmt(series[0].values[i])}
                </text>
              )}
              {(n - 1 - i) % step === 0 && (
                <text x={cx} y={H - 12} textAnchor="middle" className={isToday ? "xl today" : "xl"}>
                  {l}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    );
  }

  return (
    <div ref={ref} className="d-chartwrap" style={{ minHeight: empty ? undefined : height }}>
      {empty ? <div className="d-empty">Chưa có dữ liệu trong khoảng thời gian này</div> : svg}
    </div>
  );
}

function BarChart({
  labels,
  values,
  fmt,
  color = "#2563eb",
  small = false,
  unit = "",
  integer = false,
  todayIndex = -1,
}: {
  labels: string[];
  values: number[];
  fmt: (n: number) => string;
  color?: string;
  small?: boolean;
  unit?: string;
  integer?: boolean;
  todayIndex?: number;
}) {
  return <Bars labels={labels} series={[{ values, color }]} fmt={fmt} unit={unit} integer={integer} height={small ? 200 : 230} todayIndex={todayIndex} />;
}

function Donut({ segs, total, label }: { segs: { v: number; color: string }[]; total: number; label: string }) {
  const C = 2 * Math.PI * 44;
  let off = 0;
  return (
    <svg viewBox="0 0 120 120" width={130} height={130}>
      <circle cx={60} cy={60} r={44} fill="none" stroke="#eef0f4" strokeWidth={14} />
      {total > 0 &&
        segs
          .filter((x) => x.v > 0)
          .map((x, i) => {
            const len = (C * x.v) / total;
            const el = (
              <circle
                key={i}
                cx={60}
                cy={60}
                r={44}
                fill="none"
                stroke={x.color}
                strokeWidth={14}
                strokeDasharray={`${len} ${C - len}`}
                strokeDashoffset={-off}
                transform="rotate(-90 60 60)"
              />
            );
            off += len;
            return el;
          })}
      <text x={60} y={58} textAnchor="middle" style={{ fontSize: 20, fontWeight: 700, fill: "#1a1d23" }}>
        {num(total)}
      </text>
      <text x={60} y={73} textAnchor="middle" style={{ fontSize: 10, fill: "#98a1b3" }}>
        {label}
      </text>
    </svg>
  );
}

function Rate({ label, value, max, color }: { label: ReactNode; value: number; max: number; color: string }) {
  return (
    <div className="rate-row">
      <span className="lab">{label}</span>
      <div className="track">
        <div className="fill" style={{ width: `${max ? (value / max) * 100 : 0}%`, background: color }} />
      </div>
      <span className="num">{num(value)}</span>
    </div>
  );
}

function Avatar({ name, big }: { name: string; big?: boolean }) {
  return (
    <span className={`uava ${big ? "big" : ""}`} style={{ background: colorOf(name) }}>
      {initials(name)}
    </span>
  );
}

function RankTable({ rows, valueLabel }: { rows: RankRow[]; valueLabel: string }) {
  if (!rows.length) return <div className="d-empty">Chưa có giao dịch trong kỳ</div>;
  return (
    <div className="d-scroll">
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Tên</th>
            <th>Số đơn</th>
            <th>{valueLabel}</th>
            <th>Gần nhất</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id}>
              <td>{i + 1}</td>
              <td>
                <div className="ucell">
                  <Avatar name={r.name} />
                  <div>
                    <div className="uname">{r.name}</div>
                    {r.email && <div className="uemail">{r.email}</div>}
                  </div>
                </div>
              </td>
              <td>{num(r.orders)}</td>
              <td>{formatVnd(r.amount)}</td>
              <td style={{ color: "var(--d-text3)" }}>{fmtTime(r.last)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatusTag({ bucket, paid = true }: { bucket: Bucket; paid?: boolean }) {
  const text = bucket === "processing" && !paid ? "Chờ thanh toán" : BUCKET_LABEL[bucket];
  return <span className={`status ${BUCKET_CLASS[bucket]}`}>{text}</span>;
}

/* ───────────── Tra cứu PTG / User ───────────── */

type Kind = "all" | "ptg" | "user";

function Lookup({ data, now }: { data: Data; now: Date }) {
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<Kind>("all");
  const [selId, setSelId] = useState<string | null>(null);

  const results = useMemo(() => {
    const s = fold(q.trim());
    return data.profiles
      .filter((p) => p.role !== "admin")
      .filter((p) => (kind === "ptg" ? p.role === "photographer" : kind === "user" ? p.role !== "photographer" : true))
      .filter(
        (p) =>
          !s ||
          fold(`${p.full_name || ""} ${p.username || ""} ${p.email || ""}`).includes(s) ||
          (p.phone || "").includes(s) ||
          p.id.startsWith(s)
      )
      .slice(-200)
      .reverse()
      .slice(0, 8);
  }, [data.profiles, q, kind]);

  const person = useMemo(() => (selId ? buildPerson(data, selId, now, COMMISSION_RATE) : null), [data, selId, now]);
  const pName = person ? displayName(person.profile) : "";

  return (
    <div className="d-card lookup" style={{ marginBottom: 16 }}>
      <div className="d-head">
        <div>
          <h3>🔎 Tra cứu PTG / User</h3>
          <div className="csub">Gõ tên, email hoặc số điện thoại rồi chọn người cần xem lịch sử giao dịch</div>
        </div>
      </div>

      <div className="lk-bar">
        <div className="lk-search">
          🔎 <input autoFocus placeholder="Nhập tên người muốn kiểm tra..." value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="d-pills">
          {(["all", "ptg", "user"] as Kind[]).map((k) => (
            <button key={k} className={`d-pill ${kind === k ? "active" : ""}`} onClick={() => setKind(k)}>
              {k === "all" ? "Tất cả" : k === "ptg" ? "PTG" : "User"}
            </button>
          ))}
        </div>
      </div>

      <div className="lk-results">
        {results.length === 0 && <div className="d-empty" style={{ minHeight: 60 }}>Không tìm thấy ai khớp với “{q}”</div>}
        {results.map((p) => {
          const name = displayName(p);
          return (
            <button key={p.id} className={`lk-item ${selId === p.id ? "sel" : ""}`} onClick={() => setSelId(p.id)}>
              <Avatar name={name} />
              <div>
                <div className="uname">{name}</div>
                <div className="uemail">{p.email || p.phone || p.id.slice(0, 8)}</div>
              </div>
              <span className={`status tag ${p.role === "photographer" ? "ok" : "pending"}`}>{p.role === "photographer" ? "PTG" : "User"}</span>
            </button>
          );
        })}
      </div>

      {person && (
        <>
          <div className="lk-profile">
            <Avatar name={pName} big />
            <div>
              <h3>{pName}</h3>
              <div className="uemail">
                {person.profile?.email || "—"}
                {person.profile?.phone ? ` · ${person.profile.phone}` : ""} · Tham gia {fmtTime(person.profile?.created_at ?? null).split(",")[0]}
              </div>
            </div>
            <span className={`status ${person.isPtg ? "ok" : "pending"}`}>{person.isPtg ? "Nhiếp ảnh gia (PTG)" : "Khách hàng"}</span>
          </div>

          <div className="d-kpis">
            <Kpi label="Tổng số đơn" value={num(person.total)}>
              <span className="chip neutral">{num(person.paidCount)} đã thanh toán</span>
            </Kpi>
            <Kpi label="Hoàn tất" value={num(person.doneCount)}>
              <span className={`chip ${person.failedCount ? "warn" : "neutral"}`}>{num(person.failedCount)} từ chối / hủy</span>
            </Kpi>
            {(!person.isPtg || person.spent > 0) && <Kpi label="Đã chi tiêu" value={formatVnd(person.spent)}>với tư cách khách</Kpi>}
            {person.isPtg && <Kpi label="Thu nhập PTG (ước tính)" value={formatVnd(person.earned)}>sau trừ phí {COMM_PCT}%</Kpi>}
            {person.isPtg && (
              <Kpi label="Đánh giá" value={person.reviewCount ? person.ratingAvg.toFixed(1) : "—"} small={person.reviewCount ? "/ 5" : ""}>
                <span className="chip neutral">{num(person.reviewCount)} đánh giá</span>
              </Kpi>
            )}
            <Kpi label="Hoạt động gần nhất" value={fmtTime(person.last).split(",")[0] || "—"}>
              {fmtTime(person.last)}
            </Kpi>
          </div>

          <div className="d-grid">
            <div className="d-card s5" style={{ boxShadow: "none" }}>
              <h3>Giá trị giao dịch theo tháng</h3>
              <div className="csub">12 tháng gần nhất</div>
              <BarChart labels={person.labels} values={person.monthly} fmt={(n) => short(n) + "đ"} color="#7c3aed" small todayIndex={11} />
            </div>
            <div className="d-card s7" style={{ boxShadow: "none" }}>
              <h3>Lịch sử giao dịch</h3>
              <div className="csub">{person.history.length ? `${num(person.history.length)} đơn · hiển thị tối đa 50 đơn mới nhất` : "Chưa có đơn nào"}</div>
              {person.history.length > 0 && (
                <div className="d-scroll" style={{ maxHeight: 330, overflowY: "auto" }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Mã</th>
                        <th>Vai trò</th>
                        <th>Đối tác</th>
                        <th>Gói</th>
                        <th>Số tiền</th>
                        <th>Thời gian</th>
                        <th>Trạng thái</th>
                      </tr>
                    </thead>
                    <tbody>
                      {person.history.slice(0, 50).map((h) => (
                        <tr key={h.id}>
                          <td className="mono">#{h.id.slice(0, 6)}</td>
                          <td>{h.role}</td>
                          <td>{h.other}</td>
                          <td>{h.pkg}</td>
                          <td>{formatVnd(h.amount)}</td>
                          <td style={{ color: "var(--d-text3)" }}>{fmtTime(h.at)}</td>
                          <td>
                            <StatusTag bucket={h.bucket} paid={h.paid} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ───────────── Xuất báo cáo (CSV mở bằng Excel) ───────────── */

const LOG_LABEL: Record<string, string> = {
  matched: "Đã tự xác nhận",
  manual: "Admin đánh dấu tay",
  unmatched: "Không khớp lịch hẹn",
  underpaid: "Thiếu tiền",
  ignored: "Bỏ qua (cần xem)",
  payout_advance: `Đã ứng ${ADV_PCT}% cho PTG`,
  payout_final: "Đã quyết toán PTG",
  processing: "Đang xử lý",
};
const logText = (t: TxRow) => (t.logCount ? `${LOG_LABEL[t.logResult || ""] || t.logResult}${t.logCount > 1 ? ` (+${t.logCount - 1})` : ""}` : "CHƯA CÓ LOG");

function exportCsv(s: Stats) {
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const rows = s.ledger.map((t) =>
    [t.id, t.customer, t.customerEmail, t.ptg, t.ptgEmail, t.pkg, t.amount, t.fee, fmtTime(t.at), BUCKET_LABEL[t.bucket], logText(t)].map(esc).join(",")
  );
  const head = ["Mã đơn", "Khách hàng", "Email khách", "PTG", "Email PTG", "Gói", "Số tiền", "Phí Memento", "Thời gian thanh toán", "Trạng thái", "Log giao dịch"].map(esc).join(",");
  const blob = new Blob(["\ufeff" + [head, ...rows].join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `memento-giao-dich-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ───────────── Sổ giao dịch + log (ai giao dịch, đã có log chưa) ───────────── */

function Ledger({ s, rangeLabel }: { s: Stats; rangeLabel: string }) {
  const [q, setQ] = useState("");
  const [onlyNoLog, setOnlyNoLog] = useState(false);
  const [limit, setLimit] = useState(30);
  const rows = useMemo(() => {
    const f = fold(q.trim());
    return s.ledger.filter(
      (t) =>
        (!onlyNoLog || t.logCount === 0) &&
        (!f || fold(`${t.customer} ${t.customerEmail} ${t.ptg} ${t.ptgEmail} ${t.id} ${t.pkg}`).includes(f))
    );
  }, [s.ledger, q, onlyNoLog]);

  return (
    <div className="d-card">
      <div className="d-head">
        <div>
          <h3>Sổ giao dịch &amp; log</h3>
          <div className="csub">
            {num(s.ledger.length)} giao dịch đã thanh toán ({rangeLabel}) · mỗi dòng ghi rõ tài khoản khách, tài khoản PTG, phí Memento và đã có log hay chưa
          </div>
        </div>
        <div className="lk-bar" style={{ marginBottom: 0 }}>
          <div className="lk-search" style={{ minWidth: 200 }}>
            🔎 <input placeholder="Tìm theo tên / email / mã đơn" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <button className={`d-btn ${onlyNoLog ? "on" : ""}`} onClick={() => setOnlyNoLog((v) => !v)}>
            Chưa có log ({num(s.ledgerNoLog)})
          </button>
        </div>
      </div>

      {s.ledgerNoLog > 0 && (
        <div className="d-warnbox">
          ⚠ Có <b>{num(s.ledgerNoLog)}</b> / {num(s.ledger.length)} giao dịch chưa có dòng nào trong <code>payment_logs</code>. Chạy <code>sql/030_transaction_audit.sql</code> để mọi giao dịch từ nay tự được ghi log
          (kèm tài khoản khách / PTG / admin thao tác), và <code>sql/031_backfill_missing_logs.sql</code> để bổ sung log cho các giao dịch cũ.
        </div>
      )}

      {rows.length === 0 ? (
        <div className="d-empty">{s.ledger.length ? "Không có giao dịch khớp bộ lọc" : "Chưa có giao dịch trong kỳ"}</div>
      ) : (
        <>
          <div className="d-scroll">
            <table>
              <thead>
                <tr>
                  <th>Thời gian</th>
                  <th>Mã</th>
                  <th>Khách (tài khoản)</th>
                  <th>PTG (tài khoản)</th>
                  <th>Gói</th>
                  <th>Thanh toán</th>
                  <th>Phí Memento</th>
                  <th>Trạng thái</th>
                  <th>Log</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, limit).map((t) => (
                  <tr key={t.id}>
                    <td style={{ color: "var(--d-text3)", whiteSpace: "nowrap" }}>{fmtTime(t.at)}</td>
                    <td className="mono">#{t.id.slice(0, 6)}</td>
                    <td>
                      <div className="uname">{t.customer}</div>
                      <div className="uemail">{t.customerEmail || "—"}</div>
                    </td>
                    <td>
                      <div className="uname">{t.ptg}</div>
                      <div className="uemail">{t.ptgEmail || "—"}</div>
                    </td>
                    <td>{t.pkg}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{formatVnd(t.amount)}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{formatVnd(t.fee)}</td>
                    <td>
                      <StatusTag bucket={t.bucket} />
                    </td>
                    <td>
                      <span className={`status ${t.logCount ? "ok" : "fail"}`}>{logText(t)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > limit && (
            <div style={{ textAlign: "center", marginTop: 12 }}>
              <button className="d-btn" onClick={() => setLimit((l) => l + 50)}>
                Hiện thêm ({num(rows.length - limit)} còn lại)
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ───────────── Google Analytics ───────────── */

function AnalyticsPanel() {
  if (GA_EMBED_URL) {
    return (
      <div className="d-card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", padding: "10px 14px", borderBottom: "1px solid #e3ebe8", fontSize: 13 }}>
          <span>
            Nếu khung bên dưới báo <b>“Không thể truy cập vào báo cáo”</b>: bật cookie bên thứ ba cho <code>[*.]google.com</code>,
            hoặc dùng nút bên phải (luôn chạy).
          </span>
          <a className="d-btn" href={GA_OPEN_URL} target="_blank" rel="noreferrer">Mở báo cáo trong tab mới ↗</a>
        </div>
        <iframe
          title="Google Analytics"
          src={GA_EMBED_URL}
          className="dash-ga"
          allowFullScreen
        />
      </div>
    );
  }
  return (
    <div className="d-card dash-ga-setup">
      <strong>Chưa kết nối Google Analytics</strong>
      <ol>
        <li>
          Tạo property GA4 tại <a href="https://analytics.google.com/" target="_blank" rel="noreferrer">analytics.google.com</a>,
          tạo luồng <b>Android</b> (package <code>com.Memento.mementoVN</code>), tải <code>google-services.json</code> và cài <code>@capacitor-firebase/analytics</code> trong <b>app Memento (Capacitor)</b>. Chỉ dùng thẻ <code>gtag</code> nếu có bản web.
        </li>
        <li>
          Vào <a href="https://lookerstudio.google.com/" target="_blank" rel="noreferrer">Looker Studio</a> → tạo báo cáo từ nguồn dữ liệu GA4 →
          <b> File → Embed report</b> → bật <b>Enable embedding</b> → copy URL nhúng.
        </li>
        <li>
          Dán vào file <code>.env</code> của dashboard rồi chạy lại <code>npm run dev</code>:
          <pre>VITE_GA_EMBED_URL=https://lookerstudio.google.com/embed/reporting/....</pre>
        </li>
      </ol>
    </div>
  );
}

/* ───────────── Trang Dashboard ───────────── */

export default function Dashboard() {
  const [data, setData] = useState<Data>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);
  const [rangeId, setRangeId] = useState<RangeId>("30d");
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [showLookup, setShowLookup] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    const [b, p, r, l] = await Promise.allSettled([
      fetchAll<Booking>(
        "bookings",
        "id,status,payment_status,package_price,deposit_amount,deposit_paid_at,paid_at,drive_released_at,created_at,client_id,client_name,photographer_user_id,photographer_name,package_name"
      ),
      fetchAll<Profile>("profiles", "id,role,created_at,full_name,username,email,phone"),
      fetchAll<Review>("photographer_reviews", "*"),
      fetchAll<PayLog>("payment_logs", "*"),
    ]);
    const errs: string[] = [];
    setData({
      bookings: unwrap(b, errs),
      profiles: unwrap(p, errs),
      reviews: unwrap(r, errs),
      logs: unwrap(l, errs),
    });
    setErrors(errs);
    setLoadedAt(new Date());
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    // Tự cập nhật: mỗi 60 giây và mỗi khi quay lại tab → giao dịch mới trong ngày hiện ngay, không cần bấm Làm mới
    const timer = window.setInterval(() => load(true), 60_000);
    const onVisible = () => document.visibilityState === "visible" && load(true);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  const now = useMemo(() => new Date(), [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const s = useMemo(() => computeStats(data, rangeId, now, COMMISSION_RATE), [data, rangeId, now]);
  const rangeLabel = RANGES.find((x) => x.id === rangeId)!.label.toLowerCase();
  const perUnit = s.unit === "day" ? "ngày" : "tháng";
  const maxRole = Math.max(1, s.customers, s.photographers, s.admins);
  const totalBucket = s.bucket.done + s.bucket.processing + s.bucket.failed;
  const d = s.deltas;

  return (
    <div className="dash">
      <div className="d-top">
        <div>
          <h1>📊 Tổng quan kinh doanh</h1>
          <div className="d-sub">
            {loadedAt ? `Cập nhật lúc ${loadedAt.toLocaleTimeString("vi-VN")} · ` : ""}
            Dữ liệu {rangeLabel} ({fmtDay(s.since)} – {fmtDay(now)})
          </div>
        </div>
        <div className="d-actions">
          <div className="d-pills">
            {RANGES.map((r) => (
              <button key={r.id} className={`d-pill ${rangeId === r.id ? "active" : ""}`} onClick={() => setRangeId(r.id)}>
                {r.label}
              </button>
            ))}
          </div>
          <button className={`d-btn ${showLookup ? "on" : ""}`} onClick={() => setShowLookup((v) => !v)}>
            👥 Tra cứu PTG / User
          </button>
          <button className="d-btn" onClick={() => load()} disabled={loading}>
            {loading ? "Đang tải..." : "⟳ Làm mới"}
          </button>
          <button className="d-btn primary" onClick={() => exportCsv(s)} disabled={loading}>
            ⬇ Xuất báo cáo
          </button>
        </div>
      </div>

      {errors.length > 0 && (
        <div className="d-card" style={{ color: "var(--d-danger)", fontSize: 13, marginBottom: 14 }}>
          <strong>Không đọc được một số dữ liệu (thường do RLS hoặc sai tên bảng/cột):</strong>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      <section id="thong-so">
        <div className="d-section first">📈 Thông số</div>

        {showLookup && <Lookup data={data} now={now} />}

        {loading && data === EMPTY ? (
          <p style={{ color: "var(--d-text3)" }}>Đang tải...</p>
        ) : (
          <>
            <div className="d-kpis">
              <Kpi label={`Doanh thu Memento (${COMM_PCT}%)`} icon="💰" value={formatVnd(s.fee)}>
                <Delta pct={d?.fee} text="so với kỳ trước" />
              </Kpi>
              <Kpi label="Tổng tiền thanh toán" icon="💳" value={formatVnd(s.gmv)}>
                <Delta pct={d?.gmv} text={`· TB ${short(s.avgOrder)}đ/đơn`} />
              </Kpi>
              <Kpi label="Số lượng giao dịch" icon="🧾" value={num(s.txCount)}>
                <span className="chip warn">{s.txCount ? Math.round((s.txDone / s.txCount) * 100) : 0}% hoàn tất</span>
                {num(s.txDone)}/{num(s.txCount)} thành công
              </Kpi>
              <Kpi label="Người dùng mới" icon="👤" value={num(s.usersNew)}>
                <Delta pct={d?.users} text="so với kỳ trước" />
              </Kpi>
              <Kpi label="Số lượng đánh giá" icon="💬" value={num(s.reviewsCount)}>
                <Delta pct={d?.reviews} text={`· tổng ${num(s.reviewsAll)}`} />
              </Kpi>
              <Kpi label="Điểm đánh giá TB" icon="⭐" value={s.reviewsCount ? s.avgRating.toFixed(1) : "—"} small={s.reviewsCount ? "/ 5" : ""}>
                <span className="chip neutral">{s.reviewsAll ? `${s.avgRatingAll.toFixed(2)} toàn thời gian` : "Chưa có đánh giá"}</span>
              </Kpi>
            </div>

            <div className="d-grid">
              <div className="d-card s8">
                <div className="d-head">
                  <div>
                    <h3>Doanh thu theo {perUnit}</h3>
                    <div className="csub">Doanh thu Memento và tổng tiền thanh toán</div>
                    <div className="d-today">
                      <span className="tt">Hôm nay</span>
                      {s.today.tx > 0 ? (
                        <>
                          <b>{formatVnd(s.today.fee)}</b> doanh thu · {formatVnd(s.today.gmv)} thanh toán · {num(s.today.tx)} giao dịch
                        </>
                      ) : (
                        <span>chưa có giao dịch nào hôm nay</span>
                      )}
                    </div>
                  </div>
                  <div className="legend">
                    <span><i style={{ background: "#2563eb" }} />Doanh thu</span>
                    <span><i style={{ background: "#c7d2fe" }} />Thanh toán</span>
                  </div>
                </div>
                <RevenueChart s={s} />
              </div>

              <div className="d-card s4">
                <h3>Trạng thái đơn</h3>
                <div className="csub">{num(totalBucket)} đơn tạo trong kỳ</div>
                <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
                  <Donut
                    total={totalBucket}
                    label="đơn"
                    segs={[
                      { v: s.bucket.done, color: "#16a34a" },
                      { v: s.bucket.processing, color: "#d97706" },
                      { v: s.bucket.failed, color: "#dc2626" },
                    ]}
                  />
                  <div style={{ flex: 1 }}>
                    <Rate label="Hoàn tất" value={s.bucket.done} max={totalBucket} color="#16a34a" />
                    <Rate label="Đang xử lý" value={s.bucket.processing} max={totalBucket} color="#d97706" />
                    <Rate label="Từ chối / hủy" value={s.bucket.failed} max={totalBucket} color="#dc2626" />
                  </div>
                </div>
                <div className="csub" style={{ marginTop: 10, marginBottom: 0 }}>
                  Log thanh toán cần xem: <b>{num(s.logIssues)}</b> / {num(s.logTotal)}
                  <br />
                  Giao dịch chưa có log: <b style={{ color: s.ledgerNoLog ? "var(--d-danger)" : undefined }}>{num(s.ledgerNoLog)}</b> / {num(s.ledger.length)}
                </div>
              </div>

              <div className="d-card s4">
                <h3>Số giao dịch theo {perUnit}</h3>
                <div className="csub">Tổng {num(s.txCount)} giao dịch</div>
                <BarChart small integer labels={s.labels} values={s.txSeries} fmt={num} color="#7c3aed" unit="giao dịch" todayIndex={s.todayIndex} />
              </div>

              <div className="d-card s4">
                <h3>Người dùng mới theo {perUnit}</h3>
                <div className="csub">Tổng {num(s.usersNew)} người dùng mới</div>
                <BarChart small integer labels={s.labels} values={s.userSeries} fmt={num} color="#0891b2" unit="người dùng" todayIndex={s.todayIndex} />
              </div>

              <div className="d-card s4">
                <h3>Phân bố điểm đánh giá</h3>
                <div className="csub">{num(s.reviewsCount)} đánh giá trong kỳ</div>
                {s.reviewsCount === 0 ? (
                  <div className="d-empty">Chưa có đánh giá trong kỳ này</div>
                ) : (
                  <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
                    <div style={{ textAlign: "center", minWidth: 70 }}>
                      <div style={{ fontSize: 32, fontWeight: 700 }}>{s.avgRating.toFixed(1)}</div>
                      <div className="stars">{"★".repeat(Math.round(s.avgRating))}</div>
                    </div>
                    <div style={{ flex: 1 }}>
                      {[5, 4, 3, 2, 1].map((st) => (
                        <Rate key={st} label={`${st}★`} value={s.ratingDist[st - 1]} max={Math.max(1, ...s.ratingDist)} color="#d97706" />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="d-section">👥 Thống kê người dùng</div>
            <div className="d-kpis">
              <Kpi label="Tổng người dùng" value={num(s.usersTotal)}>
                <span className="chip up">+{num(s.usersNew)}</span> trong {rangeLabel}
              </Kpi>
              <Kpi label="Khách hàng / PTG" value={`${num(s.customers)} / ${num(s.photographers)}`}>
                <span className="chip neutral">{s.usersTotal ? Math.round((s.photographers / s.usersTotal) * 100) : 0}% là PTG</span>
              </Kpi>
              <Kpi label="Tỷ lệ chuyển đổi" value={s.conversion.toFixed(0)} small="%">
                <span className="chip neutral">{num(s.paidOrdersCreated)}/{num(s.ordersCreated)}</span> đơn đã thanh toán
              </Kpi>
              <Kpi label="Khách quay lại" value={s.repeatRate.toFixed(0)} small="%">
                <span className="chip neutral">{num(s.repeatBuyers)}/{num(s.buyers)}</span> khách mua ≥ 2 đơn
              </Kpi>
            </div>

            <div className="d-grid">
              <div className="d-card s7">
                <h3>Tăng trưởng người dùng</h3>
                <div className="csub">Tổng tài khoản tích lũy theo {perUnit}</div>
                <BarChart integer labels={s.labels} values={s.growthSeries} fmt={num} color="#16a34a" unit="tài khoản" todayIndex={s.todayIndex} />
              </div>
              <div className="d-card s5">
                <h3>Phân bố vai trò</h3>
                <div className="csub">{num(s.usersTotal)} tài khoản theo loại</div>
                <Rate label="Khách hàng" value={s.customers} max={maxRole} color="#2563eb" />
                <Rate label="Nhiếp ảnh gia" value={s.photographers} max={maxRole} color="#7c3aed" />
                <Rate label="Quản trị viên" value={s.admins} max={maxRole} color="#d97706" />
              </div>
              <div className="d-card s6">
                <h3>Top khách hàng</h3>
                <div className="csub">Xếp hạng theo tổng chi tiêu ({rangeLabel})</div>
                <RankTable rows={s.topCustomers} valueLabel="Chi tiêu" />
              </div>
              <div className="d-card s6">
                <h3>Top nhiếp ảnh gia</h3>
                <div className="csub">Xếp hạng theo doanh số ({rangeLabel})</div>
                <RankTable rows={s.topPtgs} valueLabel="Doanh số" />
              </div>
            </div>

            <div className="d-section">🧾 Giao dịch &amp; dịch vụ</div>
            <div className="d-grid">
              <div className="d-card s7">
                <h3>Giao dịch gần đây</h3>
                <div className="csub">{num(s.recent.length)} giao dịch đã thanh toán mới nhất</div>
                {s.recent.length === 0 ? (
                  <div className="d-empty">Chưa có giao dịch trong kỳ</div>
                ) : (
                  <div className="d-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Mã</th>
                          <th>Khách hàng</th>
                          <th>PTG</th>
                          <th>Gói</th>
                          <th>Số tiền</th>
                          <th>Thời gian</th>
                          <th>Trạng thái</th>
                        </tr>
                      </thead>
                      <tbody>
                        {s.recent.map((t) => (
                          <tr key={t.id}>
                            <td className="mono">#{t.id.slice(0, 6)}</td>
                            <td>
                              <div className="uname">{t.customer}</div>
                              <div className="uemail">{t.customerEmail || "—"}</div>
                            </td>
                            <td>
                              <div className="uname">{t.ptg}</div>
                              <div className="uemail">{t.ptgEmail || "—"}</div>
                            </td>
                            <td>{t.pkg}</td>
                            <td>{formatVnd(t.amount)}</td>
                            <td style={{ color: "var(--d-text3)" }}>{fmtTime(t.at)}</td>
                            <td>
                              <StatusTag bucket={t.bucket} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
              <div className="d-card s5">
                <h3>Doanh thu theo gói dịch vụ</h3>
                <div className="csub">Tỷ trọng trong kỳ (theo tổng tiền thanh toán)</div>
                {s.packages.length === 0 ? (
                  <div className="d-empty">Chưa có dữ liệu</div>
                ) : (
                  s.packages.map((p, i) => (
                    <div key={p.name} style={{ margin: "12px 0" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 6 }}>
                        <span>{p.name}</span>
                        <b>{p.pct.toFixed(0)}% · {short(p.amount)}đ</b>
                      </div>
                      <div className="track" style={{ height: 10 }}>
                        <div className="fill" style={{ width: `${p.pct}%`, background: PALETTE[i % PALETTE.length] }} />
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </>
        )}
      </section>

      {!loading && (
        <>
          <div className="d-section">🗂 Sổ giao dịch &amp; log</div>
          <Ledger s={s} rangeLabel={rangeLabel} />
        </>
      )}

      <div className="d-section">🌐 Google Analytics</div>
      <AnalyticsPanel />
    </div>
  );
}

/** Biểu đồ cột đôi: doanh thu Memento + tổng thanh toán */
function RevenueChart({ s }: { s: Stats }) {
  return (
    <Bars
      labels={s.labels}
      series={[
        { name: "Thanh toán", values: s.gmvSeries, color: "#c7d2fe" },
        { name: "Doanh thu", values: s.feeSeries, color: "#2563eb" },
      ]}
      fmt={(n) => (n === 0 ? "0" : short(n))}
      height={240}
      todayIndex={s.todayIndex}
    />
  );
}
