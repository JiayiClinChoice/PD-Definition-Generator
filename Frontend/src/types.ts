export interface ProjectInfo {
  id: number;
  name: string;
  file_name: string | null;
  file_valid: number;
  title: string | null;
  protocol_no: string | null;
  version: string | null;
  version_date: string | null;
  sponsor: string | null;
}

export interface ProjectInitialOut {
  id: number;
  name: string;
  file_valid: number;
}

export interface ProtocolMetadata {
  title: string;
  protocol_no: string;
  version: string;
  version_date: string;
  sponsor: string;
}

export interface PDCategoryUpdate {
  ord: number;
  name: string;
  description: string;
  method: string;
}

export interface PDCategoryUpdateList {
  categories: PDCategoryUpdate[];
}

export interface FactOut {
  position: number;
  pd_category_ord: number;
  pd_category_name: string;
  content: string;
  source: string | null;
  checked: 0 | 1;
}

export interface FactOutList {
  facts: FactOut[];
}

export interface FieldUpdate {
  ord: number;
  name: string;
  label: string;
  meaning: string;
  required: boolean;
  allowed_values: string[];
  requirements?: string | null;
  example: string[];
}

export interface FieldUpdateList {
  fields: FieldUpdate[];
}

export interface DefinitionOut {
  checked: 0 | 1;
  position: number;
  pd_category_name: string;
  pd_ord: string;
  requirements: string;
  description: string;
  review_method: string | null;
  severity: string | null;
  note: string | null;
}

export interface DefinitionOutList {
  definitions: DefinitionOut[];
}

export interface WorkspaceData {
  project: ProjectInfo;
  categories: PDCategoryUpdate[];
  fields: FieldUpdate[];
  facts: FactOut[];
  definitions: DefinitionOut[];
}
export interface User {
  id: number;
  username: string;
}
