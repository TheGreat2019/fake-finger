export const BUILD = '1.5.1';
export const MODE_OPTIONS = {
  STRICT: 'strict',
  NORMALIZE: 'normalize',
  NATIVE: 'native',
};

export function compatibleBackend(status) {
  return Boolean(status && status.ok && status.build === BUILD);
}
