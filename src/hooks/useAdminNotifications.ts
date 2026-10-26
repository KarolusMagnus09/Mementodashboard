import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchNotifications,
  fetchUnreadTotal,
  markRead,
  notifTarget,
  subscribeNotifications,
  type AdminNotification,
  type NotifTarget,
} from "../lib/notifications";

export type Page = "dashboard" | "applications" | "profiles" | "photographers" | "bookings" | "updates" | "bank" | "payments" | "reports" | "notifications" | "requests";

/** Trang sidebar tương ứng với từng nhóm thông báo */
const TARGET_PAGE: Record<NotifTarget, Page | null> = {
  reports: "reports",
  bookings: "bookings",
  bank: "bank",
  other: null,
};

/**
 * Gọi ở App TRƯỚC mọi `return` sớm. `enabled` = đã đăng nhập và là admin.
 *  • total: số chưa đọc (chuông, hiện 99+)
 *  • byPage: số chưa đọc theo trang (chấm đỏ nhỏ ở sidebar)
 *  • toasts: popup Realtime (tối đa 3, tự tắt sau 7 giây)
 *  • đang mở trang X → thông báo thuộc trang X tự đánh dấu đã đọc
 */
export function useAdminNotifications(userId: string | null, enabled: boolean, currentPage: Page) {
  const [items, setItems] = useState<AdminNotification[]>([]);
  const [total, setTotal] = useState(0);
  const [toasts, setToasts] = useState<AdminNotification[]>([]);
  const seq = useRef(0);
  const refreshTimer = useRef<number | undefined>(undefined);
  const pageRef = useRef(currentPage);
  pageRef.current = currentPage;

  const refresh = useCallback(async () => {
    const my = ++seq.current;
    if (!userId || !enabled) {
      setItems([]);
      setTotal(0);
      return;
    }
    const [list, t] = await Promise.all([fetchNotifications(userId), fetchUnreadTotal(userId)]);
    if (my !== seq.current) return;
    if (list) setItems(list);
    if (t !== null) setTotal(t);
  }, [userId, enabled]);

  const dismissToast = useCallback((id: string) => {
    setToasts((l) => l.filter((x) => x.id !== id));
  }, []);

  useEffect(() => {
    if (!userId || !enabled) {
      seq.current++;
      setItems([]);
      setTotal(0);
      setToasts([]);
      return;
    }
    void refresh();
    const schedule = () => {
      window.clearTimeout(refreshTimer.current);
      refreshTimer.current = window.setTimeout(() => void refresh(), 250);
    };
    const unsub = subscribeNotifications(userId, {
      onInsert: (n) => {
        setToasts((l) => [n, ...l.filter((x) => x.id !== n.id)].slice(0, 3));
        window.setTimeout(() => setToasts((l) => l.filter((x) => x.id !== n.id)), 7000);
        // Thông báo của trình duyệt khi tab đang ẩn
        try {
          if (document.hidden && "Notification" in window && Notification.permission === "granted") {
            new Notification(n.title, { body: n.body });
          }
        } catch { /* ignore */ }
      },
      onChange: schedule,
    });
    const onVis = () => { if (!document.hidden) schedule(); };
    document.addEventListener("visibilitychange", onVis);
    const poll = window.setInterval(() => { if (!document.hidden) schedule(); }, 60000); // dự phòng nếu Realtime rớt
    return () => {
      unsub();
      document.removeEventListener("visibilitychange", onVis);
      window.clearInterval(poll);
      window.clearTimeout(refreshTimer.current);
    };
  }, [userId, enabled, refresh]);

  const byPage = useMemo(() => {
    const c: Partial<Record<Page, number>> = {};
    for (const n of items) {
      if (n.read_at) continue;
      const p = TARGET_PAGE[notifTarget(n)];
      if (p) c[p] = (c[p] || 0) + 1;
    }
    return c;
  }, [items]);

  // Đang đứng ở trang nào thì thông báo của trang đó coi như đã xem
  useEffect(() => {
    if (!enabled) return;
    const ids = items
      .filter((n) => !n.read_at && TARGET_PAGE[notifTarget(n)] === currentPage)
      .map((n) => n.id);
    if (ids.length === 0) return;
    const now = new Date().toISOString();
    setItems((l) => l.map((n) => (ids.includes(n.id) ? { ...n, read_at: now } : n)));
    setTotal((t) => Math.max(0, t - ids.length));
    void markRead(ids);
  }, [items, currentPage, enabled]);

  const markOne = useCallback(async (id: string) => {
    const now = new Date().toISOString();
    setItems((l) => l.map((n) => (n.id === id && !n.read_at ? { ...n, read_at: now } : n)));
    await markRead([id]);
    void refresh();
  }, [refresh]);

  const markAll = useCallback(async () => {
    const now = new Date().toISOString();
    setItems((l) => l.map((n) => (n.read_at ? n : { ...n, read_at: now })));
    setTotal(0);
    await markRead();
    void refresh();
  }, [refresh]);

  return { items, total, byPage, toasts, dismissToast, markOne, markAll, refresh };
}
