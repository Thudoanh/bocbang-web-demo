import { useEffect, useState } from "react";
import { capabilitiesApi, meetingsApi } from "../api/endpoints";
import { MEETING_SECTIONS_CHANGED } from "../api/meetingEvents";
import { useAsync } from "../hooks/useAsync";
import { useJobMonitor } from "../state/useJobMonitor";
import { can } from "../utils/permissions";
import type { MeetingSection, SessionSummary, Summary, SummaryLanguage, SummaryMode, SummaryScope, SummaryTemplate } from "../types/domain";
import { formatTimestampInput } from "../utils/time";
import { Button, Empty, Failure, Loading, PageHeading, Status, statusLabel } from "../components/ui";

const templateLabels: Record<SummaryTemplate, string> = {
  general: "Tóm tắt chung",
  briefing: "Họp giao ban",
  voting: "Họp biểu quyết",
};
const languageLabels: Record<SummaryLanguage, string> = { vi: "Tiếng Việt", en: "English" };
const MAX_PROMPT_LENGTH = 4000;

type CustomSection = { heading: string; content: string };

export function SummaryPage({ meetingId }: { meetingId: string }) {
  const meeting = useAsync(() => meetingsApi.get(meetingId), [meetingId]);
  const transcript = useAsync(() => meetingsApi.transcript(meetingId), [meetingId]);
  const summaries = useAsync(() => meetingsApi.summaries(meetingId), [meetingId]);
  const sections = useAsync(() => meetingsApi.sections(meetingId), [meetingId]);
  const capabilities = useAsync(capabilitiesApi.get, []);
  const jobs = useJobMonitor();
  const [mode, setMode] = useState<SummaryMode>("template");
  const [scope, setScope] = useState<SummaryScope>("sessions");
  const [selection, setSelection] = useState<string[] | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [editingSection, setEditingSection] = useState<number>();
  const [template, setTemplate] = useState<SummaryTemplate>("general");
  const [prompt, setPrompt] = useState("");
  const [outputLanguage, setOutputLanguage] = useState<SummaryLanguage>("vi");
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const transcriptLanguage = meeting.data?.language_mode;
    setOutputLanguage(transcriptLanguage === "en" ? "en" : "vi");
  }, [meeting.data?.language_mode, meetingId]);
  useEffect(() => {
    if (jobs.job?.status === "completed") void summaries.reload();
  }, [jobs.job?.status, summaries.reload]);
  useEffect(() => { setEditing(false); setEditingSection(undefined); }, [scope, mode, template, outputLanguage, meetingId]);
  useEffect(() => { setSelection(null); }, [meetingId]);
  useEffect(() => {
    const refresh = () => { void sections.reload(); };
    const changed = (event: Event) => {
      if ((event as CustomEvent<{ meetingId: string }>).detail?.meetingId === meetingId) refresh();
    };
    window.addEventListener(MEETING_SECTIONS_CHANGED, changed);
    window.addEventListener("focus", refresh);
    return () => { window.removeEventListener(MEETING_SECTIONS_CHANGED, changed); window.removeEventListener("focus", refresh); };
  }, [meetingId, sections.reload]);

  if (meeting.loading || transcript.loading) return <Loading />;
  if (meeting.error || !meeting.data) {
    return <Failure error={meeting.error ?? new Error("Không tìm thấy cuộc họp.")} retry={meeting.reload} />;
  }

  const editable = can(meeting.data.permission, "edit");
  const hasTranscript = Boolean(transcript.data?.segments.length);
  const summary = summaries.data
    ?.filter((item) => (item.scope ?? "meeting") === scope)
    .filter((item) => item.output_language === outputLanguage && item.mode === mode)
    .filter((item) => mode === "custom" || item.template === template)
    .sort((left, right) => Date.parse(right.current_version.created_at) - Date.parse(left.current_version.created_at))[0];
  const availableLanguages = capabilities.data?.summary_languages.length
    ? capabilities.data.summary_languages
    : (["vi", "en"] as SummaryLanguage[]);
  const availableTemplates = capabilities.data?.summary_templates.length
    ? capabilities.data.summary_templates
    : (Object.keys(templateLabels) as SummaryTemplate[]);
  const providerSupportsMode = mode === "custom"
    ? Boolean(capabilities.data?.custom_summary_prompt)
    : Boolean(capabilities.data?.summary_templates.includes(template));
  const requestValid = mode === "template" || Boolean(prompt.trim());
  const selectedIds = selection ?? sections.data?.map((section) => section.id) ?? [];
  const missingSelection = selectedIds.some((id) => !sections.data?.some((section) => section.id === id));
  const validSelection = scope === "meeting" || (!sections.loading && !sections.error && Boolean(sections.data)
    && !missingSelection && (sections.data!.length === 0 ? selection === null : selectedIds.length > 0));
  const generating = submitting || ["queued", "processing", "retrying"].includes(jobs.job?.status ?? "");

  async function generate() {
    if (!validSelection || generating) return;
    setSubmitting(true);
    try {
      setError("");
      setNotice("");
      setEditing(false);
      setEditingSection(undefined);
      jobs.track(await meetingsApi.summary(meetingId, {
        mode,
        scope,
        section_ids: scope === "sessions" && sections.data?.length ? selectedIds : undefined,
        sections_revision: scope === "sessions" ? sections.data?.[0]?.revision ?? "" : undefined,
        template: mode === "template" ? template : undefined,
        prompt: mode === "custom" ? prompt.trim() : undefined,
        output_language: outputLanguage,
      }));
    } catch (cause) {
      setError((cause as Error).message);
      void sections.reload();
    } finally { setSubmitting(false); }
  }

  async function copy() {
    if (!summary) return;
    try {
      const sessions = summary.current_version.content.sessions as SessionSummary[] | undefined;
      await navigator.clipboard.writeText(scope === "sessions" && sessions
        ? sessions.map((session) => `${session.title}\n${session.content ? toText(session.content) : "Chưa có nội dung phát biểu."}`).join("\n\n")
        : toText(summary.current_version.content));
      setNotice("Đã sao chép tóm tắt.");
      setError("");
    } catch {
      setError("Không thể sao chép nội dung trong trình duyệt này.");
    }
  }

  async function saveEdit(content: Record<string, unknown>) {
    if (!summary) return;
    await meetingsApi.editSummary(summary.id, content, summary.current_version.version_no);
    await summaries.reload();
    setEditing(false);
    setEditingSection(undefined);
    setNotice("Đã lưu nội dung chỉnh sửa thành phiên bản mới.");
  }

  return <>
    <PageHeading eyebrow="TÓM TẮT" title="Tóm tắt" context={meeting.data.title} />
    <section className="summary-controls">
      <label className="field">Phạm vi tóm tắt
        <select value={scope} onChange={(event) => setScope(event.target.value as SummaryScope)}>
          <option value="sessions">Từng phiên họp</option>
          <option value="meeting">Toàn cuộc họp</option>
        </select>
      </label>
      <div className="summary-mode-field">
        <span>Cách tạo</span>
        <div className="summary-mode-switch" role="group" aria-label="Cách tạo tóm tắt">
          <button className={mode === "template" ? "active" : ""} type="button" onClick={() => setMode("template")}>Mẫu có sẵn</button>
          <button className={mode === "custom" ? "active" : ""} type="button" onClick={() => setMode("custom")}>Tự nhập prompt</button>
        </div>
      </div>
      {mode === "template" ? <label className="field">Mẫu
        <select value={template} onChange={(event) => setTemplate(event.target.value as SummaryTemplate)}>
          {availableTemplates.map((item) => <option key={item} value={item}>{templateLabels[item]}</option>)}
        </select>
      </label> : <label className="field summary-prompt-field">Mô tả mẫu bạn muốn
        <textarea
          value={prompt}
          maxLength={MAX_PROMPT_LENGTH}
          rows={5}
          placeholder="Ví dụ: Chia thành ba mục: vấn đề, phương án và người chịu trách nhiệm."
          onChange={(event) => setPrompt(event.target.value)}
        />
        <span>{prompt.length}/{MAX_PROMPT_LENGTH} ký tự</span>
      </label>}
      <label className="field summary-language-field">Ngôn ngữ
        <select value={outputLanguage} onChange={(event) => setOutputLanguage(event.target.value as SummaryLanguage)}>
          {availableLanguages.map((language) => <option key={language} value={language}>{languageLabels[language]}</option>)}
        </select>
      </label>
      {editable && <Button
        tone="dark"
        disabled={!hasTranscript || !requestValid || !validSelection || !providerSupportsMode || !availableLanguages.includes(outputLanguage) || generating}
        onClick={() => void generate()}
      >{summary ? "Tạo lại" : "Tạo tóm tắt"}</Button>}
      {summary && <Button onClick={() => void copy()}>Sao chép</Button>}
      {summary && editable && scope === "meeting" && <Button onClick={() => setEditing((value) => !value)}>{editing ? "Đóng sửa" : "Sửa"}</Button>}
    </section>
    {scope === "sessions" && <>
      {sections.loading && <Loading label="Đang tải danh sách phiên…" />}
      {sections.error && <Failure error={sections.error} retry={sections.reload} />}
      {sections.data && <SessionSelection sections={sections.data} selected={selectedIds} disabled={generating} change={setSelection} />}
      {missingSelection && <div className="form-error">Một phiên đã chọn không còn tồn tại. Chọn lại các phiên trước khi tạo tóm tắt.</div>}
    </>}
    {editable && !hasTranscript && <div className="notice">Cần có transcript trước khi tạo tóm tắt.</div>}
    {notice && <div className="notice">{notice}</div>}
    {scope === "sessions" && <p className="notice">AI chỉ đọc nội dung các phiên được chọn, tóm tắt riêng từng phiên. Phiên chưa có phát biểu sẽ được ghi rõ là chưa có nội dung. Kết quả bên dưới là lần tạo gần nhất, không tự đổi khi bạn chọn lại phiên hoặc sửa phân chia.</p>}
    {summary?.transcript_version_id && summary.transcript_version_id !== transcript.data?.version_id && <p className="notice">Transcript đã thay đổi sau lần tóm tắt này. Bấm Tạo lại để lấy nội dung mới nhất.</p>}
    {error && <div className="form-error">{error}</div>}
    {jobs.job && <div className={`job-state ${jobs.job.status}`}>
      Tóm tắt AI: {statusLabel(jobs.job.status)}
      {jobs.job.progress !== undefined ? ` · ${jobs.job.progress}%` : ""}
      {jobs.job.error ? ` · ${jobs.job.error.message}` : ""}
    </div>}
    {summaries.loading && <Loading />}
    {summaries.error && <Failure error={summaries.error} retry={summaries.reload} />}
    {summary ? <div className="summary-layout">
      <section className="summary-document">
        {scope === "sessions" && <h2>Kết quả tóm tắt đã tạo</h2>}
        <div className="summary-document-meta">
          <Status>{summary.mode === "custom" ? "Prompt tùy chỉnh" : templateLabels[summary.template ?? "general"]}</Status>
          <span>{languageLabels[summary.output_language]} · v{summary.current_version.version_no} · {new Date(summary.current_version.created_at).toLocaleString("vi-VN")}</span>
        </div>
        {summary.mode === "custom" && <div className="summary-prompt-used">
          <strong>Yêu cầu đã dùng</strong>
          <p>{summary.current_version.prompt}</p>
        </div>}
        {scope === "sessions" && Array.isArray(summary.current_version.content.sessions)
          ? (summary.current_version.content.sessions as SessionSummary[]).map((session, index, all) => <article className="session-summary" key={session.id ?? session.sequence}>
            <div className="session-summary-heading"><div><h2>{session.title}</h2><small>Phiên {session.sequence} · {formatTimestampInput(session.start_ms)}{session.end_ms !== null ? ` – ${formatTimestampInput(session.end_ms)}` : " · Đang mở tại thời điểm tạo"}</small></div>
              {editable && session.content && <Button onClick={() => setEditingSection(editingSection === index ? undefined : index)}>{editingSection === index ? "Đóng sửa" : "Sửa phiên này"}</Button>}
            </div>
            {session.content ? editingSection === index
              ? <SummaryEditor key={`${summary.id}-${summary.current_version.version_no}-${index}`} summary={{ ...summary, current_version: { ...summary.current_version, content: session.content } }} cancel={() => setEditingSection(undefined)} save={(content) => saveEdit({ sessions: all.map((part, partIndex) => partIndex === index ? { ...part, content } : part) })} />
              : <SummaryContent content={session.content} />
              : <p>Phiên này chưa có nội dung phát biểu tại thời điểm tạo tóm tắt.</p>}
          </article>)
          : editing
          ? <SummaryEditor key={`${summary.id}-${summary.current_version.version_no}`} summary={summary} save={saveEdit} cancel={() => setEditing(false)} />
          : <SummaryContent content={summary.current_version.content} />}
      </section>
    </div> : !summaries.loading && <Empty
      title="Chưa có tóm tắt"
      detail={mode === "custom" ? "Nhập mô tả mẫu bạn muốn và bấm Tạo tóm tắt." : "Chọn mẫu có sẵn và bấm Tạo tóm tắt."}
    />}
  </>;
}

export function SessionSelection({ sections, selected, disabled, change }: { sections: MeetingSection[]; selected: string[]; disabled: boolean; change: (ids: string[]) => void }) {
  if (!sections.length) return <p className="notice">Cuộc họp chưa chia phiên, sẽ tóm tắt như một phiên duy nhất. Mở Phiên họp để thêm mốc phân chia.</p>;
  return <fieldset className="summary-session-selection" disabled={disabled}>
    <legend>Chọn phiên cần tóm tắt ({selected.filter((id) => sections.some((section) => section.id === id)).length}/{sections.length})</legend>
    <div className="summary-selection-actions"><Button onClick={() => change(sections.map((section) => section.id))}>Chọn tất cả</Button><Button onClick={() => change([])}>Bỏ chọn tất cả</Button></div>
    {sections.map((section) => <label className="summary-session-option" key={section.id}>
      <input type="checkbox" checked={selected.includes(section.id)} onChange={(event) => change(event.target.checked ? [...selected, section.id] : selected.filter((id) => id !== section.id))} />
      <span><strong>Phiên {section.sequence} · {section.title}</strong><small>{formatTimestampInput(section.start_ms)}{section.end_ms !== null ? ` – ${formatTimestampInput(section.end_ms)}` : " · Đang mở"}</small></span>
    </label>)}
    {selected.length === 0 && <p role="status">Chọn ít nhất một phiên để tạo tóm tắt.</p>}
  </fieldset>;
}

function SummaryContent({ content }: { content: Record<string, unknown> }) {
  const custom = readCustomContent(content);
  if (custom) return <div className="custom-summary-content">
    <h1>{custom.title}</h1>
    {custom.sections.map((section, index) => <article className="summary-section" key={`${section.heading}-${index}`}>
      <span>{String(index + 1).padStart(2, "0")}</span>
      <div><h2>{section.heading}</h2><p>{section.content}</p></div>
    </article>)}
  </div>;
  if (typeof content.content === "string" && Object.keys(content).length === 1) {
    return <div className="freeform-summary-content">{content.content}</div>;
  }
  return <>{Object.entries(content).map(([key, value], index) => <article className="summary-section" key={key}>
    <span>{String(index + 1).padStart(2, "0")}</span>
    <div><h2>{humanize(key)}</h2><SummaryValue value={value} /></div>
  </article>)}</>;
}

function SummaryEditor({ summary, save, cancel }: { summary: Summary; save: (content: Record<string, unknown>) => Promise<void>; cancel: () => void }) {
  const custom = readCustomContent(summary.current_version.content);
  const [title, setTitle] = useState(custom?.title ?? "");
  const [sections, setSections] = useState<CustomSection[]>(custom?.sections ?? []);
  const [fields, setFields] = useState<Record<string, string>>(() => Object.fromEntries(
    Object.entries(summary.current_version.content).map(([key, value]) => [key, editableValue(value)]),
  ));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    try {
      setSaving(true);
      setError("");
      if (summary.mode === "custom" && custom) {
        const normalized = sections
          .map((section) => ({ heading: section.heading.trim(), content: section.content.trim() }))
          .filter((section) => section.heading && section.content);
        if (!title.trim() || !normalized.length) throw new Error("Cần có tiêu đề và ít nhất một mục nội dung.");
        await save({ title: title.trim(), sections: normalized });
      } else {
        const content = Object.fromEntries(Object.entries(fields).map(([key, value]) => {
          const original = summary.current_version.content[key];
          if (Array.isArray(original)) return [key, value.split("\n").map((item) => item.trim()).filter(Boolean)];
          if (original && typeof original === "object") {
            try { return [key, JSON.parse(value)]; } catch { throw new Error(`Mục “${humanize(key)}” không phải JSON hợp lệ.`); }
          }
          return [key, value.trim()];
        }));
        await save(content);
      }
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return <div className="summary-editor">
    <h2>Chỉnh sửa tóm tắt</h2>
    {summary.mode === "custom" && custom ? <>
      <label className="field">Tiêu đề
        <input value={title} onChange={(event) => setTitle(event.target.value)} />
      </label>
      {sections.map((section, index) => <div className="summary-editor-section" key={index}>
        <label className="field">Tên mục {index + 1}
          <input value={section.heading} onChange={(event) => setSections((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, heading: event.target.value } : item))} />
        </label>
        <label className="field">Nội dung
          <textarea rows={5} value={section.content} onChange={(event) => setSections((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, content: event.target.value } : item))} />
        </label>
        <Button tone="danger" onClick={() => setSections((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Xóa mục</Button>
      </div>)}
      <Button onClick={() => setSections((current) => [...current, { heading: "Mục mới", content: "" }])}>Thêm mục</Button>
    </> : Object.entries(fields).map(([key, value]) => <label className="field" key={key}>{humanize(key)}
      <textarea rows={Array.isArray(summary.current_version.content[key]) ? 5 : 7} value={value} onChange={(event) => setFields((current) => ({ ...current, [key]: event.target.value }))} />
      {Array.isArray(summary.current_version.content[key]) && <span>Mỗi dòng là một ý.</span>}
    </label>)}
    {error && <div className="form-error">{error}</div>}
    <div className="summary-editor-actions">
      <Button onClick={cancel}>Hủy</Button>
      <Button tone="dark" disabled={saving} onClick={() => void submit()}>{saving ? "Đang lưu..." : "Lưu phiên bản mới"}</Button>
    </div>
  </div>;
}

function readCustomContent(content: Record<string, unknown>): { title: string; sections: CustomSection[] } | undefined {
  if (typeof content.title !== "string" || !Array.isArray(content.sections)) return undefined;
  const sections = content.sections.filter((item): item is CustomSection => Boolean(
    item && typeof item === "object" && typeof (item as CustomSection).heading === "string" && typeof (item as CustomSection).content === "string",
  ));
  return sections.length ? { title: content.title, sections } : undefined;
}

function SummaryValue({ value }: { value: unknown }) {
  if (Array.isArray(value)) return <ul>{value.map((item, index) => <li key={index}>{typeof item === "string" ? item : JSON.stringify(item)}</li>)}</ul>;
  if (value && typeof value === "object") return <pre>{JSON.stringify(value, null, 2)}</pre>;
  return <p>{String(value ?? "")}</p>;
}

const sectionLabels: Record<string, string> = {
  overview: "Tổng quan",
  summary: "Tóm tắt",
  content: "Nội dung",
  key_points: "Ý chính",
  decisions: "Quyết định",
  action_items: "Công việc cần làm",
  risks: "Rủi ro & lưu ý",
  risks_notes: "Rủi ro & lưu ý",
  attendees: "Thành phần tham dự",
  participants: "Thành phần tham dự",
  next_steps: "Bước tiếp theo",
  voting_results: "Kết quả biểu quyết",
  notes: "Ghi chú bổ sung",
  discussion: "Nội dung thảo luận",
};
function humanize(key: string) { return sectionLabels[key] ?? key.replace(/[_-]+/g, " ").replace(/\b\w/g, (character) => character.toUpperCase()); }
function editableValue(value: unknown) { return Array.isArray(value) ? value.map(String).join("\n") : value && typeof value === "object" ? JSON.stringify(value, null, 2) : String(value ?? ""); }
function toText(content: Record<string, unknown>) {
  const custom = readCustomContent(content);
  if (custom) return `${custom.title}\n\n${custom.sections.map((section) => `${section.heading}\n${section.content}`).join("\n\n")}`;
  return Object.entries(content).map(([key, value]) => `${humanize(key)}\n${Array.isArray(value) ? value.map(String).join("\n") : typeof value === "object" ? JSON.stringify(value, null, 2) : String(value)}`).join("\n\n");
}
