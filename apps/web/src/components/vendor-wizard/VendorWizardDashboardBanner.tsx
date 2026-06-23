import type { SystemHealthResponse } from '@teta/shared';
import type { NavItem } from '../layout/Sidebar';
import { useVendorWizardSnapshot } from './useVendorWizardSnapshot';
import './vendor-wizard.css';

type VendorWizardDashboardBannerProps = {
  health: SystemHealthResponse | null;
  onNavigate: (item: NavItem) => void;
};

export function VendorWizardDashboardBanner({ health, onNavigate }: VendorWizardDashboardBannerProps) {
  const { progress, loading } = useVendorWizardSnapshot(health);

  if (progress.isFullyComplete) {
    return (
      <section className="vendor-wizard-banner vendor-wizard-banner--done" aria-label="Kreator wiedzy">
        <div className="vendor-wizard-banner__body">
          <p className="vendor-wizard-banner__title">Kreator wiedzy — wszystkie kroki ukończone</p>
          <p className="vendor-wizard-banner__desc">
            Wyeksportuj podsumowanie JSON dla zespołu Tety lub rozpocznij kreator od nowa.
          </p>
        </div>
        <button
          type="button"
          className="vendor-wizard-banner__cta"
          onClick={() => onNavigate('vendorWizard')}
        >
          Otwórz kreator
        </button>
      </section>
    );
  }

  if (progress.isMainFlowComplete) {
    return (
      <section className="vendor-wizard-banner vendor-wizard-banner--done" aria-label="Kreator wiedzy">
        <div className="vendor-wizard-banner__body">
          <p className="vendor-wizard-banner__title">Paczka RAG gotowa — główny przepływ ukończony</p>
          <p className="vendor-wizard-banner__desc">
            Opcjonalnie: kroki Oracle i mapowanie UI ({progress.completedCount}/{progress.totalSteps}).
          </p>
        </div>
        <button
          type="button"
          className="vendor-wizard-banner__cta"
          onClick={() => onNavigate('vendorWizard')}
        >
          Kreator
        </button>
      </section>
    );
  }

  return (
    <section className="vendor-wizard-banner" aria-label="Kreator wiedzy">
      <div className="vendor-wizard-banner__body">
        <p className="vendor-wizard-banner__title">
          Kontynuuj kreator wiedzy — krok {progress.currentStepNumber}/{progress.totalSteps}
        </p>
        <p className="vendor-wizard-banner__desc">
          <strong>{progress.currentStepLabel}</strong>
          {' · '}
          Ukończono {progress.completedCount} z {progress.totalSteps} kroków
          {loading ? ' · odświeżanie…' : ''}
        </p>
        <div className="vendor-wizard-banner__bar" role="progressbar" aria-valuenow={progress.completedCount} aria-valuemin={0} aria-valuemax={progress.totalSteps}>
          <div
            className="vendor-wizard-banner__bar-fill"
            style={{ width: `${(progress.completedCount / progress.totalSteps) * 100}%` }}
          />
        </div>
      </div>
      <button
        type="button"
        className="vendor-wizard-banner__cta"
        onClick={() => onNavigate('vendorWizard')}
      >
        Kontynuuj
      </button>
    </section>
  );
}
