import { useRef, useState } from 'react';
import type { GlobalRagImportResult } from '@teta/shared';
import { getAccessToken } from '../../lib/auth-storage';

type GlobalRagImportButtonProps = {
  disabled?: boolean;
  secondary?: boolean;
  onSuccess: (result: GlobalRagImportResult) => void;
  onError: (message: string) => void;
  onStarted?: () => void;
};

export function GlobalRagImportButton({
  disabled = false,
  secondary = true,
  onSuccess,
  onError,
  onStarted,
}: GlobalRagImportButtonProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  const handleFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.zip')) {
      onError('Wybierz plik ZIP.');
      return;
    }

    onStarted?.();
    setImporting(true);

    try {
      const form = new FormData();
      form.append('file', file);
      const headers = new Headers();
      const token = getAccessToken();
      if (token) headers.set('Authorization', `Bearer ${token}`);

      const res = await fetch('/api/admin/updates/global-rag/import', {
        method: 'POST',
        body: form,
        headers,
      });

      const result = (await res.json()) as GlobalRagImportResult | { message?: string | string[] };
      if (!res.ok) {
        const msg = Array.isArray((result as { message?: string[] }).message)
          ? (result as { message: string[] }).message.join(', ')
          : (result as { message?: string }).message;
        throw new Error(msg ?? `HTTP ${res.status}`);
      }

      onSuccess(result as GlobalRagImportResult);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Import RAG nie powiódł się.');
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept=".zip,application/zip"
        className="settings__updates-file"
        disabled={importing || disabled}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />
      <button
        type="button"
        className={secondary ? 'settings__btn settings__btn--secondary' : 'settings__btn'}
        disabled={importing || disabled}
        onClick={() => fileInputRef.current?.click()}
      >
        {importing ? 'Importowanie…' : 'Importuj paczkę RAG (ZIP)'}
      </button>
    </>
  );
}
