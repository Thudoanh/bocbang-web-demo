import { config } from "../app/config";
import { apiClient } from "./client";
import type { AuthSession, Capabilities, Comment, ExportArtifact, ExportFormat, Job, Meeting, MediaFile, Permission, Segment, Speaker, SummaryTemplate, Transcript } from "../types/domain";

export const authApi = {
  login: (email: string, password: string) => apiClient.post<AuthSession>("/auth/login", { email, password }),
  register: (email: string, password: string, full_name: string) => apiClient.post<{ user: { id: string } }>("/auth/register", { email, password, full_name }),
  verifyOtp: (email: string, code: string) => apiClient.post<AuthSession>("/auth/verify-email-otp", { email, code }),
  resendOtp: (email: string) => apiClient.post<void>("/auth/resend-email-otp", { email }),
  refresh: (refresh_token?: string) => apiClient.post<AuthSession>("/auth/refresh", refresh_token ? { refresh_token } : undefined),
  logout: () => apiClient.post<void>("/auth/logout"),
  forgotPassword: (email: string) => apiClient.post<void>("/auth/forgot-password", { email }),
  resetPassword: (email: string, code: string, new_password: string) => apiClient.post<void>("/auth/reset-password", { email, code, new_password }),
  googleUrl: () => "/auth/google/start",
};

export const meetingsApi = {
  list: () => apiClient.get<Meeting[]>("/meetings"),
  get: (id: string) => apiClient.get<Meeting>(`/meetings/${id}`),
  create: (body: Pick<Meeting, "title" | "description" | "source_type" | "language_mode" | "diarization_enabled">) => apiClient.post<Meeting>("/meetings", body),
  update: (id: string, body: Partial<Pick<Meeting, "title" | "description" | "language_mode" | "diarization_enabled">>) => apiClient.patch<Meeting>(`/meetings/${id}`, body),
  remove: (id: string) => apiClient.delete<void>(`/meetings/${id}`),
  uploadMedia: (id: string, file: File) => { const data = new FormData(); data.append("file", file); return apiClient.post<MediaFile | Job>(`/meetings/${id}/media`, data); },
  media: (id: string) => apiClient.get<MediaFile[]>(`/meetings/${id}/media`),
  transcript: (id: string) => apiClient.get<Transcript>(`/meetings/${id}/transcript`),
  versions: (id: string) => apiClient.get<Array<{ id: string; version_no: number; source: string; created_at: string }>>(`/meetings/${id}/transcript/versions`),
  saveSegment: (id: string, body: { text?: string; start_ms?: number; end_ms?: number }) => apiClient.patch<{ version_id: string }>(`/segments/${id}`, body),
  deleteSegment: (id: string) => apiClient.delete<{ version_id: string }>(`/segments/${id}`),
  splitSegment: (id: string, split_at_ms: number) => apiClient.post<{ version_id: string }>(`/segments/${id}/split`, { split_at_ms }),
  mergeSegments: (first_segment_id: string, second_segment_id: string) => apiClient.post<{ version_id: string }>("/segments/merge", { first_segment_id, second_segment_id }),
  speakers: (id: string) => apiClient.get<Speaker[]>(`/meetings/${id}/speakers`),
  updateSpeaker: (id: string, body: Partial<Speaker>) => apiClient.patch<Speaker>(`/speakers/${id}`, body),
  setSegmentSpeaker: (id: string, speaker_id: string) => apiClient.patch<Segment>(`/segments/${id}/speaker`, { speaker_id }),
  addMember: (meetingId: string, email: string, permission: Exclude<Permission, "owner">) => apiClient.post<void>(`/meetings/${meetingId}/members`, { email, permission }),
  translation: (id: string, source_language: string, target_language: string) => apiClient.post<Job>(`/meetings/${id}/translations`, { source_language, target_language }),
  summary: (id: string, template: SummaryTemplate) => apiClient.post<Job>(`/meetings/${id}/summaries`, { template }),
  comments: (id: string) => apiClient.get<Comment[]>(`/meetings/${id}/comments`),
  addComment: (id: string, body: string, segment_logical_id?: string) => apiClient.post<Comment>(`/meetings/${id}/comments`, { body, segment_logical_id }),
  updateComment: (id: string, body: string) => apiClient.patch<Comment>(`/comments/${id}`, { body }),
  deleteComment: (id: string) => apiClient.delete<void>(`/comments/${id}`),
  export: (id: string, format: ExportFormat) => apiClient.post<ExportArtifact>(`/meetings/${id}/exports`, { format }),
  exportDownloadUrl: (id: string) => `${config.apiBaseUrl}/exports/${id}/download`,
};
export const capabilitiesApi = { get: () => apiClient.get<Capabilities>("/capabilities") };
export const jobsApi = { get: (id: string) => apiClient.get<Job>(`/jobs/${id}`) };
