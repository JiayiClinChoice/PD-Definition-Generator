import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { api, ApiError } from './api/client';
import AppBoard from './AppBoard';
import { Icon } from './ui';
import type { User } from './types';

export default function AuthApp() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expired, setExpired] = useState(false);
  const controller = useRef<AbortController>();
  const channel = useRef<BroadcastChannel>();
  const checkSession = useCallback(() => {
    controller.current?.abort();
    const next = new AbortController();
    controller.current = next;
    setUser(null); setLoading(true); setError('');
    void api.me(next.signal).then((value) => {
      if (!next.signal.aborted) setUser(value);
    }).catch((failure: unknown) => {
      if (!next.signal.aborted && !(failure instanceof ApiError && failure.status === 401)) {
        setError(failure instanceof Error ? failure.message : '无法确认登录状态。');
      }
    }).finally(() => { if (!next.signal.aborted) setLoading(false); });
  }, []);

  useEffect(() => {
    checkSession();
    const expire = () => {
      controller.current?.abort();
      setUser(null); setLoading(false); setError(''); setExpired(true);
      channel.current?.postMessage('changed');
    };
    window.addEventListener('session-expired', expire);
    channel.current = new BroadcastChannel('pd-account');
    channel.current.onmessage = checkSession;
    return () => {
      controller.current?.abort();
      channel.current?.close();
      window.removeEventListener('session-expired', expire);
    };
  }, [checkSession]);

  async function logout() {
    await api.logout();
    setUser(null); setExpired(false);
    channel.current?.postMessage('changed');
  }

  if (user && !loading) return <AppBoard key={user.id} user={user} onLogout={logout} />;
  return <div className="app-shell">
    <header className="topbar"><div className="brand"><Icon name="flask" size={23} /><span>Protocol Deviation Generator</span></div></header>
    <main className="auth-main">
      {loading ? <section className="panel content" role="status">正在确认登录状态…</section>
        : error ? <section className="panel content"><h1>暂时无法连接</h1><p role="alert">{error}</p><button className="button primary" onClick={checkSession}>重新连接</button></section>
          : <AuthForm expired={expired} onSuccess={(value) => {
            setUser(value); setExpired(false); channel.current?.postMessage('changed');
          }} />}
    </main>
  </div>;
}

function AuthForm({ onSuccess, expired }: { onSuccess: (user: User) => void; expired: boolean }) {
  const [registering, setRegistering] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError('');
    if (registering && password !== confirmation) {
      setError('两次输入的密码不一致。'); return;
    }
    setBusy(true);
    try {
      const value = await api[registering ? 'register' : 'login'](username.trim(), password);
      setPassword(''); setConfirmation('');
      onSuccess(value);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '登录失败，请重试。');
    } finally { setBusy(false); }
  }

  return <section className="panel content auth-card">
    <h1>{registering ? '创建账号' : '欢迎回来'}</h1>
    <p className="muted auth-description">从研究方案到清晰、可核查的 PD 定义。</p>
    {expired && <p role="status" className="notice">登录已过期，请重新登录。</p>}
    <form onSubmit={submit} className="editor-form">
      {error && <p ref={errorRef} tabIndex={-1} role="alert" className="notice error">{error}</p>}
      <label>用户名<input required minLength={3} maxLength={32} pattern="[A-Za-z0-9._@\-]{3,32}" title="3–32 位字母、数字或 . _ @ -" autoComplete="username" autoCapitalize="none" spellCheck={false} value={username} disabled={busy} onChange={(event) => setUsername(event.target.value)} /></label>
      <label>密码<input required type={visible ? 'text' : 'password'} minLength={3} maxLength={128} placeholder={registering ? '至少 3 位' : undefined} autoComplete={registering ? 'new-password' : 'current-password'} value={password} disabled={busy} onChange={(event) => setPassword(event.target.value)} /></label>
      <label className="checkbox-label"><input type="checkbox" checked={visible} onChange={(event) => setVisible(event.target.checked)} />显示密码</label>
      {registering && <label>确认密码<input required type={visible ? 'text' : 'password'} minLength={3} maxLength={128} autoComplete="new-password" value={confirmation} disabled={busy} onChange={(event) => setConfirmation(event.target.value)} /></label>}
      <button className="button primary" disabled={busy}>{busy ? '请稍候…' : registering ? '注册并登录' : '登录'}</button>
    </form>
    <button className="button ghost" disabled={busy} onClick={() => {
      setRegistering(!registering); setError(''); setPassword(''); setConfirmation(''); setVisible(false);
    }}>{registering ? '前往登录' : '创建账号'}</button>
  </section>;
}
