import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { AuthUser, LoginResponse } from '@teta/shared';
import { authFetch, clearAccessToken, getAccessToken, setAccessToken } from '../lib/auth-storage';

type AuthContextValue = {
  user: AuthUser | null;
  setSession: (response: LoginResponse) => void;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({
  initialUser,
  children,
}: {
  initialUser: AuthUser | null;
  children: ReactNode;
}) {
  const [user, setUser] = useState<AuthUser | null>(initialUser);

  const setSession = useCallback((response: LoginResponse) => {
    setAccessToken(response.accessToken);
    setUser(response.user);
  }, []);

  const logout = useCallback(() => {
    clearAccessToken();
    setUser(null);
    window.location.reload();
  }, []);

  const value = useMemo(() => ({ user, setSession, logout }), [user, setSession, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}

export async function fetchSetupStatus() {
  const res = await authFetch('/api/auth/setup-status');
  if (!res.ok) throw new Error('Nie udało się sprawdzić statusu aplikacji.');
  return res.json();
}

export function readStoredToken() {
  return getAccessToken();
}
