export type TetaPluginComputedIntent = {
  id: string;
  phrases: string[];
  sourceColumnLabels: string[];
  sourceColumnNames?: string[];
  selectExpression: string;
  resultAlias: string;
  requiresFilter?: boolean;
};

export type TetaComputedIntentConfig = {
  global: TetaPluginComputedIntent[];
  byDll?: Record<string, TetaPluginComputedIntent[]>;
};
