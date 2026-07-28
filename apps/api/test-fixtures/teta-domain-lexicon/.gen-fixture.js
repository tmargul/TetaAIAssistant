const fs = require('fs');
const path = require('path');

const fixturePath = path.join(__dirname, 'stage3j1-polish-phrases-v1.json');
const existing = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

const extra = [
  { query: 'Wyjaśnij fakturę VAT', expected: { scope: 'recognized_but_not_routed' } },
  { query: 'Pokaż środki trwałe', expected: { scope: 'recognized_but_not_routed' } },
  { query: 'Sprawdź rozrachunki z kontrahentem', expected: { scope: 'recognized_but_not_routed' } },
  { query: 'Zmień plan kont', expected: { scope: 'recognized_but_not_routed' } },
  { query: 'Dodaj nową fakturę', expected: { scope: 'recognized_but_not_routed' } },
  { query: 'Utwórz dokument księgowy', expected: { scope: 'recognized_but_not_routed' } },
  { query: 'Komu kończą się szkolenia BHP?', expected: { scope: 'recognized_but_not_routed' } },
  { query: 'Kiedy wygasają badania lekarskie?', expected: { scope: 'recognized_but_not_routed' } },
  { query: 'Pokaż ewidencję czasu pracy', expected: { scope: 'recognized_but_not_routed' } },
  { query: 'Wyświetl strukturę organizacyjną', expected: { scope: 'recognized_but_not_routed' } },
  { query: 'Opisz moduł Teta ME', expected: { scope: 'recognized_but_not_routed' } },
  { query: 'Pracownik i składnik płacowy 1350', expected: { scope: 'recognized_but_not_routed' } },
  { query: 'Lista', expected: { scope: null } },
  { query: 'Stawka', expected: { scope: null } },
  { query: 'Kod', expected: { scope: null } },
  { query: 'Nazwa', expected: { scope: null } },
  { query: 'Data', expected: { scope: null } },
  { query: 'Pokaż konfigurację składnika 1400', expected: { focus: 'full', scope: 'client_payroll_configuration' } },
  { query: 'Jak jest liczony składnik 1400 i gdzie jest używany?', expected: { focus: 'full', scope: 'client_payroll_configuration' } },
  { query: 'Na co wpływa składnik 1401?', expected: { focus: 'impact', scope: 'client_payroll_configuration' } },
  { query: 'Od czego zależy składnik 1402?', expected: { focus: 'dependencies', scope: 'client_payroll_configuration' } },
  { query: 'Jaka jest formuła składnika 1403?', expected: { focus: 'formula', scope: 'client_payroll_configuration' } },
  { query: 'Co to jest lista płac?', expected: { scope: 'generic_payroll_knowledge' } },
  { query: 'Wyjaśnij pracownika 00123', expected: { scope: 'recognized_but_not_routed' } },
  { query: 'Pokaż numer ewidencyjny 00456', expected: { scope: 'recognized_but_not_routed' } },
];

for (let i = 0; i < 60; i += 1) {
  const code = 1500 + i;
  extra.push({
    query: `Z czego liczy się składnik ${code}?`,
    expected: { focus: 'dependencies', scope: 'client_payroll_configuration' },
  });
}

for (let i = 0; i < 20; i += 1) {
  const code = 1600 + i;
  extra.push({
    query: `Co zależy od ${code}?`,
    expected: { focus: 'impact', scope: 'client_payroll_configuration' },
  });
}

const merged = [...existing];
const seen = new Set(existing.map((e) => e.query));
for (const row of extra) {
  if (seen.has(row.query)) continue;
  merged.push(row);
  seen.add(row.query);
}

fs.writeFileSync(fixturePath, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
console.log('fixtures', merged.length);
