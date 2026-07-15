import { readFileSync } from 'fs';
import { parseTetaHelpHtml } from './teta-help-html.parser';

describe('teta-help-html.parser', () => {
  it('parses field labels and descriptions from help HTML', () => {
    const html = readFileSync(
      'A:/TETA Aplikacja klienta - 33.5/Help/D3479F5A-E3F2-4D09-BD0B-E35BDB7F3E0F.html',
    );
    const snapshot = parseTetaHelpHtml(
      new TextDecoder('iso-8859-2').decode(html),
      'test.html',
      'd3479f5a-e3f2-4d09-bd0b-e35bdb7f3e0f',
    );

    expect(snapshot.title.toLowerCase()).toContain('wykszta');
    expect(snapshot.fields.some((field) => field.label.toLowerCase().includes('sta'))).toBe(true);
    const staz = snapshot.fields.find((field) => field.label.toLowerCase().includes('sta'));
    expect(staz?.description.toLowerCase()).toMatch(/stopien|automat/);
  });
});
