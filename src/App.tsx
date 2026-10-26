import { Component, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase, type ProfileRow } from "./lib/supabase";
import Login from "./pages/Login";
import Applications from "./pages/Applications";
import ApplicationDetail from "./pages/ApplicationDetail";
import Profiles from "./pages/Profiles";
import Photographers from "./pages/Photographers";
import Bookings from "./pages/Bookings";
import Requests from "./pages/Requests";
import UpdateLogs from "./pages/UpdateLogs";
import PhotographerHistory from "./pages/PhotographerHistory";
import BankChanges from "./pages/BankChanges";
import PaymentLogs from "./pages/PaymentLogs";
import Reports from "./pages/Reports";
import Dashboard from "./pages/Dashboard";
import UserDetail from "./pages/UserDetail";
import Notifications from "./pages/Notifications";
import NotifToasts from "./components/NotifToasts";
import { useAdminNotifications, type Page } from "./hooks/useAdminNotifications";
import { formatBadge, notifTarget, type AdminNotification } from "./lib/notifications";

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState<Page>("dashboard");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [historyMode, setHistoryMode] = useState<"transactions" | "bookings" | null>(null);
  const [historyName, setHistoryName] = useState<string | null>(null);
  // Chi tiết tài khoản (thông tin / giao dịch / chat / report / ban / xóa).
  // Là ngăn xếp để bấm từ tài khoản này sang tài khoản khác rồi quay lại được.
  const [userStack, setUserStack] = useState<string[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session?.user?.id) {
      setProfile(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", session.user.id)
        .maybeSingle();
      if (!cancelled) setProfile((data as ProfileRow) || null);
    })();
    return () => { cancelled = true; };
  }, [session?.user?.id]);

  // Thông báo (chuông, chấm đỏ, popup): chỉ bật cho admin. Gọi trước mọi return sớm.
  const isAdmin = profile?.role === "admin";
  const inSubView = userStack.length > 0 || !!selectedUserId;
  const notif = useAdminNotifications(session?.user?.id ?? null, isAdmin, inSubView ? "applications" : page);

  function goPage(p: Page) {
    setPage(p);
    setUserStack([]);
    setSelectedUserId(null);
    setHistoryMode(null);
  }

  function openNotif(n: AdminNotification) {
    void notif.markOne(n.id);
    notif.dismissToast(n.id);
    const t = notifTarget(n);
    if (t === "reports") goPage("reports");
    else if (t === "bookings") goPage("bookings");
    else if (t === "bank") goPage("bank");
    else goPage("notifications");
  }

  const nx: SidebarNotif = {
    total: notif.total,
    byPage: notif.byPage,
    toasts: notif.toasts,
    onBell: () => goPage("notifications"),
    onToastOpen: openNotif,
    onToastClose: notif.dismissToast,
  };

  if (loading) {
    return (
      <div className="login-wrap">
        <p style={{ color: "#fff" }}>Đang tải...</p>
      </div>
    );
  }

  if (!session) return <Login />;

  if (profile && profile.role !== "admin") {
    return (
      <div className="login-wrap">
        <div className="login-card">
          <h1>Không có quyền</h1>
          <p className="sub">
            Tài khoản <strong>{session.user.email}</strong> chưa có role <code>admin</code>.
            Chạy SQL trong <code>sql/012_admin_applications.sql</code> để gán quyền.
          </p>
          <button className="btn btn-primary" style={{ width: "100%" }}
            onClick={() => supabase.auth.signOut()}>
            Đăng xuất
          </button>
        </div>
      </div>
    );
  }

  if (userStack.length > 0) {
    const current = userStack[userStack.length - 1];
    return (
      <div className="layout">
        <Sidebar {...nx} page={page} setPage={(p) => { setPage(p); setUserStack([]); setSelectedUserId(null); setHistoryMode(null); }} email={session.user.email} />
        <div className="main">
          <UserDetail
            key={current}
            userId={current}
            onBack={() => { setUserStack((s) => s.slice(0, -1)); setRefreshKey((k) => k + 1); }}
            onOpenUser={(id) => setUserStack((s) => [...s, id])}
            onChanged={() => setRefreshKey((k) => k + 1)}
          />
        </div>
      </div>
    );
  }

  if (selectedUserId && historyMode) {
    return (
      <div className="layout">
        <Sidebar {...nx} page={page} setPage={(p) => { setPage(p); setSelectedUserId(null); setHistoryMode(null); }} email={session.user.email} />
        <div className="main">
          <PhotographerHistory
            userId={selectedUserId}
            name={historyName}
            mode={historyMode}
            onBack={() => setHistoryMode(null)}
          />
        </div>
      </div>
    );
  }

  if (selectedUserId) {
    return (
      <div className="layout">
        <Sidebar {...nx} page={page} setPage={(p) => { setPage(p); setSelectedUserId(null); setHistoryMode(null); }} email={session.user.email} />
        <div className="main">
          <ApplicationDetail
            userId={selectedUserId}
            onBack={() => { setSelectedUserId(null); setHistoryMode(null); }}
            onOpenHistory={(mode) => setHistoryMode(mode)}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="layout">
      <Sidebar {...nx} page={page} setPage={setPage} email={session.user.email} />
      <div className="main">
        {page === "dashboard" && (
          <DashboardFrame>
            <Dashboard />
          </DashboardFrame>
        )}
        {page === "applications" && (
          <Applications onOpen={(id) => setSelectedUserId(id)} />
        )}
        {page === "profiles" && <Profiles key={refreshKey} onOpenUser={(id) => setUserStack([id])} />}
        {page === "photographers" && <Photographers />}
        {page === "bookings" && <Bookings />}
        {page === "requests" && <Requests />}
        {page === "updates" && <UpdateLogs />}
        {page === "bank" && <BankChanges />}
        {page === "payments" && <PaymentLogs />}
        {page === "reports" && <Reports key={refreshKey} onOpenUser={(id) => setUserStack([id])} />}
        {page === "notifications" && (
          <Notifications items={notif.items} onOpen={openNotif} onMarkAll={notif.markAll} onChanged={notif.refresh} />
        )}
      </div>
    </div>
  );
}

type SidebarNotif = {
  total: number;
  byPage: Partial<Record<Page, number>>;
  toasts: AdminNotification[];
  onBell: () => void;
  onToastOpen: (n: AdminNotification) => void;
  onToastClose: (id: string) => void;
};

function Sidebar({
  page, setPage, email, total, byPage, toasts, onBell, onToastOpen, onToastClose,
}: {
  page: Page;
  setPage: (p: Page) => void;
  email?: string | null;
} & SidebarNotif) {
  const dot = (p: Page) =>
    byPage[p] ? <span className="nav-dot">{formatBadge(byPage[p]!)}</span> : null;
  return (
    <aside className="sidebar">
      <div className="title-row">
        <h1>📷 Memento Admin</h1>
        <button
          type="button"
          className={`notif-bell ${page === "notifications" ? "active" : ""}`}
          aria-label="Thông báo"
          onClick={onBell}
        >
          🔔
          {total > 0 && <span className="notif-badge">{formatBadge(total)}</span>}
        </button>
      </div>
      <NotifToasts toasts={toasts} onOpen={onToastOpen} onClose={onToastClose} />
      <button className={`nav ${page === "dashboard" ? "active" : ""}`}
        onClick={() => setPage("dashboard")}>📊 Dashboard</button>
      <button className={`nav ${page === "applications" ? "active" : ""}`}
        onClick={() => setPage("applications")}>Hồ sơ PTG</button>
      <button className={`nav ${page === "reports" ? "active" : ""}`}
        onClick={() => setPage("reports")}>Xử lý report{dot("reports")}</button>
      <button className={`nav ${page === "profiles" ? "active" : ""}`}
        onClick={() => setPage("profiles")}>Danh sách người dùng</button>
      <button className={`nav ${page === "photographers" ? "active" : ""}`}
        onClick={() => setPage("photographers")}>Marketplace</button>
      <button className={`nav ${page === "bookings" ? "active" : ""}`}
        onClick={() => setPage("bookings")}>Đơn & thanh toán{dot("bookings")}</button>
      <button className={`nav ${page === "requests" ? "active" : ""}`}
        onClick={() => setPage("requests")}>📢 Đơn tìm PTG</button>
      <button className={`nav ${page === "payments" ? "active" : ""}`}
        onClick={() => setPage("payments")}>Log giao dịch</button>
      <button className={`nav ${page === "bank" ? "active" : ""}`}
        onClick={() => setPage("bank")}>Đổi TK ngân hàng{dot("bank")}</button>
      <button className={`nav ${page === "updates" ? "active" : ""}`}
        onClick={() => setPage("updates")}>Log cập nhật</button>
      <div className="foot">
        <div style={{ marginBottom: 8 }}>{email}</div>
        <button className="nav" onClick={() => supabase.auth.signOut()}>Đăng xuất</button>
      </div>
    </aside>
  );
}

/**
 * Khung bọc Dashboard: toàn bộ nội dung nằm trong một trang cuộn dọc riêng
 * (cột .main), và có ErrorBoundary để nếu Dashboard lỗi thì thanh sidebar
 * chính vẫn hoạt động bình thường.
 */
class DashboardBoundary extends Component<{ children: ReactNode }, { err: Error | null }> {
  state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) {
    return { err };
  }
  render() {
    if (this.state.err) {
      return (
        <div className="card">
          <strong>Dashboard gặp lỗi khi hiển thị</strong>
          <p className="muted">{this.state.err.message}</p>
          <button className="btn btn-primary" onClick={() => this.setState({ err: null })}>Thử lại</button>
        </div>
      );
    }
    return this.props.children;
  }
}

function DashboardFrame({ children }: { children: ReactNode }) {
  return (
    <div className="dash-frame">
      <DashboardBoundary>{children}</DashboardBoundary>
    </div>
  );
}
