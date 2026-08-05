import path from 'path';
import {
  buildStage3k2b2b2b1Audit,
  loadMetadataPolicy,
} from '../teta-candidate-scoped-view-metadata-export';

async function main() {
  const command = process.argv[2] ?? 'audit';
  const root = path.resolve(__dirname, '../../../..');
  if (command === 'validate-policy') {
    console.log(JSON.stringify(loadMetadataPolicy(root), null, 2));
    return;
  }
  if (command !== 'audit') throw new Error(`unknown_command:${command}`);
  const audit = await buildStage3k2b2b2b1Audit(root, {
    writeArtifacts: true,
    executeRealOracleMetadataExport: process.argv.includes(
      '--execute-real-oracle-metadata-export',
    ),
    confirmMetadataOnlySingleObjectExport: process.argv.includes(
      '--confirm-metadata-only-single-object-export',
    ),
  });
  console.log(JSON.stringify(audit, null, 2));
  if (process.argv.includes('--strict') && audit.strictErrors.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
