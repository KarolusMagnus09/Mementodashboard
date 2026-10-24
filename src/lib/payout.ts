import { supabase } from "./supabase";

/* ───────────── Tỉ lệ chia tiền ─────────────
 * PHẢI khớp với app chính (src/app/lib/bookings.ts: PTG_ADVANCE_RATE, COMMISSION_RATE).
 * Hiện tại: ứng 20% → chuyển nốt 70% khi xong → PTG nhận 90%, Memento giữ 10%.
 * Muốn đổi: sửa hằng số ở đây VÀ ở app. Mọi nhãn/số tiền trong dashboard tự đổi theo.
 */
export const ADVANCE_RATE = 0.2; // ứng cho PTG sau khi khách thanh toán
export const COMMISSION_RATE = 0.1; // Memento giữ

export const ADV_PCT = Math.round(ADVANCE_RATE * 100);
export const COMM_PCT = Math.round(COMMISSION_RATE * 100);
export const PTG_PCT = 100 - COMM_PCT; // PTG nhận tổng cộng
export const FINAL_PCT = PTG_PCT - ADV_PCT; // chuyển nốt khi xong

export function formatVnd(n: number) {
  return `${Number(n || 0).toLocaleString("vi-VN")}đ`;
}
export function calcAdvance(total: number) {
  return Math.round(Number(total || 0) * ADVANCE_RATE);
}
/** Tổng PTG nhận khi hoàn tất */
export function calcPtgTotal(total: number) {
  return Math.round(Number(total || 0) * (1 - COMMISSION_RATE));
}
/** Phần chuyển nốt = tổng PTG nhận − phần đã ứng (cùng công thức với app) */
export function calcFinal(total: number) {
  return calcPtgTotal(total) - calcAdvance(total);
}
export function calcFee(total: number) {
  return Math.round(Number(total || 0) * COMMISSION_RATE);
}

/* ───────────── Thông tin ngân hàng của PTG ───────────── */

export type BankInfo = {
  /** Nơi lấy ra dữ liệu này */
  source: "application" | "photographer";
  bank_name: string | null;
  bank_code: string | null;
  bank_account: string;
  bank_account_name: string | null;
};

export const BANK_SOURCE_LABEL: Record<BankInfo["source"], string> = {
  application: "hồ sơ đăng ký",
  photographer: "trang photographer",
};

type BankCols = {
  bank_name: string | null;
  bank_code: string | null;
  bank_account: string | null;
  bank_account_name: string | null;
};
type PhotRow = BankCols & { id: number; user_id: string | null };
type AppRow = BankCols & { user_id: string };

export type BookingKey = {
  id: string;
  photographer_user_id: string | null;
  photographer_id?: number | null;
};

export type BankLookup = {
  /** booking id → các tài khoản tìm được (đã bỏ trùng) */
  byBooking: Record<string, BankInfo[]>;
  /** booking id → user_id của PTG (null = không xác định được PTG của đơn) */
  userOf: Record<string, string | null>;
  /** Lỗi khi đọc dữ liệu (thường là RLS hoặc sai tên cột) */
  errors: string[];
};

const BANK_COLS = "bank_name, bank_code, bank_account, bank_account_name";

function toInfo(source: BankInfo["source"], r: BankCols | null | undefined): BankInfo | null {
  const acc = String(r?.bank_account ?? "").replace(/\s/g, "");
  if (!r || !acc) return null;
  return {
    source,
    bank_name: r.bank_name,
    bank_code: r.bank_code,
    bank_account: acc,
    bank_account_name: r.bank_account_name,
  };
}

export function sameAccount(a: BankInfo, b: BankInfo) {
  return a.bank_account === b.bank_account && normBank(a.bank_code || a.bank_name) === normBank(b.bank_code || b.bank_name);
}

function dedupe(list: BankInfo[]): BankInfo[] {
  const out: BankInfo[] = [];
  for (const x of list) if (!out.some((y) => sameAccount(x, y))) out.push(x);
  return out;
}

/**
 * Tìm tài khoản nhận tiền của photographer cho từng đơn.
 * Nguồn: photographer_applications (hồ sơ đăng ký) VÀ photographers (trang photographer).
 * Đơn thiếu photographer_user_id thì tra thêm qua photographer_id.
 * Nếu hai nguồn khác nhau thì trả về cả hai để UI cảnh báo, không tự chọn.
 */
export async function fetchPtgBanks(bookings: BookingKey[]): Promise<BankLookup> {
  const errors: string[] = [];
  const userOf: Record<string, string | null> = {};
  const needUserByPtgId = new Set<number>();
  for (const b of bookings) {
    userOf[b.id] = b.photographer_user_id || null;
    if (!b.photographer_user_id && b.photographer_id != null) needUserByPtgId.add(b.photographer_id);
  }

  const photById = new Map<number, PhotRow>();
  const photByUser = new Map<string, PhotRow>();
  const addPhot = (r: PhotRow) => {
    photById.set(r.id, r);
    if (r.user_id) photByUser.set(r.user_id, r);
  };

  // 1) Đơn chưa có photographer_user_id → tra qua photographers.id
  if (needUserByPtgId.size) {
    const { data, error } = await supabase
      .from("photographers")
      .select(`id, user_id, ${BANK_COLS}`)
      .in("id", [...needUserByPtgId]);
    if (error) errors.push(`Đọc bảng photographers: ${error.message}`);
    else (data as PhotRow[] | null)?.forEach(addPhot);
    for (const b of bookings) {
      if (!userOf[b.id] && b.photographer_id != null) userOf[b.id] = photById.get(b.photographer_id)?.user_id ?? null;
    }
  }

  const userIds = [...new Set(Object.values(userOf).filter((x): x is string => !!x))];

  // 2) photographers theo user_id
  if (userIds.length) {
    const { data, error } = await supabase
      .from("photographers")
      .select(`id, user_id, ${BANK_COLS}`)
      .in("user_id", userIds);
    if (error) errors.push(`Đọc bảng photographers: ${error.message}`);
    else (data as PhotRow[] | null)?.forEach(addPhot);
  }

  // 3) photographer_applications theo user_id
  const appByUser = new Map<string, AppRow>();
  if (userIds.length) {
    const { data, error } = await supabase
      .from("photographer_applications")
      .select(`user_id, ${BANK_COLS}`)
      .in("user_id", userIds);
    if (error) errors.push(`Đọc bảng photographer_applications: ${error.message}`);
    else (data as AppRow[] | null)?.forEach((r) => appByUser.set(r.user_id, r));
  }

  const byBooking: Record<string, BankInfo[]> = {};
  for (const b of bookings) {
    const uid = userOf[b.id];
    const phot = (uid ? photByUser.get(uid) : undefined) ?? (b.photographer_id != null ? photById.get(b.photographer_id) : undefined);
    const list: BankInfo[] = [];
    const a = toInfo("application", uid ? appByUser.get(uid) : null);
    const p = toInfo("photographer", phot);
    if (a) list.push(a);
    if (p) list.push(p);
    byBooking[b.id] = dedupe(list);
  }

  return { byBooking, userOf, errors: [...new Set(errors)] };
}

/* ───────────── QR chuyển khoản (VietQR) ───────────── */

/** "Vietcombank (VCB)" → "vietcombankvcb" */
function normBank(s: string | null | undefined): string {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** Mã BIN các ngân hàng có trong danh sách chọn của app (VN_BANKS) */
const BANK_BINS: { bin: string; aliases: string[] }[] = [
  { bin: "970418", aliases: ["bidv"] },
  { bin: "970436", aliases: ["vietcombank", "vcb"] },
  { bin: "970422", aliases: ["mbbank", "mb"] },
  { bin: "970407", aliases: ["techcombank", "tcb"] },
  { bin: "970416", aliases: ["acb"] },
  { bin: "970432", aliases: ["vpbank", "vpb"] },
  { bin: "970423", aliases: ["tpbank", "tpb"] },
  { bin: "970415", aliases: ["vietinbank", "ctg", "icb"] },
  { bin: "970405", aliases: ["agribank", "vba"] },
  { bin: "970403", aliases: ["sacombank", "stb"] },
  { bin: "970426", aliases: ["msb"] },
  { bin: "970448", aliases: ["ocb"] },
  { bin: "970437", aliases: ["hdbank", "hdb"] },
  { bin: "970443", aliases: ["shb"] },
  { bin: "970441", aliases: ["vib"] },
];

export function bankBin(bank: Pick<BankInfo, "bank_code" | "bank_name">): string | null {
  for (const raw of [bank.bank_code, bank.bank_name]) {
    const n = normBank(raw);
    if (!n) continue;
    if (/^97\d{4}$/.test(n)) return n; // đã là mã BIN
    for (const b of BANK_BINS) {
      if (b.aliases.includes(n)) return b.bin;
    }
    for (const b of BANK_BINS) {
      // "Vietcombank (VCB)" → chứa "vietcombank"
      if (b.aliases.some((a) => a.length >= 4 && n.includes(a))) return b.bin;
    }
  }
  return null;
}

/**
 * Danh sách URL ảnh QR, thử lần lượt (nếu dịch vụ đầu lỗi thì sang dịch vụ sau).
 * `content` chỉ gồm chữ không dấu và số, tối đa 25 ký tự (giới hạn của VietQR).
 */
export function buildPayoutQrUrls(bank: BankInfo, amount: number, content: string): string[] {
  const acc = bank.bank_account.replace(/\s/g, "");
  const info = content.replace(/[^a-zA-Z0-9 ]/g, "").slice(0, 25);
  const amt = String(Math.round(amount));
  const urls: string[] = [];

  const bankId = bankBin(bank) ?? encodeURIComponent((bank.bank_code || bank.bank_name || "").trim());
  if (bankId) {
    const q = new URLSearchParams({ amount: amt, addInfo: info });
    if (bank.bank_account_name) q.set("accountName", bank.bank_account_name);
    urls.push(`https://img.vietqr.io/image/${bankId}-${encodeURIComponent(acc)}-compact2.png?${q.toString()}`);
  }

  // Dịch vụ dự phòng: cùng kiểu URL mà app đang dùng cho khách thanh toán
  const p = new URLSearchParams({
    acc,
    bank: (bank.bank_code || bank.bank_name || "").trim(),
    amount: amt,
    des: info,
    template: "compact",
    showinfo: "true",
    store: "Memento",
  });
  if (bank.bank_account_name) p.set("holder", bank.bank_account_name);
  urls.push(`https://vietqr.app/img?${p.toString()}`);

  return urls;
}
