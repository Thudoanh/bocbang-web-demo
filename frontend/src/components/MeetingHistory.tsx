import { useCallback, useEffect, useRef, useState } from "react";
import { meetingsApi } from "../api/endpoints";
import { MEETINGS_CHANGED } from "../api/meetingEvents";
import { useAsync } from "../hooks/useAsync";
import type { Meeting } from "../types/domain";
import { Icon } from "./ui";

const PAGE_SIZE = 50;

export function MeetingHistory({ activeMeetingId }: { activeMeetingId?: string }) {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [revision, setRevision] = useState(0);
  const [items, setItems] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const request = useRef<AbortController | undefined>(undefined);
  const loadingPage = useRef(false);
  const offset = useRef(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  const activeMeeting = useAsync(
    () => activeMeetingId ? meetingsApi.get(activeMeetingId) : Promise.resolve(undefined),
    [activeMeetingId, revision],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    window.addEventListener(MEETINGS_CHANGED, refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener(MEETINGS_CHANGED, refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [refresh]);

  useEffect(() => {
    const controller = new AbortController();
    request.current = controller;
    loadingPage.current = true;
    offset.current = 0;
    setLoading(true);
    setError(false);
    setItems([]);
    setHasMore(false);
    void meetingsApi.list({ limit: PAGE_SIZE, q: query || undefined }, controller.signal)
      .then((page) => {
        if (controller.signal.aborted) return;
        setItems(page);
        offset.current = page.length;
        setHasMore(page.length === PAGE_SIZE);
      })
      .catch(() => { if (!controller.signal.aborted) setError(true); })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
          loadingPage.current = false;
        }
      });
    return () => controller.abort();
  }, [query, revision]);

  async function loadMore() {
    const controller = request.current;
    if (!controller || controller.signal.aborted || loadingPage.current) return;
    loadingPage.current = true;
    setLoading(true);
    setError(false);
    try {
      const page = await meetingsApi.list({ limit: PAGE_SIZE, offset: offset.current, q: query || undefined }, controller.signal);
      if (controller.signal.aborted) return;
      offset.current += page.length;
      setItems((current) => {
        const known = new Set(current.map((meeting) => meeting.id));
        return [...current, ...page.filter((meeting) => !known.has(meeting.id))];
      });
      setHasMore(page.length === PAGE_SIZE);
    } catch {
      if (!controller.signal.aborted) setError(true);
    } finally {
      if (!controller.signal.aborted) {
        loadingPage.current = false;
        setLoading(false);
      }
    }
  }

  const groups = new Map<string, Meeting[]>();
  for (const meeting of items) {
    const label = historyGroup(meeting.updated_at);
    groups.set(label, [...(groups.get(label) ?? []), meeting]);
  }

  return <section className="meeting-history" aria-label="Lịch sử cuộc họp">
    <label className="history-search">
      <Icon name="search" />
      <input type="search" aria-label="Tìm cuộc họp" placeholder="Tìm cuộc họp…" maxLength={255} value={search} onChange={(event) => setSearch(event.target.value)} />
    </label>
    <div className="history-heading"><span>Các cuộc họp</span><a href="/history">Xem tất cả</a></div>
    <div className="history-scroll" aria-busy={loading}>
      <nav aria-label="Danh sách cuộc họp">
        {!query && activeMeeting.data && !items.some((meeting) => meeting.id === activeMeetingId) && <div className="history-group">
          <h2>Đang mở</h2>
          <a className="history-meeting selected" href={`/meetings/${activeMeeting.data.id}`} aria-current="page" title={activeMeeting.data.title}>
            <Icon name={activeMeeting.data.source_type === "upload" ? "upload" : "meeting"} />
            <span>{activeMeeting.data.title}</span>
          </a>
        </div>}
        {[...groups].map(([label, meetings]) => <div className="history-group" key={label}>
          <h2>{label}</h2>
          {meetings.map((meeting) => <a
            key={meeting.id}
            className={`history-meeting ${meeting.id === activeMeetingId ? "selected" : ""}`}
            href={`/meetings/${meeting.id}`}
            aria-current={meeting.id === activeMeetingId ? "page" : undefined}
            title={meeting.title}
          >
            <Icon name={meeting.source_type === "upload" ? "upload" : "meeting"} />
            <span>{meeting.title}</span>
          </a>)}
        </div>)}
      </nav>
      {loading && <p className="history-message" role="status">Đang tải cuộc họp…</p>}
      {!loading && !error && items.length === 0 && <p className="history-message">{query ? "Không tìm thấy cuộc họp." : "Chưa có cuộc họp. Tạo cuộc họp đầu tiên để bắt đầu."}</p>}
      {error && <div className="history-message" role="alert"><p>Chưa tải được lịch sử.</p><button type="button" onClick={items.length ? () => { void loadMore(); } : refresh}>Thử lại</button></div>}
      {!error && hasMore && !loading && <button className="history-load-more" type="button" onClick={() => { void loadMore(); }}>Xem thêm cuộc họp</button>}
    </div>
  </section>;
}

function historyGroup(value: string) {
  const date = new Date(value);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const week = new Date(today);
  week.setDate(today.getDate() - 7);
  if (date >= today) return "Hôm nay";
  if (date >= yesterday) return "Hôm qua";
  if (date >= week) return "7 ngày qua";
  return "Trước đó";
}
