export type Permission = "read" | "comment" | "edit" | "owner";
export type MeetingStatus = "created" | "recording" | "processing" | "completed" | "failed";
export type JobStatus = "queued" | "processing" | "completed" | "failed";
export type SummaryTemplate = "general" | "briefing" | "voting";
export type ExportFormat = "pdf" | "docx" | "txt" | "srt" | "vtt" | "json";

export interface User { id: string; email: string; full_name: string; is_email_verified: boolean }
export interface AuthSession { access_token: string; refresh_token?: string; user: User }
export interface Meeting {
  id: string; title: string; description?: string; status: MeetingStatus; permission: Permission;
  owner_id: string; source_type: "realtime" | "upload"; language_mode: string;
  diarization_enabled: boolean; duration_ms?: number; created_at: string; updated_at: string;
}
export interface MediaFile { id: string; original_filename: string; size_bytes: number; duration_ms?: number; status: string }
export interface Speaker { id: string; name: string; role?: string; organization?: string; is_identified: boolean }
export interface Segment { logical_segment_id: string; start_ms: number; end_ms: number; text: string; speaker_id?: string; speaker_label?: string; confidence?: number }
export interface Transcript { version_id: string; language: string; segments: Segment[] }
export interface Capabilities {
  stt: { provider: string; batch: boolean; streaming: boolean; diarization: boolean; languages: string[]; timestamps?: boolean; confidence?: boolean };
  translation: { languages: string[] }; summary_templates: SummaryTemplate[]; exports: ExportFormat[];
}
export interface Job { id: string; status: JobStatus; progress?: number; error?: { code: string; message: string } }
export interface ApiErrorShape { code?: string; message?: string; detail?: string }
