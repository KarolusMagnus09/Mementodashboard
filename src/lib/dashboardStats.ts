/* Tính toán số liệu cho trang Dashboard (thuần TypeScript, không gọi Supabase). */

export type Booking = {
  id: string;
  status: string;
  payment_status: string | null;
  package_price: number | null;
  deposit_amount: number | null;
  deposit_paid_at: string | null;
  paid_at: string | null;
  drive_released_at: string | null;
  created_at: string;
  client_id?: string | null;
  client_name?: string | null;
  photographer_user_id?: string | null;
  photographer_name?: string | null;
  package_name?: string | null;
};
export type Profile = {
  id: string;
  role: string | null;
  created_at: string | null;
  full_name?: string | null;
  username?: string | null;
  email?: string | null;
  phone?: string | null;
  avatar_url?: string | null;
};
/** photographer_reviews: tên cột PTG/khách có thể khác nhau nên đọc "*" rồi dò */
export type Review = {
  id: string;
  rating: number | null;
  hidden: boolean | null;
  created_at: string;
  photographer_user_id?: string | null;
  photographer_id?: string | null;
  comment?: string | null;
};
export type PayLog = {
  id: string;
  result: string;
  created_at: string;
  provider?: string | null;
  booking_id?: string | null;
  bill_code?: string | null;
  amount?: number | null;
  note?: string | null;
  actor_email?: string | null;
};

export type RangeId = "7d" | "30d" | "90d" | "12m" | "all";
export type Unit = "day" | "month";

export const RANGES: { id: RangeId; label: string; days: number | null; unit: Unit }[] = [
  { id: "7d", label: "7 ngày", days: 7, unit: "day" },
  { id: "30d", label: "30 ngày", days: 30, unit: "day" },
  { id: "90d", label: "90 ngày", days: 90, unit: "day" },
  { id: "12m", label: "12 tháng", days: null, unit: "month" },
  { id: "all", label: "Tất cả", days: null, unit: "month" },
];

/** Giống PaymentLogs.tsx: các result được coi là bình thường */
export const GOOD_LOG = ["matched", "manual", "payout_advance", "payout_final"];

const pad = (n: number) => String(n).padStart(2, "0");
const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const monthKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const sameDay = (a: Date, b: Date) => dayKey(a) === dayKey(b);
const keyOf = (u: Unit, d: Date) => (u === "day" ? dayKey(d) : monthKey(d));

function buildKeys(unit: Unit, start: Date, end: Date): string[] {
  const keys: string[] = [];
  const cur = new Date(start.getFullYear(), start.getMonth(), unit === "day" ? start.getDate() : 1);
  while (cur <= end) {
    keys.push(keyOf(unit, cur));
    if (unit === "day") cur.setDate(cur.getDate() + 1);
    else cur.setMonth(cur.getMonth() + 1);
  }
  return keys;
}

function labelOf(unit: Unit, key: string) {
  const [y, m, d] = key.split("-");
  return unit === "day" ? `${d}/${m}` : `${m}/${y}`;
}

/* ───────── Quy ước nghiệp vụ (khớp app: src/app/lib/bookings.ts) ───────── */

/** Đơn đã được khách thanh toán */
export function isPaidBooking(b: Booking) {
  if (b.status === "rejected" || b.status === "cancelled") return false;
  return (
    !!b.deposit_paid_at ||
    ["processing", "active", "handover", "closing", "final_payment", "completed", "deposit_paid", "paid"].includes(b.status) ||
    b.payment_status === "deposit_paid" ||
    b.payment_status === "fully_paid" ||
    b.payment_status === "paid"
  );
}
export const isDoneBooking = (b: Booking) => b.status === "completed" || !!b.drive_released_at;
/** Số tiền khách trả (mặc định 100% giá gói) */
export const paidAmount = (b: Booking) =>
  b.deposit_amount != null && Number(b.deposit_amount) > 0 ? Number(b.deposit_amount) : Number(b.package_price || 0);
export const paidDate = (b: Booking) => b.deposit_paid_at || b.paid_at || b.created_at;

export type Bucket = "done" | "processing" | "failed";
export const bucketOf = (b: Booking): Bucket =>
  b.status === "rejected" || b.status === "cancelled" ? "failed" : isDoneBooking(b) ? "done" : "processing";
export const BUCKET_LABEL: Record<Bucket, string> = { done: "Hoàn tất", processing: "Đang xử lý", failed: "Từ chối / Hủy" };

export const reviewPtgId = (r: Review) => r.photographer_user_id ?? r.photographer_id ?? null;

export type Data = { bookings: Booking[]; profiles: Profile[]; reviews: Review[]; logs: PayLog[] };

export const displayName = (p?: Profile | null, fallback?: string | null) =>
  p?.full_name || p?.username || p?.email || fallback || "Ẩn danh";

const pctChange = (cur: number, prev: number) => (prev > 0 ? ((cur - prev) / prev) * 100 : null);

function windowTotals(data: Data, rate: number, from: number, to: number) {
  let fee = 0, gmv = 0, tx = 0, users = 0, reviews = 0, ratingSum = 0;
  for (const b of data.bookings) {
    if (!isPaidBooking(b)) continue;
    const t = +new Date(paidDate(b));
    if (!(t >= from && t <= to)) continue;
    const amt = paidAmount(b);
    gmv += amt;
    fee += Math.round(Number(b.package_price || amt) * rate);
    tx++;
  }
  for (const p of data.profiles) {
    const t = p.created_at ? +new Date(p.created_at) : NaN;
    if (t >= from && t <= to) users++;
  }
  for (const r of data.reviews) {
    const t = +new Date(r.created_at);
    if (!r.hidden && Number(r.rating) >= 1 && t >= from && t <= to) {
      reviews++;
      ratingSum += Number(r.rating);
    }
  }
  return { fee, gmv, tx, users, reviews, avg: reviews ? ratingSum / reviews : 0 };
}

export type RankRow = { id: string; name: string; email: string; orders: number; amount: number; last: string };
export type TxRow = {
  id: string;
  customer: string;
  customerEmail: string;
  ptg: string;
  ptgEmail: string;
  pkg: string;
  amount: number;
  fee: number;
  at: string;
  bucket: Bucket;
  /** Kết quả log gần nhất của đơn này trong payment_logs; null = CHƯA CÓ LOG */
  logResult: string | null;
  logCount: number;
};

export function computeStats(data: Data, rangeId: RangeId, now: Date, commissionRate: number) {
  const range = RANGES.find((r) => r.id === rangeId)!;
  const unit = range.unit;

  // Mốc bắt đầu
  let since: Date;
  if (rangeId === "all") {
    const all: number[] = [];
    data.bookings.forEach((b) => all.push(+new Date(paidDate(b)), +new Date(b.created_at)));
    data.profiles.forEach((p) => p.created_at && all.push(+new Date(p.created_at)));
    data.reviews.forEach((r) => all.push(+new Date(r.created_at)));
    const valid = all.filter((x) => Number.isFinite(x));
    since = valid.length ? new Date(Math.min(...valid)) : new Date(now);
  } else if (rangeId === "12m") {
    since = new Date(now.getFullYear(), now.getMonth() - 11, 1);
  } else {
    since = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (range.days! - 1));
  }
  since = new Date(since.getFullYear(), since.getMonth(), since.getDate());

  // Mốc cuối = hết ngày hôm nay (không dùng "đúng lúc tải" → giao dịch phát sinh sau khi mở trang / lệch giờ máy vẫn được tính)
  const endOfToday = +new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1) - 1;
  const inRange = (iso: string | null | undefined) => {
    if (!iso) return false;
    const t = +new Date(iso);
    return Number.isFinite(t) && t >= +since && t <= endOfToday;
  };

  const keys = buildKeys(unit, since, now);
  const index = new Map(keys.map((k, i) => [k, i]));
  const zeros = () => keys.map(() => 0);
  const at = (iso: string) => index.get(keyOf(unit, new Date(iso)));

  const profileById = new Map(data.profiles.map((p) => [p.id, p]));

  const gmvSeries = zeros(), feeSeries = zeros(), txSeries = zeros(), userSeries = zeros(), reviewSeries = zeros();
  let gmv = 0, fee = 0, feeDone = 0, txCount = 0, txDone = 0, ordersCreated = 0, paidOrdersCreated = 0;
  const bucket: Record<Bucket, number> = { done: 0, processing: 0, failed: 0 };
  const paidList: Booking[] = [];
  const pkgMap = new Map<string, number>();

  for (const b of data.bookings) {
    if (inRange(b.created_at)) {
      ordersCreated++;
      bucket[bucketOf(b)]++;
      if (isPaidBooking(b)) paidOrdersCreated++;
    }
    if (!isPaidBooking(b)) continue;
    const when = paidDate(b);
    if (!inRange(when)) continue;
    const amt = paidAmount(b);
    const f = Math.round(Number(b.package_price || amt) * commissionRate);
    gmv += amt;
    fee += f;
    txCount++;
    paidList.push(b);
    pkgMap.set(b.package_name || "Khác", (pkgMap.get(b.package_name || "Khác") || 0) + amt);
    if (isDoneBooking(b)) {
      feeDone += f;
      txDone++;
    }
    const i = at(when);
    if (i != null) {
      gmvSeries[i] += amt;
      feeSeries[i] += f;
      txSeries[i] += 1;
    }
  }

  let usersNew = 0, photographers = 0, customers = 0, admins = 0, usersBefore = 0;
  for (const p of data.profiles) {
    if (p.role === "photographer") photographers++;
    else if (p.role === "admin") admins++;
    else customers++;
    if (inRange(p.created_at)) {
      usersNew++;
      const i = at(p.created_at!);
      if (i != null) userSeries[i] += 1;
    } else if (p.created_at && +new Date(p.created_at) < +since) usersBefore++;
  }
  let run = usersBefore;
  const growthSeries = userSeries.map((n) => (run += n));

  const visible = data.reviews.filter((r) => !r.hidden && Number(r.rating) >= 1);
  const visibleInRange = visible.filter((r) => inRange(r.created_at));
  const ratingDist = [0, 0, 0, 0, 0];
  let sum = 0;
  for (const r of visibleInRange) {
    const star = Math.min(5, Math.max(1, Math.round(Number(r.rating))));
    ratingDist[star - 1]++;
    sum += Number(r.rating);
    const i = at(r.created_at);
    if (i != null) reviewSeries[i] += 1;
  }
  const avgRating = visibleInRange.length ? sum / visibleInRange.length : 0;
  const avgRatingAll = visible.length ? visible.reduce((s, r) => s + Number(r.rating), 0) / visible.length : 0;

  const logsInRange = data.logs.filter((l) => inRange(l.created_at));
  const logIssues = logsInRange.filter((l) => !GOOD_LOG.includes(l.result)).length;

  /* So với kỳ trước */
  let prev: ReturnType<typeof windowTotals> | null = null;
  if (rangeId !== "all") {
    const from = rangeId === "12m" ? +new Date(since.getFullYear(), since.getMonth() - 12, 1) : +since - range.days! * 86400000;
    prev = windowTotals(data, commissionRate, from, +since - 1);
  }
  const deltas = prev
    ? {
        fee: pctChange(fee, prev.fee),
        gmv: pctChange(gmv, prev.gmv),
        tx: pctChange(txCount, prev.tx),
        users: pctChange(usersNew, prev.users),
        reviews: pctChange(visibleInRange.length, prev.reviews),
        avg: prev.reviews ? avgRating - prev.avg : null,
      }
    : null;

  /* Khách quay lại: khách có ≥ 2 đơn đã thanh toán / khách đã từng thanh toán (toàn thời gian) */
  const perClient = new Map<string, number>();
  for (const b of data.bookings) if (isPaidBooking(b) && b.client_id) perClient.set(b.client_id, (perClient.get(b.client_id) || 0) + 1);
  const buyers = perClient.size;
  const repeatBuyers = [...perClient.values()].filter((n) => n >= 2).length;

  /* Xếp hạng khách / PTG trong kỳ */
  const rank = (idOf: (b: Booking) => string | null | undefined, nameOf: (b: Booking) => string | null | undefined) => {
    const m = new Map<string, RankRow>();
    for (const b of paidList) {
      const id = idOf(b);
      if (!id) continue;
      const p = profileById.get(id);
      const row = m.get(id) || { id, name: displayName(p, nameOf(b)), email: p?.email || "", orders: 0, amount: 0, last: "" };
      row.orders++;
      row.amount += paidAmount(b);
      const w = paidDate(b);
      if (!row.last || w > row.last) row.last = w;
      m.set(id, row);
    }
    return [...m.values()].sort((a, b) => b.amount - a.amount).slice(0, 5);
  };
  const topCustomers = rank((b) => b.client_id, (b) => b.client_name);
  const topPtgs = rank((b) => b.photographer_user_id, (b) => b.photographer_name);

  /* Log theo đơn: đơn nào có dòng trong payment_logs */
  const logsByBooking = new Map<string, PayLog[]>();
  for (const l of data.logs) {
    if (!l.booking_id) continue;
    const arr = logsByBooking.get(l.booking_id) || [];
    arr.push(l);
    logsByBooking.set(l.booking_id, arr);
  }

  /** Sổ giao dịch: TOÀN BỘ đơn đã thanh toán trong kỳ, kèm tài khoản khách/PTG và trạng thái log */
  const ledger: TxRow[] = [...paidList]
    .sort((a, b) => +new Date(paidDate(b)) - +new Date(paidDate(a)))
    .map((b) => {
      const cp = b.client_id ? profileById.get(b.client_id) : null;
      const pp = b.photographer_user_id ? profileById.get(b.photographer_user_id) : null;
      const ls = (logsByBooking.get(b.id) || []).sort((x, y) => +new Date(y.created_at) - +new Date(x.created_at));
      return {
        id: b.id,
        customer: displayName(cp, b.client_name),
        customerEmail: cp?.email || "",
        ptg: displayName(pp, b.photographer_name),
        ptgEmail: pp?.email || "",
        pkg: b.package_name || "—",
        amount: paidAmount(b),
        fee: Math.round(Number(b.package_price || paidAmount(b)) * commissionRate),
        at: paidDate(b),
        bucket: bucketOf(b),
        logResult: ls[0]?.result ?? null,
        logCount: ls.length,
      };
    });
  const recent = ledger.slice(0, 8);
  const ledgerNoLog = ledger.filter((t) => t.logCount === 0).length;

  /* Hôm nay (luôn tính theo giờ hiện tại, không phụ thuộc kỳ đang chọn) */
  let todayGmv = 0, todayFee = 0, todayTx = 0;
  for (const b of data.bookings) {
    if (!isPaidBooking(b)) continue;
    if (!sameDay(new Date(paidDate(b)), now)) continue;
    const amt = paidAmount(b);
    todayGmv += amt;
    todayFee += Math.round(Number(b.package_price || amt) * commissionRate);
    todayTx++;
  }

  const packages = [...pkgMap.entries()]
    .map(([name, amount]) => ({ name, amount, pct: gmv ? (amount / gmv) * 100 : 0 }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5);

  return {
    unit,
    keys,
    labels: keys.map((k) => labelOf(unit, k)),
    since,
    gmvSeries, feeSeries, txSeries, userSeries, reviewSeries, growthSeries,
    gmv, fee, feeDone, txCount, txDone, ordersCreated, paidOrdersCreated,
    avgOrder: txCount ? gmv / txCount : 0,
    conversion: ordersCreated ? (paidOrdersCreated / ordersCreated) * 100 : 0,
    bucket,
    usersTotal: data.profiles.length, usersNew, photographers, customers, admins,
    buyers, repeatBuyers, repeatRate: buyers ? (repeatBuyers / buyers) * 100 : 0,
    reviewsCount: visibleInRange.length,
    reviewsHidden: data.reviews.filter((r) => r.hidden && inRange(r.created_at)).length,
    reviewsAll: visible.length,
    avgRating, avgRatingAll, ratingDist,
    logTotal: logsInRange.length, logIssues,
    deltas, topCustomers, topPtgs, recent, ledger, ledgerNoLog, packages,
    today: { gmv: todayGmv, fee: todayFee, tx: todayTx },
    todayIndex: unit === "day" ? keys.length - 1 : -1,
  };
}
export type Stats = ReturnType<typeof computeStats>;

/* ───────── Tra cứu 1 người (PTG hoặc user) ───────── */

export function buildPerson(data: Data, id: string, now: Date, commissionRate: number) {
  const profile = data.profiles.find((p) => p.id === id) || null;
  const profileById = new Map(data.profiles.map((p) => [p.id, p]));
  const rows = data.bookings
    .filter((b) => b.client_id === id || b.photographer_user_id === id)
    .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));

  const keys = buildKeys("month", new Date(now.getFullYear(), now.getMonth() - 11, 1), now);
  const monthly = keys.map(() => 0);
  const idx = new Map(keys.map((k, i) => [k, i]));

  let spent = 0, earned = 0, paidCount = 0, doneCount = 0, failedCount = 0;
  let last: string | null = null;
  const history = rows.map((b) => {
    const asPtg = b.photographer_user_id === id;
    const paid = isPaidBooking(b);
    const amt = paid ? paidAmount(b) : Number(b.package_price || 0);
    const bk = bucketOf(b);
    if (paid) {
      paidCount++;
      if (asPtg) earned += Math.round(Number(b.package_price || amt) * (1 - commissionRate));
      else spent += amt;
      const i = idx.get(monthKey(new Date(paidDate(b))));
      if (i != null) monthly[i] += amt;
    }
    if (bk === "done") doneCount++;
    if (bk === "failed") failedCount++;
    const w = paid ? paidDate(b) : b.created_at;
    if (!last || w > last) last = w;
    const other = asPtg
      ? displayName(b.client_id ? profileById.get(b.client_id) : null, b.client_name)
      : displayName(b.photographer_user_id ? profileById.get(b.photographer_user_id) : null, b.photographer_name);
    return { id: b.id, role: asPtg ? "PTG" : "Khách", other, pkg: b.package_name || "—", amount: amt, paid, at: w, bucket: bk };
  });

  const myReviews = data.reviews.filter((r) => reviewPtgId(r) === id && !r.hidden && Number(r.rating) >= 1);
  const ratingAvg = myReviews.length ? myReviews.reduce((s, r) => s + Number(r.rating), 0) / myReviews.length : 0;

  return {
    profile,
    isPtg: profile?.role === "photographer" || rows.some((b) => b.photographer_user_id === id),
    total: rows.length,
    paidCount, doneCount, failedCount, spent, earned,
    last: last || profile?.created_at || null,
    history,
    labels: keys.map((k) => labelOf("month", k)),
    monthly,
    reviewCount: myReviews.length,
    ratingAvg,
  };
}
export type Person = ReturnType<typeof buildPerson>;
