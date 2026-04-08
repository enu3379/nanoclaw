import { describe, expect, it } from 'vitest';

import { _markFinalOutputDeliveryForTests } from './index.js';

describe('_markFinalOutputDeliveryForTests', () => {
  it('does not mark final delivery for progress chunks', () => {
    const delivered = _markFinalOutputDeliveryForTests(false, 'progress', true);
    expect(delivered).toBe(false);
  });

  it('marks final delivery for final visible chunks', () => {
    const delivered = _markFinalOutputDeliveryForTests(false, 'final', true);
    expect(delivered).toBe(true);
  });

  it('keeps final delivery sticky once set', () => {
    const afterFinal = _markFinalOutputDeliveryForTests(false, 'final', true);
    const afterProgress = _markFinalOutputDeliveryForTests(
      afterFinal,
      'progress',
      true,
    );
    const afterEmpty = _markFinalOutputDeliveryForTests(
      afterProgress,
      'final',
      false,
    );
    expect(afterFinal).toBe(true);
    expect(afterProgress).toBe(true);
    expect(afterEmpty).toBe(true);
  });
});
