import { useAuth } from "../auth/AuthContext";
import { AppShell } from "../components/AppShell";
import { AuthPage } from "../pages/AuthPage";
import { ExportSharePage } from "../pages/ExportSharePage";
import { MeetingPage } from "../pages/MeetingPage";
import { MeetingsPage } from "../pages/MeetingsPage";
import { SettingsPage } from "../pages/SettingsPage";
import { SharePage } from "../pages/SharePage";
import { SpeakersPage } from "../pages/SpeakersPage";
import { SummaryPage } from "../pages/SummaryPage";
import { TranslationPage } from "../pages/TranslationPage";
import { UploadPage } from "../pages/UploadPage";
import { VoiceProfilesPage } from "../pages/VoiceProfilesPage";
import { route } from "./route";

export function App() {
  const { user, ready } = useAuth();
  const current = route(window.location.pathname);
  if (current.page === "share") return <SharePage token={current.token} />;
  if (!ready) return (
    <div className="boot">
      <div className="boot-logo"><svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{width:28,height:28}}><path d="M3 12h2m2-5v10m4-14v18m4-14v10m4-7v4m2-2h2" /></svg></div>
      <span>Đang tải…</span>
    </div>
  );
  if (!user) return <AuthPage initialMode={current.page === "auth" ? current.mode : "login"} />;
  return <AppShell>{current.page === "voice-profiles" ? <VoiceProfilesPage /> : current.page === "meeting" ? <MeetingPage meetingId={current.id} /> : current.page === "upload" ? <UploadPage meetingId={current.id} /> : current.page === "speakers" ? <SpeakersPage meetingId={current.id} /> : current.page === "translation" ? <TranslationPage meetingId={current.id} /> : current.page === "summary" ? <SummaryPage meetingId={current.id} /> : current.page === "export-share" ? <ExportSharePage meetingId={current.id} /> : current.page === "settings" ? <SettingsPage /> : current.page === "history" ? <MeetingsPage /> : <MeetingsPage createOnly initialSource={new URLSearchParams(window.location.search).get("mode") === "upload" ? "upload" : undefined} />}</AppShell>;
}
