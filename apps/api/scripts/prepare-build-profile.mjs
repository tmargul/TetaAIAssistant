import { copyFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const profile = process.argv[2];
if (profile !== 'client' && profile !== 'vendor') {
  console.error('Użycie: node scripts/prepare-build-profile.mjs <client|vendor>');
  process.exit(1);
}

const apiRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

writeFileSync(
  join(apiRoot, 'src/build-profile.ts'),
  `/** Generowane przez prepare-build-profile.mjs — nie edytuj ręcznie. */\nexport const BUILD_PROFILE = '${profile}' as 'client' | 'vendor';\n\nexport function isVendorBuild(): boolean {\n  return BUILD_PROFILE === 'vendor';\n}\n`,
  'utf8',
);

copyFileSync(
  join(apiRoot, `src/rag/rag.module.${profile}.ts`),
  join(apiRoot, 'src/rag/rag.module.ts'),
);

console.log(`Build profile: ${profile}`);
