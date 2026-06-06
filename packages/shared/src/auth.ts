export type UserRole = 'admin' | 'user';

export interface AuthUser {
  id: number;
  oracleUsername: string;
  displayName?: string;
  role: UserRole;
}

export interface AuthSetupStatusResponse {
  oracleConfigured: boolean;
  adminBootstrapped: boolean;
  authenticated: boolean;
  user?: AuthUser;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  accessToken: string;
  user: AuthUser;
}

export interface AppUserRecord {
  id: number;
  oracleUsername: string;
  displayName?: string;
  role: UserRole;
  isActive: boolean;
  grantedBy?: number;
  createdAt: string;
  lastLoginAt?: string;
}

export interface GrantUserAccessRequest {
  oracleUsername: string;
  displayName?: string;
}

export interface TetaServer {
  id: number;
  name: string;
  description?: string;
  isEnabled: boolean;
  sortOrder: number;
}

export interface CreateTetaServerRequest {
  name: string;
  description?: string;
  isEnabled?: boolean;
  sortOrder?: number;
}

export interface UpdateTetaServerRequest {
  name?: string;
  description?: string;
  isEnabled?: boolean;
  sortOrder?: number;
}
