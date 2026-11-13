import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api/client';
import ProjectSession from './ProjectSession';
import { Icon, Modal } from './ui';
import { AppDialogProvider, useAppDialog } from './AppDialogs';
import type { ProjectInfo, User, WorkspaceData } from './types';

export type RunAction = (label: string, action: () => Promise<void>, success: string) => Promise<void>;

export default function AppBoard({ user, onLogout }: { user: User; onLogout: () => Promise<void> }) {
  return <AppDialogProvider><Board user={user} onLogout={onLogout} /></AppDialogProvider>;
}

function Board({ user, onLogout }: { user: User; onLogout: () => Promise<void> }) {
  const { confirm } = useAppDialog();
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [sessions, setSessions] = useState<Record<number, WorkspaceData>>({});
  const [activity, setActivity] = useState<Record<number, boolean>>({});
  const [drafts, setDrafts] = useState<Record<number, boolean>>({});
  const [name, setName] = useState('');
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [help, setHelp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingWorkspace, setLoadingWorkspace] = useState(false);
  const dirty = Object.values(drafts).some(Boolean);
  const backgroundBusy = Object.values(activity).some(Boolean);
  const reportActivity = useCallback((id: number, value: boolean) => setActivity((items) => ({ ...items, [id]: value })), []);
  const reportDirty = useCallback((id: number, value: boolean) => setDrafts((items) => ({ ...items, [id]: value })), []);
  const [status, setStatus] = useState({ text: '就绪', error: false });
  const running = useRef(false);
  const blocked = busy || loadingList || loadingWorkspace;

  const run = useCallback<RunAction>(async (label, action, success) => {
    if (running.current) return;
    running.current = true;
    setBusy(true); setStatus({ text: label, error: false });
    try {
      await action();
      setStatus({ text: success, error: false });
    } catch (failure) {
      setStatus({ text: failure instanceof Error ? failure.message : '操作未完成，请重试。', error: true });
    } finally { running.current = false; setBusy(false); }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void api.listProjects(controller.signal).then((list) => {
      if (!controller.signal.aborted) {
        setProjects(list);
      }
    }).catch((failure: unknown) => {
      if (!controller.signal.aborted) setStatus({ text: failure instanceof Error ? failure.message : '无法加载项目。', error: true });
    }).finally(() => { if (!controller.signal.aborted) setLoadingList(false); });
    return () => controller.abort();
  }, []);

  async function openProject(id: number) {
    setSelectedId(id);
    setStatus({ text: '就绪', error: false });
    if (sessions[id]) return;
    setLoadingWorkspace(true);
    try {
      const data = await api.getWorkspace(id);
      setSessions((items) => ({ ...items, [id]: data }));
    } catch (failure) {
      setStatus({ text: failure instanceof Error ? failure.message : '无法加载工作区。', error: true });
    } finally { setLoadingWorkspace(false); }
  }

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty || busy || backgroundBusy) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, busy, backgroundBusy]);

  async function backToProjects() {
    if (selectedId !== null && drafts[selectedId] && !activity[selectedId]) {
      if (!await confirm('有尚未保存的修改，确定放弃并继续？', { title: '放弃未保存的修改', confirmLabel: '放弃修改', danger: true })) return;
      const id = selectedId;
      setSessions((items) => { const next = { ...items }; delete next[id]; return next; });
      reportDirty(id, false);
    }
    setSelectedId(null);
    setStatus({ text: '就绪', error: false });
  }

  async function refresh() {
    setProjects(await api.listProjects());
  }

  const matchingProjects = projects.filter((project) => [project.name, project.protocol_no, project.sponsor].some((value) => value?.toLowerCase().includes(search.trim().toLowerCase())));
  const refreshButton = <button className="icon-button" aria-label="刷新" title="刷新" disabled={blocked} onClick={() => {
    void run('正在刷新…', refresh, '数据已刷新');
  }}><Icon name="refresh" /></button>;

  return <div className="app-shell">
    <header className="topbar">
      <button className="brand" onClick={backToProjects}><Icon name="flask" size={23} /><span>Protocol Deviation Generator</span></button>
      <div className="topbar-actions">
        <span className="account-name">{user.username}</span>
        <button className="icon-button" aria-label="使用说明" onClick={() => setHelp(true)}><Icon name="info" /></button>
        <button className="button text" disabled={blocked || backgroundBusy} onClick={async () => {
          if (!dirty || await confirm('有尚未保存的修改，确定退出？', { title: '退出登录', confirmLabel: '退出', danger: true })) void run('正在退出…', onLogout, '已退出');
        }}>退出</button>
      </div>
    </header>
    <main className={`main-shell ${selectedId === null ? 'projects-page' : 'workspace-page'}`}>
      {selectedId === null && <>
        <div className="page-heading"><div className="heading-with-count"><h1>项目</h1><span className="count">{projects.length}</span></div>
          <button className="button primary" disabled={blocked} onClick={() => { setName(''); setCreating(true); }}><Icon name="plus" />新建项目</button>
        </div>
        <div className="project-toolbar"><label className="search-field"><Icon name="search" /><input aria-label="搜索项目" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索项目、方案编号或申办方" /></label>{refreshButton}</div>
        <section className="panel project-table" aria-label="项目列表">
          <div className="project-columns project-table-heading"><span>项目</span><span>申办方</span><span>状态</span></div>
          {matchingProjects.map((project) => <button key={project.id} className="project-columns project-row" disabled={blocked} onClick={() => void openProject(project.id)}>
            <span className="project-identity"><span className="file-icon"><Icon name="file" size={24} /></span><span><strong>{project.name}</strong><small>{[project.protocol_no, project.version].filter(Boolean).join(' · ') || '尚未添加方案信息'}</small></span></span>
            <span className="project-sponsor">{project.sponsor || '—'}</span>
            <span className="project-status"><span className={`dot ${project.file_valid === 1 ? 'ok' : project.file_valid === -1 ? 'invalid' : 'pending'}`} />{activity[project.id] ? 'AI 处理中…' : project.file_valid === 1 ? '方案已校验' : project.file_valid === -1 ? '校验未通过' : '待上传方案'}</span>

          </button>)}
          {!matchingProjects.length && <div className="empty-state"><Icon name={search ? 'search' : 'file'} size={34} /><h2>{loadingList ? '正在加载项目…' : search ? '未找到匹配项目' : '开始一个研究项目'}</h2><p>{search ? '试试其他项目名称、方案编号或申办方。' : '新建项目，上传研究方案，逐步生成 PD 定义。'}</p></div>}
        </section>
      </>}
      <div hidden={!loadingList && !loadingWorkspace && (selectedId !== null && !!sessions[selectedId] || !status.error && ['就绪', '项目已加载'].includes(status.text))} className={`notice status-notice ${status.error ? 'error' : ''}`} role={status.error ? 'alert' : 'status'} aria-live="polite">
        {loadingList || loadingWorkspace ? '正在加载…' : status.text}
      </div>
      {Object.values(sessions).map((session) => <section className="workspace" key={session.project.id} hidden={selectedId !== session.project.id}>
        <ProjectSession initial={session} onBack={backToProjects} onActivityChange={reportActivity} onDirtyChange={reportDirty}
          onProjectChange={(project) => setProjects((list) => list.map((item) => item.id === project.id ? project : item))}
          onDelete={async () => {
            const id = session.project.id;
            await api.deleteProject(id);
            setProjects((items) => items.filter((item) => item.id !== id));
            setSessions((items) => { const next = { ...items }; delete next[id]; return next; });
            reportDirty(id, false); setSelectedId((current) => current === id ? null : current);
          }} />
      </section>)}
      {selectedId !== null && !sessions[selectedId] && <section className="panel content empty-state"><h1>{loadingWorkspace ? '正在打开工作空间' : '工作区暂不可用'}</h1><button className="button secondary" onClick={backToProjects}>返回项目列表</button>{!loadingWorkspace && <button className="button secondary" onClick={() => void openProject(selectedId)}>重试</button>}</section>}
    </main>
    {creating && <Modal title="新建研究项目" busy={busy} onClose={() => setCreating(false)}><p className="muted">为研究创建独立的方案与 PD 定义工作空间。</p><form className="editor-form" onSubmit={(event) => {
      event.preventDefault();
      void run('正在创建项目…', async () => {
        const result = await api.createProject(name.trim());
        setProjects(await api.listProjects()); setSearch(''); setCreating(false); await openProject(result.id);
      }, '项目已创建');
    }}><label>项目名称<input autoFocus required maxLength={200} value={name} onChange={(event) => setName(event.target.value)} placeholder="请输入项目名称" disabled={busy} /></label>
      <div className="form-footer"><button type="button" className="button secondary" disabled={busy} onClick={() => setCreating(false)}>取消</button><button className="button primary" disabled={busy || !name.trim()}>创建项目</button></div>
      {status.error && <p className="notice error" role="alert">{status.text}</p>}
    </form></Modal>}
    {help && <Modal title="使用说明" onClose={() => setHelp(false)}><div className="help-content"><p>上传并校验方案 → 配置 PD 分类 → 提取方案事实 → 编辑字段协议 → 生成 PD 定义。</p><p>AI 结果需要人工复核。编辑内容后请保存；重新提取或生成会替换当前列表。保存分类会清空已有事实。</p><p>每个项目支持一份方案文件；需要更换文件时，请新建项目。结果可导出为 Excel。AI 任务按项目独立运行，可返回列表继续处理其他项目。</p></div></Modal>}
  </div>;
}
