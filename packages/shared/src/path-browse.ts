export type PathBrowseEntryKind = 'drive' | 'directory' | 'file';

export interface PathBrowseEntry {
  name: string;
  path: string;
  kind: PathBrowseEntryKind;
  /** Czy można wybrać ten wpis jako plik importu (.zip). */
  selectable: boolean;
}

export interface PathBrowseResponse {
  currentPath: string | null;
  parentPath: string | null;
  entries: PathBrowseEntry[];
}
