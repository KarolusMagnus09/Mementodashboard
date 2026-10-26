import { supabase } from "./supabase";

export type AdminNotification = {
  id: string;
  user_id: string;
  type: string;
  tab: string;
  title: string;
  body: string;
  booking_id: string | null;
  data: Record<string, unknown> | null;
  read_at: string | null;
  created_at: string;
};

/** Trang đích của một thông báo (để chấm đỏ nhỏ ở sidebar + bấm vào là chuyển trang) */
export type NotifTarget = "reports" | "bookings" | "bank" | "other";

/**
 * Suy ra trang từ nội dung thông báo. Các trigger notif_* gửi cho admin theo 3 nhóm:
 * report (profile_reports), đổi TK ngân hàng (bank_change_requests), đơn/thanh toán (có booking_id).
 * Nếu loại thông báo của bạn đặt tên khác, chỉ cần sửa 2 dòng includes bên dưới.
 */
export function notifTarget(n: Pick<AdminNotification, "type" | "booking_id" | "data">): NotifTarget {
  const t = (n.type || "").toLowerCase();
  if (t.includes("report")) return "reports";
  if (t.includes("bank")) return "bank";
  if (n.booking_id || t.includes("booking") || t.includes("paid") || t.includes("payment") || t.includes("handover") || t.includes("final") || t.includes("shoot") || t.includes("feedback")) return "bookings";
  return "other";
}

const LIST_LIMIT = 200;

export async function fetchNotifications(userId: string): Promise<AdminNotification[] | null> {
  const { data, error } = await supabase
    .from("notifications")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(LIST_LIMIT);
  if (error) {
    console.warn("[notifications] fetch", error.message);
    return null;
  }
  return (data ?? []) as AdminNotification[];
}

/** Tổng chưa đọc (đếm trên server → đúng cả khi có hơn 200 thông báo) */
export async function fetchUnreadTotal(userId: string): Promise<number | null> {
  const { count, error } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("read_at", null);
  return error ? null : (count ?? 0);
}

export async function markRead(ids?: string[]): Promise<void> {
  const { error } = await supabase.rpc("mark_notifications_read", { p_ids: ids ?? null, p_tab: null });
  if (error) console.warn("[notifications] markRead", error.message);
}

export async function deleteNotification(id: string): Promise<void> {
  const { error } = await supabase.from("notifications").delete().eq("id", id);
  if (error) console.warn("[notifications] delete", error.message);
}

export function subscribeNotifications(
  userId: string,
  h: { onInsert: (n: AdminNotification) => void; onChange: () => void },
): () => void {
  let first = true;
  const ch = supabase
    .channel(`admin-notif:${userId}:${Math.random().toString(36).slice(2, 8)}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
      (p) => { h.onInsert(p.new as AdminNotification); h.onChange(); })
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
      () => h.onChange())
    .on("postgres_changes", { event: "DELETE", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
      () => h.onChange())
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        if (!first) h.onChange(); // kết nối lại → bù những gì bị lỡ
        first = false;
      }
    });
  return () => { supabase.removeChannel(ch); };
}

export function formatBadge(n: number): string {
  return n > 99 ? "99+" : String(n);
}

export function formatNotifTime(iso: string): string {
  const d = new Date(iso);
  const min = Math.floor((Date.now() - d.getTime()) / 60000);
  if (min < 1) return "Vừa xong";
  if (min < 60) return `${min} phút trước`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} giờ trước`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days} ngày trước`;
  return d.toLocaleDateString("vi-VN");
}

export function notifIcon(type: string): string {
  const t = type.toLowerCase();
  if (t.includes("report")) return "🚩";
  if (t.includes("bank")) return "🏦";
  if (t.startsWith("shoot_")) return "📷";
  if (t.startsWith("final_") || t === "completed") return "✅";
  if (t.includes("paid") || t.includes("payment")) return "💳";
  if (t.includes("feedback")) return "✏️";
  if (t.includes("handover")) return "📸";
  if (t.startsWith("booking")) return "📩";
  return "🔔";
}
