export interface TetaAppPathsConfig {
  /** Katalog instalacji Teta — aplikacja klienta (thick client). */
  clientDirectory: string;
  /** Katalog serwera aplikacyjnego Teta. */
  serverDirectory: string;
}

export interface TetaAppPathsStatusResponse extends TetaAppPathsConfig {
  updatedAt: string | null;
}

export interface TetaAppPathsUpdateRequest {
  clientDirectory: string;
  serverDirectory: string;
}
