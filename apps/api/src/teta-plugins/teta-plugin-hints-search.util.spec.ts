import { stripPersonNameLiteralsForPluginSearch } from './teta-plugin-search-query.util';

describe('stripPersonNameLiteralsForPluginSearch', () => {
  it('strips leading person names so plugin RAG sees field intent', () => {
    expect(stripPersonNameLiteralsForPluginSearch('Beata Styś ile ma lat?')).toBe('ile ma lat?');
    expect(stripPersonNameLiteralsForPluginSearch('A jakie ma Beata Styś aktualne stanowisko?')).toBe(
      'A jakie ma aktualne stanowisko?',
    );
  });

  it('keeps original query when stripping would leave too little text', () => {
    expect(stripPersonNameLiteralsForPluginSearch('Beata Styś')).toBe('Beata Styś');
  });
});
