import { sha256, stableStringify } from './teta-generic-semantic-binding.contract';
import type {
  DependencyVector,
  TetaGenericSemanticBindingResult,
} from './teta-generic-semantic-binding.types';

export function computeSemanticBindingInputFingerprint(input: {
  sourceAnalysisFingerprint: string;
  policyVersion: string;
  dependencyVector: DependencyVector;
}): string {
  return sha256(stableStringify(input));
}

export function computeSemanticBindingResultFingerprint(
  result: Omit<
    TetaGenericSemanticBindingResult,
    'semanticBindingInputFingerprint' | 'semanticBindingResultFingerprint'
  >,
): string {
  return sha256(stableStringify(result));
}
