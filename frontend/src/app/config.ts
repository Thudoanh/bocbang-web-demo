const env = import.meta.env;

export const config = {
  apiBaseUrl: (env.VITE_API_BASE_URL ?? "http://localhost:8000/api/v1").replace(/\/$/, ""),
  wsBaseUrl: (env.VITE_WS_BASE_URL ?? "ws://localhost:8000/api/v1").replace(/\/$/, ""),
  maxUploadBytes: Number(env.VITE_MAX_UPLOAD_BYTES ?? 524_288_000),
  maxMediaDurationSeconds: Number(env.VITE_MAX_MEDIA_DURATION_SECONDS ?? 7_200),
};
