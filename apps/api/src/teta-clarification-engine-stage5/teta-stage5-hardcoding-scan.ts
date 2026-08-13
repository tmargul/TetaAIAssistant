/**
 * Static scan for scenario-specific clarification hardcoding + production forceSemantic isolation.
 */
import fs from 'fs';
import path from 'path';
import type { Stage5Audit } from './teta-stage5.types';
import { emptyStage5Audit } from './teta-stage5.types';

function walkTsFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walkTsFiles(p));
    else if (ent.isFile() && ent.name.endsWith('.ts') && !ent.name.endsWith('.spec.ts')) {
      out.push(p);
    }
  }
  return out;
}

export function scanStage5ModuleDir(moduleDir: string): Stage5Audit {
  const audit = emptyStage5Audit();
  const files = walkTsFiles(moduleDir);
  for (const file of files) {
    const base = path.basename(file);
    const text = fs.readFileSync(file, 'utf8');
    if (
      /if\s*\([^)]*current[_ ]?position[^)]*\)\s*\{[^}]*ask/i.test(text) ||
      /businessConcept\s*===\s*['"]current employee position['"]\s*[^\n]*clarif/i.test(text)
    ) {
      audit.hardcodedCurrentPositionClarification += 1;
      audit.scenarioSpecificClarificationBranches += 1;
    }
    if (/businessConcept\s*===\s*['"]calculated payroll/i.test(text) && /clarif/i.test(text)) {
      audit.hardcodedPayrollClarification += 1;
      audit.scenarioSpecificClarificationBranches += 1;
    }
    if (/time.?work.?group|TWG/i.test(base) && /clarif/i.test(text)) {
      audit.hardcodedTwgClarification += 1;
      audit.scenarioSpecificClarificationBranches += 1;
    }
    if (
      (/bhp|prophylactic|occupational health/i.test(text) &&
        /businessConcept\s*===/.test(text) &&
        /clarif/i.test(text)) ||
      (/businessConcept\s*===\s*['"][^'"]*bhp/i.test(text) && /clarif/i.test(text))
    ) {
      audit.hardcodedBhpClarification += 1;
      audit.scenarioSpecificClarificationBranches += 1;
    }

    // Production plan export must not accept forceSemanticDimension
    if (base === 'teta-stage5-resolve.ts') {
      if (
        /export type PlanClarificationInput\s*=\s*\{[^}]*forceSemanticDimension/s.test(text)
      ) {
        audit.forceSemanticDimensionProductionReachable += 1;
      }
      if (
        /export function planClarificationFromStage4\s*\([^)]*forceSemanticDimension/s.test(text)
      ) {
        audit.forceSemanticDimensionProductionReachable += 1;
      }
    }
  }
  return audit;
}
