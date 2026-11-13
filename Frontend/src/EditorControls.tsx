import { useLayoutEffect, useRef, type TextareaHTMLAttributes } from 'react';
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
