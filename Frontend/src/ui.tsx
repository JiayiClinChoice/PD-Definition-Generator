import { useEffect, useId, useRef, type ReactNode } from 'react';

export type IconName = 'flask' | 'file' | 'settings' | 'list' | 'search' | 'plus' | 'arrow' | 'back' | 'refresh' | 'edit' | 'trash' | 'info' | 'close' | 'upload' | 'sparkles' | 'download' | 'check' | 'top' | 'bottom' | 'chevron' | 'send' | 'prompt' | 'eye';

const paths: Record<IconName, ReactNode> = {
  prompt: <><path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2zM7 8h10M7 12h6" /></>,
  eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
  chevron: <path d="m6 9 6 6 6-6" />,
  send: <path d="M12 20V4m-6 6 6-6 6 6" />,
  top: <path d="M5 4h14M12 20V8m-5 5 5-5 5 5" />,
  bottom: <path d="M5 20h14M12 4v12m-5-5 5 5 5-5" />,
  flask: <><path d="M9 3h6M10 3v6L4.5 19a1.3 1.3 0 0 0 1.2 2h12.6a1.3 1.3 0 0 0 1.2-2L14 9V3" /><path d="M8 14h8m-7 3h3" /></>,
  file: <><path d="M14 3H6v18h12V7z" /><path d="M14 3v5h4M9 12h6m-6 4h6" /></>,
  settings: <><path d="m9 3-1 3-3 1-2 4 2 2v3l3 2 1 3h6l1-3 3-2v-3l2-2-2-4-3-1-1-3z" /><circle cx="12" cy="12" r="3" /></>,
  list: <><path d="m3 6 1 1 2-2m3 1h12M3 12l1 1 2-2m3 1h12M3 18l1 1 2-2m3 1h12" /></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
  back: <path d="M20 12H4m6-6-6 6 6 6" />,
  refresh: <><path d="M20 8a8 8 0 0 0-14-2L3 9m0-5v5h5m-4 7a8 8 0 0 0 14 2l3-3m0 5v-5h-5" /></>,
  edit: <><path d="m4 16 12-12 4 4L8 20H4zM14 6l4 4" /></>,
  trash: <><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6m0-10v1" /></>,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  upload: <><path d="M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5" /></>,
  sparkles: <><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5zM20 2v4m-2-2h4" /></>,
  download: <><path d="M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4" /></>,
  check: <><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" /></>,
};

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

export function Modal({ title, children, onClose, busy = false, descriptionId }: { title: string; children: ReactNode; onClose: () => void; busy?: boolean; descriptionId?: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = dialogRef.current!;
    const previous = document.activeElement;
    dialog.showModal();
    const focusTarget = dialog.querySelector<HTMLElement>('[data-dialog-autofocus]') ?? dialog.querySelector<HTMLElement>('input:not(:disabled), textarea:not(:disabled)');
    focusTarget?.focus();
    return () => { dialog.close(); if (previous instanceof HTMLElement) previous.focus(); };
  }, []);
  return <dialog ref={dialogRef} className="modal" aria-labelledby={titleId} aria-describedby={descriptionId} onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className="section-heading"><h2 id={titleId}>{title}</h2><button className="icon-button" aria-label="关闭" disabled={busy} onClick={onClose}><Icon name="close" /></button></div>
    {children}
  </dialog>;
}
