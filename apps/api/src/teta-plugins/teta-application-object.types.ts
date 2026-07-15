export type TetaHelpFieldEntry = {
  label: string;
  description: string;
  section?: string | null;
};

export type TetaFormHelpSnapshot = {
  guid: string;
  title: string;
  summary: string;
  sections: string[];
  fields: TetaHelpFieldEntry[];
  sourcePath: string;
};

export type TetaApplicationObjectBinding = {
  gridColumnName?: string | null;
  oracleColumnName?: string | null;
  targetObject?: string | null;
  gatewayClassName?: string | null;
};

export type TetaApplicationObject = {
  objectId: string;
  dllName: string;
  formGuid: string | null;
  formName: string;
  fieldLabel: string | null;
  helpTitle: string | null;
  helpSummary: string | null;
  helpFieldText: string | null;
  helpSection: string | null;
  binding: TetaApplicationObjectBinding | null;
  keywords: string[];
  confidence: 'confirmed' | 'inferred';
};
