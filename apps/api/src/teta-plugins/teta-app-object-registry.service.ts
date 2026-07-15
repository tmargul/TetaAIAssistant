import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import type { TetaApplicationObject } from './teta-application-object.types';

export type TetaAppObjectRow = {
  object_id: string;
  dll_path: string;
  dll_name: string;
  form_guid: string | null;
  form_name: string;
  field_label: string | null;
  help_title: string | null;
  help_summary: string | null;
  help_field_text: string | null;
  help_section: string | null;
  binding_json: string | null;
  keywords_json: string;
  confidence: string;
  updated_at: string;
};

@Injectable()
export class TetaAppObjectRegistryService {
  constructor(private readonly db: DatabaseService) {}

  replaceForDll(dllPath: string, objects: TetaApplicationObject[]): void {
    const conn = this.db.connection;
    const now = new Date().toISOString();
    const deleteStmt = conn.prepare('DELETE FROM teta_app_objects WHERE lower(dll_path) = lower(?)');
    const insertStmt = conn.prepare(
      `INSERT INTO teta_app_objects (
        object_id, dll_path, dll_name, form_guid, form_name, field_label,
        help_title, help_summary, help_field_text, help_section,
        binding_json, keywords_json, confidence, updated_at
      ) VALUES (
        @object_id, @dll_path, @dll_name, @form_guid, @form_name, @field_label,
        @help_title, @help_summary, @help_field_text, @help_section,
        @binding_json, @keywords_json, @confidence, @updated_at
      )`,
    );

    const tx = conn.transaction(() => {
      deleteStmt.run(dllPath);
      for (const object of objects) {
        insertStmt.run({
          object_id: object.objectId,
          dll_path: dllPath,
          dll_name: object.dllName,
          form_guid: object.formGuid,
          form_name: object.formName,
          field_label: object.fieldLabel,
          help_title: object.helpTitle,
          help_summary: object.helpSummary,
          help_field_text: object.helpFieldText,
          help_section: object.helpSection,
          binding_json: object.binding ? JSON.stringify(object.binding) : null,
          keywords_json: JSON.stringify(object.keywords),
          confidence: object.confidence,
          updated_at: now,
        });
      }
    });
    tx();
  }

  deleteForDll(dllPath: string): number {
    const result = this.db.connection
      .prepare('DELETE FROM teta_app_objects WHERE lower(dll_path) = lower(?)')
      .run(dllPath);
    return result.changes;
  }

  deleteAll(): number {
    const result = this.db.connection.prepare('DELETE FROM teta_app_objects').run();
    return result.changes;
  }

  listForDll(dllPath: string): TetaApplicationObject[] {
    const rows = this.db.connection
      .prepare('SELECT * FROM teta_app_objects WHERE lower(dll_path) = lower(?)')
      .all(dllPath) as TetaAppObjectRow[];
    return rows.map((row) => this.rowToObject(row));
  }

  listAll(): TetaApplicationObject[] {
    const rows = this.db.connection
      .prepare('SELECT * FROM teta_app_objects ORDER BY dll_name, form_name, field_label')
      .all() as TetaAppObjectRow[];
    return rows.map((row) => this.rowToObject(row));
  }

  private rowToObject(row: TetaAppObjectRow): TetaApplicationObject {
    return {
      objectId: row.object_id,
      dllName: row.dll_name,
      formGuid: row.form_guid,
      formName: row.form_name,
      fieldLabel: row.field_label,
      helpTitle: row.help_title,
      helpSummary: row.help_summary,
      helpFieldText: row.help_field_text,
      helpSection: row.help_section,
      binding: row.binding_json ? JSON.parse(row.binding_json) : null,
      keywords: JSON.parse(row.keywords_json) as string[],
      confidence: row.confidence === 'confirmed' ? 'confirmed' : 'inferred',
    };
  }
}
