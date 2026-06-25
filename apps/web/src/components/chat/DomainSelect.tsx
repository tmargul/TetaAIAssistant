import type { OracleAgentDomain } from '@teta/shared';
import { ORACLE_AGENT_DOMAIN_LABELS, ORACLE_AGENT_DOMAINS } from '@teta/shared';
import { CustomSelect } from '../ui/CustomSelect';

type DomainSelectProps = {
  value: OracleAgentDomain;
  onChange: (value: OracleAgentDomain) => void;
  disabled?: boolean;
};

export function DomainSelect({ value, onChange, disabled }: DomainSelectProps) {
  return (
    <CustomSelect
      value={value}
      disabled={disabled}
      onChange={(next) => onChange(next as OracleAgentDomain)}
      options={ORACLE_AGENT_DOMAINS.map((domain) => ({
        value: domain,
        label: ORACLE_AGENT_DOMAIN_LABELS[domain],
      }))}
    />
  );
}
