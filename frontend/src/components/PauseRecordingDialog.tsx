import { useEffect, useId, useRef } from "react";
import { Button, Icon } from "./ui";

export function PauseRecordingDialog({ choose }: { choose: (newSection: boolean) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const settled = useRef(false);
  const titleId = useId();
  const detailId = useId();
  useEffect(() => {
    const element = dialog.current;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    element?.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      element?.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  function select(newSection: boolean) {
    if (settled.current) return;
    settled.current = true;
    choose(newSection);
  }

  return <dialog ref={dialog} className="dialog pause-recording-dialog" aria-labelledby={titleId} aria-describedby={detailId}
    onCancel={(event) => { event.preventDefault(); select(false); }}>
    <button className="close" type="button" aria-label="Đóng và chỉ tạm dừng" onClick={() => select(false)}><Icon name="close" /></button>
    <h2 id={titleId}>Tạo phiên mới khi tạm dừng?</h2>
    <div id={detailId}>
      <p>Chọn Tạo phiên mới để khép phiên hiện tại và chuẩn bị phiên kế tiếp, hoặc Chỉ tạm dừng để giữ nguyên phiên.</p>
      <p>Ghi âm vẫn tiếp tục trong khi chờ lựa chọn. Sau khi tạm dừng, chỉ bấm Tiếp tục mới thu lại. Đóng hộp hoặc nhấn Escape sẽ chỉ tạm dừng, không tạo phiên.</p>
    </div>
    <div className="dialog-actions">
      <Button autoFocus onClick={() => select(false)}>Chỉ tạm dừng</Button>
      <Button tone="dark" onClick={() => select(true)}>Tạo phiên mới</Button>
    </div>
  </dialog>;
}
