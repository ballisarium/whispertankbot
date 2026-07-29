const SAFE_ATOM = /^[A-Za-z0-9_.:-]{1,64}$/;

const safeAtom = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string' || !SAFE_ATOM.test(value)) return null;
  return value;
};

const safeUpdateId = (value) => {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  if (typeof value === 'string' && /^\d{1,20}$/.test(value)) return value;
  return 'unknown';
};

export const getSafeErrorLogContext = (
  error,
  { kind = 'internal', operation = null, updateId } = {}
) => ({
  code: safeAtom(error?.code ?? error?.response?.error_code),
  kind: safeAtom(error?.kind) || safeAtom(kind) || 'internal',
  operation: safeAtom(operation),
  updateId: safeUpdateId(updateId),
});
