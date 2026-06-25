import type { ChatSourceMode, OracleAgentDomain } from '@teta/shared';
import { CHAT_SOURCE_MODES, ORACLE_AGENT_DOMAINS } from '@teta/shared';

const SOURCE_KEY = 'teta-chat-source';
const DOMAIN_KEY = 'teta-oracle-domain';

export function loadChatSourcePreference(): ChatSourceMode {
  try {
    const raw = localStorage.getItem(SOURCE_KEY);
    if (raw && (CHAT_SOURCE_MODES as readonly string[]).includes(raw)) {
      return raw as ChatSourceMode;
    }
  } catch {
    // ignore
  }
  return 'docs';
}

export function saveChatSourcePreference(mode: ChatSourceMode): void {
  try {
    localStorage.setItem(SOURCE_KEY, mode);
  } catch {
    // ignore
  }
}

export function loadOracleDomainPreference(): OracleAgentDomain {
  try {
    const raw = localStorage.getItem(DOMAIN_KEY);
    if (raw && (ORACLE_AGENT_DOMAINS as readonly string[]).includes(raw)) {
      return raw as OracleAgentDomain;
    }
  } catch {
    // ignore
  }
  return 'general';
}

export function saveOracleDomainPreference(domain: OracleAgentDomain): void {
  try {
    localStorage.setItem(DOMAIN_KEY, domain);
  } catch {
    // ignore
  }
}
