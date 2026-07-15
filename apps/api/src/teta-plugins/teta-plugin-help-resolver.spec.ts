import type { TetaApplicationObject } from './teta-application-object.types';
import { isFieldHelpQuestion, resolveHelpAnswerFromObjects } from './teta-plugin-help-resolver';

describe('teta-plugin-help-resolver', () => {
  const objects: TetaApplicationObject[] = [
    {
      objectId: 'plgDaneOsobowe:wyksztalcenie:form',
      dllName: 'plgDaneOsobowe.dll',
      formGuid: 'd3479f5a-e3f2-4d09-bd0b-e35bdb7f3e0f',
      formName: 'Wykształcenie',
      fieldLabel: null,
      helpTitle: 'Wykształcenie',
      helpSummary: 'Formularz służy do ewidencji wykształcenia pracownika.',
      helpFieldText: null,
      helpSection: null,
      binding: null,
      keywords: ['Wykształcenie'],
      confidence: 'confirmed',
    },
    {
      objectId: 'plgDaneOsobowe:wyksztalcenie:staz',
      dllName: 'plgDaneOsobowe.dll',
      formGuid: 'd3479f5a-e3f2-4d09-bd0b-e35bdb7f3e0f',
      formName: 'Wykształcenie',
      fieldLabel: 'Staż',
      helpTitle: 'Wykształcenie',
      helpSummary: 'Formularz służy do ewidencji wykształcenia pracownika.',
      helpFieldText: 'Pole uzupełniane automatycznie po wypełnieniu pola Stopień wykształcenia.',
      helpSection: 'Zakładka Szkoły',
      binding: {
        oracleColumnName: 'LATA_STAZU',
        targetObject: 'NT_KP_IMP_SZKOLY',
        gatewayClassName: 'SzkolyTG',
      },
      keywords: ['Staż', 'LATA_STAZU'],
      confidence: 'confirmed',
    },
  ];

  it('detects field help questions', () => {
    expect(isFieldHelpQuestion('Do czego służy pole Staż na formularzu Wykształcenie?')).toBe(true);
    expect(isFieldHelpQuestion('Jaki staż ma Kowalski?')).toBe(false);
  });

  it('builds answer from application objects', () => {
    const answer = resolveHelpAnswerFromObjects(
      'Do czego służy pole Staż na formularzu Wykształcenie?',
      objects,
    );
    expect(answer).toContain('Staż');
    expect(answer).toContain('Stopień wykształcenia');
    expect(answer).toContain('LATA_STAZU');
  });
});
