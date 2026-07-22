import { existsSync } from 'fs';
import * as path from 'path';
import {
  applyOracleStatuses,
  seedStage2bFromStage2a,
  splitLookupBindings,
} from './teta-stage2b.analyze';
import { readStage2bBindings } from './teta-stage2b.reader';
import type { Stage2aFormBinding } from './teta-stage2a-bindings.types';
import type { Stage2bBatchResult } from './teta-stage2b.types';

const clientRoot = 'A:\\TETA Aplikacja klienta - 33.5';
const serverRoot = 'A:\\TETA Serwer Aplikacji - 33.5';
const bosSales = path.join(
  serverRoot,
  'BusinessObjects',
  'Sales',
  'bosSalesDictionaries.dll',
);
const bosLista = path.join(serverRoot, 'BusinessObjects', 'Personnel', 'bosListaPlac.dll');
const bosKos = path.join(serverRoot, 'BusinessObjects', 'Personnel', 'bosKOS.dll');

const live =
  existsSync(bosSales) && existsSync(bosLista) && existsSync(bosKos);

describe('Stage 2B helpers', () => {
  it('seeds bos assemblies from Stage 2A forms', () => {
    const forms: Stage2aFormBinding[] = [
      {
        formType: 'Teta.Sumo.Sales.plgSalesDictionaries.DicRodzajeKoncesji',
        assemblies: [{ name: 'bosSalesDictionaries.dll', role: 'bos' }],
        dataFactories: [
          {
            fullType: 'Teta.Sumo.Sales.bosSalesDictionaries.DF.RodzajeKoncesjiDF',
            assembly: 'bosSalesDictionaries.dll',
          },
        ],
        businessObjects: [],
      },
    ];
    const seed = seedStage2bFromStage2a(forms);
    expect(seed.assemblies).toHaveLength(1);
    expect(seed.assemblies[0].assemblyName.toLowerCase()).toContain('bossalesdictionaries');
    expect(seed.assemblies[0].types[0]).toContain('RodzajeKoncesjiDF');
    expect(seed.dfRequested).toBe(1);
  });

  it('splits target vs lookup from alternatives (DesignMode dictionary)', () => {
    const forms: Stage2aFormBinding[] = [
      {
        formType: 'DanePodstawoweKOSWidok',
        bindings: [
          {
            control: 'lcboTypStanowiska',
            dataMember: 'ZSTP_ID',
            datasetTable: 'KartaOpisuStanowiska',
            alternatives: ['ZSTP_ID', 'NAZWA', 'KartaOpisuStanowiska', 'TypyStanowisk', 'ID'],
            binding: {
              dataMember: 'ZSTP_ID',
              datasetTable: 'KartaOpisuStanowiska',
            },
            evidence: [
              {
                assignment:
                  'lcboTypStanowiska.DictionaryColumnForDisplay = new DesignModeColumn(...)',
                offset: '0x01',
              },
            ],
          },
        ],
        conflicts: [
          {
            subject: 'lcboTypStanowiska.datasetTable',
            message: 'Multiple datasetTable values: KartaOpisuStanowiska vs TypyStanowisk',
          },
        ],
      },
    ];
    const { resolved } = splitLookupBindings(forms);
    const hit = resolved.find((r) => r.control === 'lcboTypStanowiska');
    expect(hit?.targetBinding).toEqual({
      datasetTable: 'KartaOpisuStanowiska',
      dataMember: 'ZSTP_ID',
    });
    expect(hit?.lookupBinding?.datasetTable).toBe('TypyStanowisk');
    expect(hit?.lookupBinding?.valueMember).toBe('ID');
    expect(hit?.lookupBinding?.displayMember).toBe('NAZWA');
  });

  it('splits target vs lookup binding without dropping either side', () => {
    const forms: Stage2aFormBinding[] = [
      {
        formType: 'TestForm',
        lookups: [
          {
            control: 'lcboTypStanowiska',
            lookupClass: 'LvdTypyStanowisk',
            pluginAssembly: 'plgPersonelLov.dll',
          },
        ],
        bindings: [
          {
            control: 'lcboTypStanowiska',
            dataMember: 'ZSTP_ID',
            datasetTable: 'KartaOpisuStanowiska',
            valueMember: 'ID',
            displayMember: 'NAZWA',
            binding: {
              dataMember: 'ZSTP_ID',
              datasetTable: 'KartaOpisuStanowiska',
              valueMember: 'ID',
              displayMember: 'NAZWA',
            },
            evidence: [
              {
                assignment: 'lcboTypStanowiska.ColumnName = "ZSTP_ID"',
                offset: '0x01',
              },
            ],
          },
        ],
        conflicts: [
          {
            subject: 'lcboTypStanowiska.datasetTable',
            message: 'Multiple datasetTable values: KartaOpisuStanowiska vs TypyStanowisk',
          },
        ],
      },
    ];
    const { resolved } = splitLookupBindings(forms);
    const hit = resolved.find((r) => r.control === 'lcboTypStanowiska');
    expect(hit?.targetBinding?.datasetTable).toBe('KartaOpisuStanowiska');
    expect(hit?.targetBinding?.dataMember).toBe('ZSTP_ID');
    expect(hit?.lookupBinding?.valueMember).toBe('ID');
    expect(hit?.lookupBinding?.displayMember).toBe('NAZWA');
    expect(hit?.lookupBinding?.datasetTable).toBe('TypyStanowisk');
  });

  it('marks Oracle statuses without deleting DLL facts', () => {
    const batch: Stage2bBatchResult = {
      ok: true,
      gateways: [
        {
          gatewayType: 'X.TG',
          viewName: 'NT_EXISTING',
          packageName: 'NT_MISSING_DAC',
          baseTableName: 'T_EXISTING',
        },
      ],
    };
    const kinds = new Map<string, 'TABLE' | 'VIEW' | 'PACKAGE'>();
    kinds.set('NT_EXISTING', 'VIEW');
    kinds.set('T_EXISTING', 'TABLE');
    const { confirmed, missing } = applyOracleStatuses(batch, kinds, true);
    expect(batch.gateways![0].viewName).toBe('NT_EXISTING');
    expect(batch.gateways![0].packageName).toBe('NT_MISSING_DAC');
    expect(batch.gateways![0].oracleViewStatus).toBe('confirmed_in_oracle');
    expect(batch.gateways![0].oraclePackageStatus).toBe(
      'confirmed_in_dll_not_found_in_oracle',
    );
    expect(confirmed).toBeGreaterThanOrEqual(2);
    expect(missing).toBeGreaterThanOrEqual(1);
  });
});

(live ? describe : describe.skip)('Stage 2B reference bos DLLs (live)', () => {
  it('DicRodzajeKoncesji DF → TG/MTG dataset/view/package + columns', () => {
    const result = readStage2bBindings({
      dllPath: bosSales,
      match: ['Teta.Sumo.Sales.bosSalesDictionaries.DF.RodzajeKoncesjiDF'],
      searchRoots: [clientRoot, serverRoot],
    });
    expect(result.ok).toBe(true);
    const df = result.types?.find((t) => t.name === 'RodzajeKoncesjiDF');
    expect(df?.typeResolutionStatus).toBe('found');
    expect(df?.technicalRole).toBe('DF');

    const tg = result.types?.find((t) => t.name === 'RodzajeKoncesjiTG');
    const gw = tg?.gateways?.[0] ?? df?.gateways?.[0];
    expect(gw?.datasetTable).toBe('RodzajeKoncesji');
    expect(gw?.viewName).toBe('NT_LG_SLO_RODZAJE_KONCESJI');
    expect(gw?.alias).toBe('RKNC');
    expect(gw?.packageName).toBe('NT_LG_SLO_RODZAJE_KONCESJI_DAC');
    expect(gw?.confidence).toBe('confirmed_from_il');

    const mtg = result.types?.find((t) => t.name === 'RodzajeKoncesjiMTG');
    const cols = (mtg?.datasetTables ?? [])
      .flatMap((d) => d.columns ?? [])
      .map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(['KOD', 'NAZWA', 'UP_TO_DATE']));
  });

  it('UsuwanieWynikowObliczenBO found in bosListaPlac', () => {
    const result = readStage2bBindings({
      dllPath: bosLista,
      match: [
        'Teta.Sumo.Personel.bosListaPlac.BO.UsuwanieWynikowObliczenBO',
      ],
      searchRoots: [serverRoot],
    });
    expect(result.ok).toBe(true);
    const bo = result.types?.find((t) => t.name === 'UsuwanieWynikowObliczenBO');
    expect(bo?.typeResolutionStatus).toBe('found');
    expect(bo?.technicalRole).toBe('BO');
    // Plugin IL alone missed Parametry columns; BO should expose dataset / gateway evidence when present
    expect(
      (bo?.datasetTables?.length ?? 0) +
        (bo?.gateways?.length ?? 0) +
        (bo?.constructorFacts?.length ?? 0) +
        (bo?.relatedGatewayTypes?.length ?? 0),
    ).toBeGreaterThan(0);
  });

  it('StanowiskoWStrukturzeOrgBO resolves in bosKOS', () => {
    const result = readStage2bBindings({
      dllPath: bosKos,
      match: ['Teta.Sumo.Personel.bosKOS.BO.StanowiskoWStrukturzeOrgBO'],
      searchRoots: [serverRoot],
    });
    expect(result.ok).toBe(true);
    const bo = result.types?.find((t) =>
      (t.fullName ?? '').endsWith('StanowiskoWStrukturzeOrgBO'),
    );
    expect(bo?.typeResolutionStatus).toBe('found');
    expect(bo?.technicalRole).toBe('BO');
  });
});
