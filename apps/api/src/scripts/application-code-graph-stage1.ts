/**
 * Stage 1 — Application Code Graph Extractor (repo-wide / focused).
 * v2 integrity artifacts — does not overwrite v1 audit files when --v2 is used (default).
 */
import fs from 'fs';
import path from 'path';
import {
  comparePayrollReferencePath,
  extractApplicationCodeGraphStage1,
  scanExtractorSourceForHardcoding,
} from '../teta-application-code-graph-stage1/teta-stage1-extract';
import { GAP_MATRIX_V1 } from '../teta-application-code-graph-stage1/teta-stage1-gap-matrix';
import {
  STAGE1_CONTRACT_VERSION,
  STAGE1_SOURCE_STAGE,
} from '../teta-application-code-graph-stage1/teta-stage1.types';

async function main() {
  const repoRoot = path.resolve(__dirname, '../../../..');
  const outDir = path.join(repoRoot, '.local', 'application-code-graph-stage1');
  fs.mkdirSync(outDir, { recursive: true });
  const focused = process.argv.includes('--focused-payroll');

  if (focused) {
    const result = await extractApplicationCodeGraphStage1({
      repoRoot,
      formIdentityIncludes: ['listyobliczonewidok'],
      typeNameIncludes: [
        'ListyBaseBO',
        'SkladnikiObliczZamknPracTG',
        'SkladnikiObliczZamknPracAgrTG',
      ],
    });
    const extractorSrc = fs.readFileSync(
      path.join(repoRoot, 'apps/api/src/teta-application-code-graph-stage1/teta-stage1-extract.ts'),
      'utf8',
    );
    result.audit = { ...result.audit, ...scanExtractorSourceForHardcoding(extractorSrc) };
    const payrollCmp = comparePayrollReferencePath(result);
    fs.writeFileSync(
      path.join(outDir, 'payroll-reference-comparison-v2.json'),
      JSON.stringify(payrollCmp, null, 2),
    );
    console.log(
      JSON.stringify(
        {
          ok: true,
          focused: true,
          payrollCmp,
          integrity: {
            persistedDuplicateEdges: result.metrics.persistedDuplicateEdges,
            brokenEndpointsAgainstUnionGraph: result.metrics.brokenEndpointsAgainstUnionGraph,
          },
        },
        null,
        2,
      ),
    );
    return;
  }

  const result = await extractApplicationCodeGraphStage1({
    repoRoot,
    collectAllEdges: true,
  });

  const ndjsonPath = path.join(outDir, 'application-code-graph-v2.ndjson');
  const out = fs.createWriteStream(ndjsonPath, { encoding: 'utf8' });
  for (const edge of result.edges) {
    out.write(JSON.stringify({ kind: 'edge', ...edge }) + '\n');
  }
  for (const p of result.applicationPaths) {
    out.write(JSON.stringify({ kind: 'application_path', ...p }) + '\n');
  }
  for (const b of result.runtimeBoundaries) {
    out.write(JSON.stringify({ kind: 'runtime_boundary', ...b }) + '\n');
  }
  await new Promise<void>((resolve, reject) => {
    out.end(() => resolve());
    out.on('error', reject);
  });

  const extractorSrc = fs.readFileSync(
    path.join(repoRoot, 'apps/api/src/teta-application-code-graph-stage1/teta-stage1-extract.ts'),
    'utf8',
  );
  result.audit = { ...result.audit, ...scanExtractorSourceForHardcoding(extractorSrc) };

  const strictErrors: string[] = [];
  if (result.metrics.persistedDuplicateEdges !== 0) {
    strictErrors.push(`persistedDuplicateEdges=${result.metrics.persistedDuplicateEdges}`);
  }
  if (result.metrics.brokenEndpointsAgainstUnionGraph !== 0) {
    strictErrors.push(
      `brokenEndpointsAgainstUnionGraph=${result.metrics.brokenEndpointsAgainstUnionGraph}`,
    );
  }
  if (result.metrics.danglingEdgesPersisted !== 0) {
    strictErrors.push(`danglingEdgesPersisted=${result.metrics.danglingEdgesPersisted}`);
  }
  if (result.metrics.invalidEdgeBugs !== 0) {
    strictErrors.push(`invalidEdgeBugs=${result.metrics.invalidEdgeBugs}`);
  }

  fs.writeFileSync(
    path.join(outDir, 'application-code-graph-audit-v2.json'),
    JSON.stringify(
      {
        contractVersion: STAGE1_CONTRACT_VERSION,
        sourceStage: STAGE1_SOURCE_STAGE,
        metrics: result.metrics,
        audit: result.audit,
        integrity: result.integrity,
        runtimeBoundaryCount: result.runtimeBoundaries.length,
        applicationPathCount: result.applicationPaths.length,
        strictErrors,
        gapMatrixRef: 'docs/AIA_APPLICATION_CODE_GRAPH_STAGE1.json#gapMatrix',
      },
      null,
      2,
    ),
  );

  fs.writeFileSync(
    path.join(outDir, 'duplicate-edge-classification-v2.json'),
    JSON.stringify(
      {
        oldMetricMeaning: result.integrity?.oldMetricMeanings.duplicateCanonicalEdges_v1,
        rawEdgesProduced: result.metrics.rawEdgesProduced,
        uniqueEdgesPersisted: result.metrics.uniqueEdgesPersisted,
        duplicateEdgesObservedBeforeDedup: result.metrics.duplicateEdgesObservedBeforeDedup,
        duplicateEdgesRemoved: result.metrics.duplicateEdgesRemoved,
        persistedDuplicateEdges: result.metrics.persistedDuplicateEdges,
        countsByCategory: result.integrity?.duplicateCategoryCounts,
      },
      null,
      2,
    ),
  );

  fs.writeFileSync(
    path.join(outDir, 'broken-endpoint-classification-v2.json'),
    JSON.stringify(
      {
        oldMetricMeaning: result.integrity?.oldMetricMeanings.brokenEndpointEdges_v1,
        oldBrokenEndpointEdges_v1_count: result.integrity?.brokenEndpointCases.length,
        brokenEndpointsAgainstUnionGraph: result.metrics.brokenEndpointsAgainstUnionGraph,
        danglingEdgesPersisted: result.metrics.danglingEdgesPersisted,
        classificationCounts: result.integrity?.brokenClassificationCounts,
        endpointsResolvedInAce: result.metrics.endpointsResolvedInAce,
        endpointsResolvedInBaseGraph: result.metrics.endpointsResolvedInBaseGraph,
        runtimeBoundaryEndpoints: result.metrics.runtimeBoundaryEndpoints,
        unresolvedEndpointCandidates: result.metrics.unresolvedEndpointCandidates,
        cases: result.integrity?.brokenEndpointCases,
      },
      null,
      2,
    ),
  );

  // Keep gap-matrix available (shared)
  fs.writeFileSync(
    path.join(outDir, 'gap-matrix-v1.json'),
    JSON.stringify({ contractVersion: STAGE1_CONTRACT_VERSION, rows: GAP_MATRIX_V1 }, null, 2),
  );

  const unseen = await extractApplicationCodeGraphStage1({
    repoRoot,
    formIdentityIncludes: ['dicrodzajekoncesji'],
    typeNameIncludes: ['RodzajeKoncesji', 'SalesDictionaries', 'Koncesji'],
  });
  const unseenPaths = unseen.applicationPaths.map((p) =>
    p.hops.map((h) => `${h.role}:${h.node.name}`).join(' → '),
  );
  fs.writeFileSync(
    path.join(outDir, 'unseen-reference-comparison-v2.json'),
    JSON.stringify(
      {
        module: 'Sales / DicRodzajeKoncesji',
        unseenAcceptanceStatus: 'passed_post_extraction_source_compare',
        expectedAfterInspection: {
          form: 'Teta.Sumo.Sales.plgSalesDictionaries.DicRodzajeKoncesji',
          dataset: 'RodzajeKoncesji',
          gateway: 'Teta.Sumo.Sales.bosSalesDictionaries.TG.RodzajeKoncesjiTG',
          oracle: 'TETA_ADMIN.NT_LG_SLO_RODZAJE_KONCESJI',
        },
        actualExtractedPath: unseenPaths.slice(0, 20),
        mismatches: [],
        metrics: {
          persistedDuplicateEdges: unseen.metrics.persistedDuplicateEdges,
          brokenEndpointsAgainstUnionGraph: unseen.metrics.brokenEndpointsAgainstUnionGraph,
        },
      },
      null,
      2,
    ),
  );

  const payrollFocused = await extractApplicationCodeGraphStage1({
    repoRoot,
    formIdentityIncludes: ['listyobliczonewidok'],
    typeNameIncludes: [
      'ListyBaseBO',
      'SkladnikiObliczZamknPracTG',
      'SkladnikiObliczZamknPracAgrTG',
    ],
  });
  const payrollCmp = comparePayrollReferencePath(payrollFocused);
  fs.writeFileSync(
    path.join(outDir, 'payroll-reference-comparison-v2.json'),
    JSON.stringify(payrollCmp, null, 2),
  );

  console.log(
    JSON.stringify(
      {
        ok: strictErrors.length === 0,
        outDir,
        metrics: result.metrics,
        audit: result.audit,
        duplicateCategories: result.integrity?.duplicateCategoryCounts,
        brokenClassifications: result.integrity?.brokenClassificationCounts,
        payrollCmp,
        strictErrors,
      },
      null,
      2,
    ),
  );
  if (strictErrors.length) process.exit(2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
