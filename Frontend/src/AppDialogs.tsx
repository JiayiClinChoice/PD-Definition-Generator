import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Modal } from './ui';

interface ConfirmOptions {
  title?: string;
  confirmLabel?: string;
  danger?: boolean;
  requiredName?: string;
}

interface DialogRequest extends ConfirmOptions {
  id: string;
  message: string;
  notification?: boolean;
  resolve: (accepted: boolean) => void;
}

interface DialogService {
  confirm: (message: string, options?: ConfirmOptions) => Promise<boolean>;
  notify: (message: string) => Promise<boolean>;
}

const DialogContext = createContext<DialogService | null>(null);

export function AppDialogProvider({ children }: { children: ReactNode }) {
  const [requests, setRequests] = useState<DialogRequest[]>([]);
  const pending = useRef(new Set<DialogRequest>());
  const open = useCallback((message: string, options: ConfirmOptions = {}, notification = false) => new Promise<boolean>((resolve) => {
    const request = { ...options, id: crypto.randomUUID(), message, notification, resolve };
    pending.current.add(request);
    setRequests((current) => [...current, request]);
  }), []);
  const confirm = useCallback((message: string, options?: ConfirmOptions) => open(message, options), [open]);
  const notify = useCallback((message: string) => open(message, { title: '提示', confirmLabel: '知道了' }, true), [open]);
  useEffect(() => () => {
    pending.current.forEach((request) => request.resolve(false));
    pending.current.clear();
  }, []);
  const request = requests[0];
  function finish(accepted: boolean) {
    if (!pending.current.delete(request)) return;
    setRequests((current) => current.slice(1));
    request.resolve(accepted);
  }
  return <DialogContext.Provider value={{ confirm, notify }}>
    {children}
    {request && <DialogContent key={request.id} request={request} onFinish={finish} />}
  </DialogContext.Provider>;
}

function DialogContent({ request, onFinish }: { request: DialogRequest; onFinish: (accepted: boolean) => void }) {
  const [name, setName] = useState('');
  const descriptionId = useId();
  const matches = request.requiredName === undefined || name === request.requiredName;
  return <Modal title={request.title ?? '确认操作'} descriptionId={descriptionId} onClose={() => onFinish(false)}>
    <form className="editor-form" onSubmit={(event) => { event.preventDefault(); if (matches) onFinish(true); }}>
      <p id={descriptionId} className="dialog-message">{request.message}</p>
      {request.requiredName !== undefined && <>
        <p className="dialog-project-name">{request.requiredName}</p>
        <label>输入项目名称以确认<input autoFocus autoComplete="off" spellCheck={false} required value={name} onChange={(event) => setName(event.target.value)} placeholder="请输入完整项目名称" /></label>
        <p className="hint">名称须完全一致，包含空格与大小写。</p>
      </>}
      <div className="form-footer">
        {!request.notification && <button data-dialog-autofocus={request.requiredName === undefined ? '' : undefined} type="button" className="button secondary" onClick={() => onFinish(false)}>取消</button>}
        <button data-dialog-autofocus={request.notification ? '' : undefined} className={`button ${request.danger ? 'danger' : 'primary'}`} disabled={!matches}>{request.confirmLabel ?? '确认'}</button>
      </div>
    </form>
  </Modal>;
}

export function useAppDialog() {
  const service = useContext(DialogContext);
  if (!service) throw new Error('AppDialogProvider is required');
  return service;
}
