import { useCallback, useRef, useState } from 'react';
import { api } from './api/client';
import type { RunAction } from './AppBoard';
import WorkspaceEditor from './WorkspaceEditor';
import { useAppDialog } from './AppDialogs';
import type { ProjectInfo, WorkspaceData } from './types';

export default function ProjectSession({ initial, onBack, onProjectChange, onDelete, onActivityChange, onDirtyChange }: {
  initial: WorkspaceData;
  onBack: () => void;
  onProjectChange: (project: ProjectInfo) => void;
  onDelete: () => Promise<void>;
  onActivityChange: (id: number, busy: boolean) => void;
  onDirtyChange: (id: number, dirty: boolean) => void;
}) {
  const { confirm } = useAppDialog();
  const [data, setData] = useState(initial);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState({ text: '', error: false });
  const running = useRef(false);
  const id = initial.project.id;
  const reportDirty = useCallback((dirty: boolean) => onDirtyChange(id, dirty), [id, onDirtyChange]);
  const run = useCallback<RunAction>(async (label, action, success) => {
    if (running.current) return;
    running.current = true;
    setBusy(true); onActivityChange(id, true);
    setStatus({ text: label, error: false });
    try {
      await action();
      setStatus({ text: success, error: false });
    } catch (failure) {
      setStatus({ text: failure instanceof Error ? failure.message : '操作未完成，请重试。', error: true });
    } finally {
      running.current = false; setBusy(false); onActivityChange(id, false);
    }
  }, [id, onActivityChange]);

  return <WorkspaceEditor key={revision} data={data} busy={busy} status={status} run={run}
    onBack={onBack} onProjectChange={onProjectChange} onDirtyChange={reportDirty} onDelete={onDelete}
    onRefresh={async () => {
      if (!await confirm('重新加载工作区？未保存的修改将丢失。', { title: '刷新工作区', confirmLabel: '重新加载' })) return;
      void run('正在刷新…', async () => {
        const fresh = await api.getWorkspace(id);
        setData(fresh); onProjectChange(fresh.project); setRevision((value) => value + 1);
      }, '数据已刷新');
    }} />;
}
