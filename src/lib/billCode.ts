/**
 * Mã đơn hiển thị cho khách ở app và nội dung chuyển khoản SePay: MMT-XXXXXXXX
 * (8 ký tự đầu của id lịch hẹn, in hoa). Công thức PHẢI giống buildBillCode ở app (Non_F/src/app/lib/bookings.ts).
 */
export function billCode(bookingId: string, prefix = "MMT"): string {
  const raw = (bookingId || "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  return `${prefix}-${raw.slice(0, 8)}`;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Khớp khi gõ "MMT-C984D6C9", "mmtc984d6c9", "c984d6c9" hoặc 1 phần của mã. */
export function matchesCode(bookingId: string, query: string): boolean {
  const q = norm(query);
  return q.length > 0 && norm(billCode(bookingId)).includes(q);
}
