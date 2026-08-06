import path from 'path';
import {
  runStage3k2b2b2b2RealPilot,
} from '../teta-candidate-scoped-view-metadata-export/teta-view-metadata-real-pilot';
import {
  runStage3k2b2b2b2OfflineFinalization,
} from '../teta-candidate-scoped-view-metadata-export/teta-view-metadata-offline-finalization';
import { loadMetadataPolicy } from '../teta-candidate-scoped-view-metadata-export';

async function main() {
  const command = process.argv[2] ?? 'audit';
  const root = path.resolve(__dirname, '../../../..');
  const artifactVersionArg = process.argv.find((arg) => arg.startsWith('--artifact-version='));
  const artifactVersion =
    artifactVersionArg?.split('=')[1] === 'v3' ? 'v3' : 'v2';
  if (command === 'validate-policy') {
    console.log(JSON.stringify(loadMetadataPolicy(root), null, 2));
    return;
  }
  if (command !== 'audit' && command !== 'finalize-offline') {
    throw new Error(`unknown_command:${command}`);
  }

  if (command === 'finalize-offline') {
    const audit = await runStage3k2b2b2b2OfflineFinalization(root, {
      writeArtifacts: true,
      artifactVersion,
      acceptedStatus: process.argv.includes('--accepted'),
    });
    console.log(JSON.stringify(audit, null, 2));
    if (process.argv.includes('--strict') && Array.isArray(audit.strictErrors) && audit.strictErrors.length) {
      process.exitCode = 1;
    }
    return;
  }

  process.env.TETA_ORACLE_MODE = process.env.TETA_ORACLE_MODE ?? 'real';

  const audit = await runStage3k2b2b2b2RealPilot(root, {
    writeArtifacts: true,
    artifactVersion,
    executeRealOracleMetadataExport: process.argv.includes(
      '--execute-real-oracle-metadata-export',
    ),
    confirmMetadataOnlySingleObjectExport: process.argv.includes(
      '--confirm-metadata-only-single-object-export',
    ),
  });

  // Repo-safe console: never print raw DDL
  const safe = { ...audit } as Record<string, unknown>;
  delete safe.raw;
  console.log(JSON.stringify(safe, null, 2));
  if (process.argv.includes('--strict') && Array.isArray(audit.strictErrors) && audit.strictErrors.length) {
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
