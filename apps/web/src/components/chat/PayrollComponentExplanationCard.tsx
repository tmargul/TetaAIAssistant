import { useState } from 'react';
import type { TetaPayrollComponentChatResponse } from '@teta/shared';
import './payroll-component-explanation-card.css';

const LIST_LIMIT = 100;

type Props = {
  response: TetaPayrollComponentChatResponse;
};

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${m[3]}.${m[2]}.${m[1]}`;
}

function ExpandableList<T>({
  items,
  renderItem,
}: {
  items: T[];
  renderItem: (item: T, index: number) => React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? items : items.slice(0, LIST_LIMIT);
  return (
    <>
      <ul className="payroll-card__list">
        {visible.map((item, index) => (
          <li key={index}>{renderItem(item, index)}</li>
        ))}
      </ul>
      {items.length > LIST_LIMIT && !expanded && (
        <button type="button" className="payroll-card__more" onClick={() => setExpanded(true)}>
          Pokaż więcej ({items.length - LIST_LIMIT})
        </button>
      )}
    </>
  );
}

export function PayrollComponentExplanationCard({ response }: Props) {
  const explanation = response.explanation;
  const dataExpired = response.historyRedaction.dataExpired || explanation?.dataExpired;

  if (response.status === 'snapshot_required') {
    return (
      <div className="payroll-card payroll-card--required">
        <h3 className="payroll-card__title">Wymagany raport parametrów płacowych</h3>
        <p>{response.message}</p>
        <ol className="payroll-card__instructions">
          <li>Otwórz w Teta menu Wydruki.</li>
          <li>Wybierz Płace.</li>
          <li>Uruchom Wydruk parametrów płacowych.</li>
          <li>Zapisz raport jako RTF i załaduj go w ustawieniach.</li>
        </ol>
        <p className="payroll-card__link-hint">Przejdź do: Ustawienia → Parametryzacja płac</p>
      </div>
    );
  }

  if (response.status === 'ambiguous_component' && explanation?.candidates?.length) {
    return (
      <div className="payroll-card payroll-card--ambiguous">
        <h3 className="payroll-card__title">{response.title}</h3>
        <p>{response.message}</p>
        <ExpandableList
          items={explanation.candidates}
          renderItem={(c) => (
            <span>
              <strong>{c.code}</strong>
              {c.title ? ` — ${c.title}` : ''}
              {c.typeCode ? ` (${c.typeCode})` : ''}
            </span>
          )}
        />
      </div>
    );
  }

  if (dataExpired && !explanation?.formula.raw) {
    return (
      <div className="payroll-card payroll-card--expired">
        <h3 className="payroll-card__title">{response.title}</h3>
        <p>{response.message}</p>
        <p className="payroll-card__expired-note">
          Szczegóły konfiguracji nie są trwale przechowywane. Uruchom analizę ponownie, aby
          odczytać aktualny snapshot.
        </p>
      </div>
    );
  }

  if (!explanation?.component) {
    return (
      <div className="payroll-card">
        <h3 className="payroll-card__title">{response.title}</h3>
        <p>{response.message}</p>
      </div>
    );
  }

  const comp = explanation.component;
  const reportDate = formatDate(explanation.source?.reportGeneratedAt);

  return (
    <div className="payroll-card">
      <div className="payroll-card__header">
        <h3 className="payroll-card__title">{response.title}</h3>
        {reportDate !== '—' && (
          <span className="payroll-card__date">Raport: {reportDate}</span>
        )}
      </div>
      <div className="payroll-card__badges">
        {comp.typeCode && (
          <span className="payroll-card__badge">{comp.typeCode}</span>
        )}
        {comp.correctionMode != null ? (
          <span className="payroll-card__badge payroll-card__badge--muted">
            {comp.correctionMode}
          </span>
        ) : (
          <span className="payroll-card__badge payroll-card__badge--muted">Brak trybu korekty</span>
        )}
        {response.status === 'completed_with_warnings' && (
          <span className="payroll-card__badge payroll-card__badge--warn">Ostrzeżenia</span>
        )}
      </div>
      <p className="payroll-card__summary">{explanation.narrative.summary}</p>
      {explanation.formula.available && explanation.formula.raw && (
        <div className="payroll-card__section">
          <h4>Wzór</h4>
          <pre className="payroll-card__formula">{explanation.formula.raw}</pre>
          {explanation.narrative.formulaExplanation && (
            <p className="payroll-card__text">{explanation.narrative.formulaExplanation}</p>
          )}
        </div>
      )}
      {explanation.dependencies.direct.length > 0 && (
        <div className="payroll-card__section">
          <h4>Zależności bezpośrednie</h4>
          <ExpandableList
            items={explanation.dependencies.direct}
            renderItem={(d) => (
              <span>
                {d.componentCode}
                {d.componentTitle ? ` — ${d.componentTitle}` : ''}
              </span>
            )}
          />
        </div>
      )}
      {explanation.dependencies.transitive.length > 0 && (
        <details className="payroll-card__details">
          <summary>Zależności pośrednie ({explanation.dependencies.transitive.length})</summary>
          <ExpandableList
            items={explanation.dependencies.transitive}
            renderItem={(t) => (
              <span>
                {t.componentCode} (głęb. {t.minimumDepth})
                {t.paths[0]?.length ? `: ${t.paths[0].join(' → ')}` : ''}
              </span>
            )}
          />
        </details>
      )}
      {explanation.impact.directDependents.length > 0 && (
        <div className="payroll-card__section">
          <h4>Używany przez</h4>
          <ExpandableList
            items={explanation.impact.directDependents}
            renderItem={(d) => (
              <span>
                {d.componentCode}
                {d.componentTitle ? ` — ${d.componentTitle}` : ''}
              </span>
            )}
          />
        </div>
      )}
      {explanation.impact.calculationFormulaUses.length > 0 && (
        <div className="payroll-card__section">
          <h4>Formuły kalkulacyjne ({explanation.impact.calculationFormulaUses.length})</h4>
          <ExpandableList
            items={explanation.impact.calculationFormulaUses}
            renderItem={(u) => (
              <span>
                {u.formulaInternalId}
                {u.title ? ` — ${u.title}` : ''}
              </span>
            )}
          />
        </div>
      )}
      {explanation.diagnostics.length > 0 && (
        <div className="payroll-card__section payroll-card__section--warn">
          <h4>Diagnostyka</h4>
          <ExpandableList
            items={explanation.diagnostics}
            renderItem={(d) => <span>{d.message}</span>}
          />
        </div>
      )}
    </div>
  );
}
