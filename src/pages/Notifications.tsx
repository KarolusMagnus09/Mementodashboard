import { useState } from "react";
import {
  deleteNotification,
  formatNotifTime,
  notifIcon,
  notifTarget,
  type AdminNotification,
} from "../lib/notifications";

export default function Notifications({
  items, onOpen, onMarkAll, onChanged,
}: {
  items: AdminNotification[];
  onOpen: (n: AdminNotification) => void;
  onMarkAll: () => void;
  onChanged: () => void;
}) {
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [perm, setPerm] = useState<string>(typeof Notification !== "undefined" ? Notification.permission : "unsupported");
  const list = onlyUnread ? items.filter((n) => !n.read_at) : items;
  const unread = items.filter((n) => !n.read_at).length;

  async function askPermission() {
    try {
      const r = await Notification.requestPermission();
      setPerm(r);
    } catch { /* ignore */ }
  }

  return (
    <>
      <div className="topbar">
        <h2>Thông báo {unread > 0 && <span className="notif-pill">{unread > 99 ? "99+" : unread}</span>}</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="btn btn-ghost" onClick={() => setOnlyUnread((v) => !v)}>
            {onlyUnread ? "Hiện tất cả" : "Chỉ chưa đọc"}
          </button>
          <button type="button" className="btn btn-primary" disabled={unread === 0} onClick={onMarkAll}>
            Đánh dấu tất cả đã đọc
          </button>
        </div>
      </div>

      {perm === "default" && (
        <div className="card" style={{ marginBottom: 12, fontSize: 13 }}>
          Bật thông báo trình duyệt để nhận cảnh báo khi đang mở tab khác.{" "}
          <button type="button" className="btn btn-ghost" onClick={askPermission}>Bật</button>
        </div>
      )}

      {list.length === 0 ? (
        <div className="card">{onlyUnread ? "Không có thông báo chưa đọc." : "Chưa có thông báo nào."}</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {list.map((n) => (
            <div
              key={n.id}
              className={`card notif-row ${n.read_at ? "" : "unread"}`}
              onClick={() => onOpen(n)}
            >
              <span className="notif-toast-ico">{notifIcon(n.type)}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>
                  {n.title}
                  {!n.read_at && <span className="notif-dot-inline" />}
                </div>
                <div className="muted" style={{ marginTop: 2 }}>{n.body}</div>
                <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                  {formatNotifTime(n.created_at)}
                  {notifTarget(n) !== "other" && " · bấm để mở"}
                </div>
              </div>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={async (e) => { e.stopPropagation(); await deleteNotification(n.id); onChanged(); }}
              >
                Xóa
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
