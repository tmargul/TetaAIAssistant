/** Generowane przez prepare-build-profile.mjs — nie edytuj ręcznie. */
export const BUILD_PROFILE = 'vendor' as 'client' | 'vendor';

export function isVendorBuild(): boolean {
  return BUILD_PROFILE === 'vendor';
}
