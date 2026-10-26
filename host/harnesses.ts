export type Harness = 'native' | 'pi' | 'dsh';

/** Validate an explicit CLI or saved selection; legacy configurations enable all. */
export function parseHarnesses(value: unknown): Harness[] {
  if (value === undefined) return ['native', 'pi', 'dsh'];
  const values = typeof value === 'string' ? value.split(',') : value;
  if (
    !Array.isArray(values) ||
    values.length === 0 ||
    values.some((entry) => !['native', 'pi', 'dsh'].includes(entry)) ||
    new Set(values).size !== values.length ||
    !values.includes('native')
  )
    throw new Error(
      'Invalid harnesses: use native, optionally followed by pi and/or dsh, without duplicates',
    );
  return (['native', 'pi', 'dsh'] as const).filter((entry) =>
    values.includes(entry),
  );
}
