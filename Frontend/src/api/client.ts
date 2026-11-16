import type {
  DefinitionOutList,
  FactOutList,
  FieldUpdateList,
  PDCategoryUpdateList,
  ProjectInfo,
  ProjectInitialOut,
  ProtocolMetadata,
  User,
  WorkspaceData,
  ProjectPrompts,
  AIOperation,
  PromptPreview,
} from '../types';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers ?? {});
  headers.set('X-Requested-With', 'ProtocolDeviationGenerator');

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
    credentials: 'include',
    cache: 'no-store',
  });

  if (!response.ok) {
    const text = await response.text();
    let message = `请求失败（${response.status}），请稍后重试。`;
    if (response.headers.get('Content-Type')?.includes('application/json')) {
      const body: { detail?: string | Array<{ loc: Array<string | number>; msg: string }> } = JSON.parse(text);
      if (typeof body.detail === 'string') message = body.detail;
      else if (Array.isArray(body.detail)) message = body.detail.map((item) => `${item.loc.slice(1).join('.')}: ${item.msg}`).join('；');
    }
    if (response.status === 401 && !path.startsWith('/auth/')) {
      window.dispatchEvent(new Event('session-expired'));
    }
    throw new ApiError(response.status, message);
  }

  const contentType = response.headers.get('Content-Type') ?? '';
  if (contentType.includes('application/json')) {
    return (await response.json()) as T;
  }
  return undefined as T;
}

export const api = {
  getPrompts(projectId: number) {
    return request<ProjectPrompts>(`/project/${projectId}/prompts`);
  },

  savePrompts(projectId: number, prompts: ProjectPrompts) {
    return request<ProjectPrompts>(`/project/${projectId}/prompts`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(prompts),
    });
  },

  previewPrompts(projectId: number, operation: AIOperation, prompts: ProjectPrompts, requirements: string) {
    return request<PromptPreview>(`/project/${projectId}/prompt_preview`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operation, prompts, requirements }),
    });
  },

  me(signal?: AbortSignal) {
    return request<User>('/auth/me', { signal });
  },

  login(username: string, password: string) {
    return request<User>('/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
  },

  register(username: string, password: string) {
    return request<User>('/auth/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
  },

  logout() {
    return request<{ status: string }>('/auth/logout', { method: 'POST' });
  },

  listProjects(signal?: AbortSignal) {
    return request<ProjectInfo[]>('/projects', { signal });
  },

  getWorkspace(projectId: number, signal?: AbortSignal) {
    return request<WorkspaceData>(`/project/${projectId}/workspace`, { signal });
  },

  saveFacts(projectId: number, facts: FactOutList) {
    return request<FactOutList>(`/project/${projectId}/facts`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(facts),
    });
  },

  saveDefinitions(projectId: number, definitions: DefinitionOutList) {
    return request<DefinitionOutList>(`/project/${projectId}/definitions`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(definitions),
    });
  },

  getProject(projectId: number) {
    return request<ProjectInfo>(`/project/${projectId}`);
  },

  createProject(name: string) {
    const params = new URLSearchParams({ name });
    return request<ProjectInitialOut>(`/project/initial?${params.toString()}`, {
      method: 'POST',
    });
  },

  renameProject(projectId: number, newName: string) {
    const params = new URLSearchParams({ new_name: newName });
    return request<ProjectInfo>(`/project/${projectId}/rename?${params.toString()}`, {
      method: 'PUT',
    });
  },

  deleteProject(projectId: number) {
    return request<boolean>(`/project/${projectId}`, {
      method: 'DELETE',
    });
  },

  attachFile(projectId: number, file: File) {
    const formData = new FormData();
    formData.append('file', file);
    return request<ProjectInfo>(`/project/${projectId}/attach`, {
      method: 'POST',
      body: formData,
    });
  },

  updateMetadata(projectId: number, metadata: ProtocolMetadata) {
    return request<ProjectInfo>(`/project/${projectId}/metadata`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(metadata),
    });
  },

  updatePdCategories(projectId: number, categories: PDCategoryUpdateList) {
    return request<PDCategoryUpdateList>(`/project/${projectId}/pd_categories`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(categories),
    });
  },

  getFacts(projectId: number) {
    return request<FactOutList>(`/project/${projectId}/extract_facts`, { method: 'POST' });
  },

  reviseFacts(projectId: number, requirements: string) {
    return request<FactOutList>(`/project/${projectId}/revise_facts`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ requirements }),
    });
  },

  updateFields(projectId: number, fields: FieldUpdateList) {
    return request<FieldUpdateList>(`/project/${projectId}/update_fields`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(fields),
    });
  },

  getDefinitions(projectId: number) {
    return request<DefinitionOutList>(`/project/${projectId}/generate_definitions`, { method: 'POST' });
  },

  reviseDefinitions(projectId: number, requirements: string) {
    return request<DefinitionOutList>(`/project/${projectId}/revise_definitions`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ requirements }),
    });
  },
};
