import { useAuth } from "../auth/AuthContext";
import { AppShell } from "../components/AppShell";
import { AuthPage } from "../pages/AuthPage";
import { HistoryPage } from "../pages/HistoryPage";
import { MeetingPage } from "../pages/MeetingPage";
import { MeetingsPage } from "../pages/MeetingsPage";
import { SettingsPage } from "../pages/SettingsPage";
import { UploadPage } from "../pages/UploadPage";

function route(pathname: string) {
  const upload = pathname.match(/^\/meetings\/([^/]+)\/upload$/); if (upload) return { page: "upload" as const, id: upload[1] };
  const meeting = pathname.match(/^\/meetings\/([^/]+)$/); if (meeting) return { page: "meeting" as const, id: meeting[1] };
  return { page: pathname === "/history" ? "history" as const : pathname === "/settings" ? "settings" as const : "meetings" as const };
}
export function App() {
  const { user, ready } = useAuth();
  if (!ready) return <div className="boot">Đang khôi phục phiên làm việc…</div>;
  if (!user) return <AuthPage />;
  const current = route(window.location.pathname);
  return <AppShell>{current.page === "meeting" ? <MeetingPage meetingId={current.id} /> : current.page === "upload" ? <UploadPage meetingId={current.id} /> : current.page === "history" ? <HistoryPage /> : current.page === "settings" ? <SettingsPage /> : <MeetingsPage />}</AppShell>;
}
