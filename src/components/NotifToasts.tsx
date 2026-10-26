import { formatNotifTime, notifIcon, type AdminNotification } from "../lib/notifications";

/** Popup thông báo mới (góc phải trên). Bấm vào = mở trang liên quan. */
export default function NotifToasts({
  toasts, onOpen, onClose,
}: {
  toasts: AdminNotification[];
  onOpen: (n: AdminNotification) => void;
  onClose: (id: string) => void;
}) {
  if (toasts.length === 0) return null;
  return (
    <div className="notif-toasts">
      {toasts.map((n) => (
        <div key={n.id} className="notif-toast" role="status" onClick={() => onOpen(n)}>
          <span className="notif-toast-ico">{notifIcon(n.type)}</span>
          <div className="notif-toast-txt">
            <strong>{n.title}</strong>
            <span>{n.body}</span>
            <small>{formatNotifTime(n.created_at)}</small>
          </div>
          <button
            type="button"
            aria-label="Đóng"
            onClick={(e) => { e.stopPropagation(); onClose(n.id); }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
