import { useEffect, useId, useLayoutEffect, useRef, useState, type TextareaHTMLAttributes } from 'react';
import { Icon } from './ui';

export function AutoTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const textarea = ref.current!;
    function resize() {
      if (!textarea.clientWidth) return;
      textarea.style.height = 'auto';
      const style = getComputedStyle(textarea);
      textarea.style.height = `${textarea.scrollHeight + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth)}px`;
    }
    resize();
    let width = textarea.clientWidth;
    const observer = new ResizeObserver(() => {
      if (width !== textarea.clientWidth) { width = textarea.clientWidth; resize(); }
    });
    observer.observe(textarea);
    return () => observer.disconnect();
  }, [props.value]);
  return <textarea {...props} ref={ref} className={`auto-textarea ${props.className ?? ''}`} />;
}

export function ScrollNavigation() {
  function scroll(bottom: boolean) {
    window.scrollTo({ top: bottom ? document.documentElement.scrollHeight : 0,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  }
  return <nav className="scroll-navigation" aria-label="页面滚动">
    <button type="button" aria-label="回到顶部" title="回到顶部" onClick={() => scroll(false)}><Icon name="top" /></button>
    <button type="button" aria-label="到底部" title="到底部" onClick={() => scroll(true)}><Icon name="bottom" /></button>
  </nav>;
}

export function PreviewSplitButton({ label, actionLabel, disabled, onRun, onPreview }: {
  label: string; actionLabel: string; disabled: boolean; onRun: () => void; onPreview: () => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const option = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  useEffect(() => {
    if (!open) return;
    option.current?.focus();
    function dismiss(event: PointerEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);
  return <div ref={root} className="split-button" onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }} onKeyDown={(event) => {
    if (event.key === 'Escape' && open) {
      event.preventDefault(); setOpen(false); toggle.current?.focus();
    }
    if (open && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); option.current?.focus();
    }
  }}>
    <button type="button" className="button secondary" aria-label={actionLabel} disabled={disabled}
      onClick={() => { setOpen(false); onRun(); }}><Icon name="sparkles" size={16} />{label}</button>
    <button ref={toggle} type="button" className="button secondary split-toggle" aria-label={`${actionLabel}更多选项`}
      title="更多选项" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
      disabled={disabled} onClick={() => setOpen(!open)} onKeyDown={(event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); }
      }}><Icon name="chevron" size={16} /></button>
    {open && <div id={menuId} className="split-dropdown" role="menu" aria-label={`${actionLabel}选项`}>
      <button ref={option} type="button" role="menuitem" onClick={() => {
        setOpen(false); toggle.current?.focus(); onPreview();
      }}><Icon name="eye" size={16} />预览即将提交的提示词</button>
    </div>}
  </div>;
}
