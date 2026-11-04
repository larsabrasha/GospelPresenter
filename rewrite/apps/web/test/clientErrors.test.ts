import { describe, expect, it } from 'vitest';
import { CLIENT_ERROR_LIMITS } from '@gp/core';
import { reportOf } from '../src/clientErrors.ts';

describe('reportOf', () => {
  it('names an error by its kind and message, with its stack, the page and the version', () => {
    const error = new TypeError('x is undefined');

    const report = reportOf(error, '/presentations/P1', 'f88d45a');

    expect(report).toEqual({ message: 'TypeError: x is undefined', stack: error.stack, where: '/presentations/P1', version: 'f88d45a' });
  });

  it('says what was thrown when it is no error, without a stack', () => {
    expect(reportOf('offline', '/', null)).toEqual({ message: 'offline', stack: null, where: '/', version: null });
  });

  it('cuts a long message to what the server takes', () => {
    expect(reportOf(new Error('x'.repeat(2000)), '/', null).message).toHaveLength(CLIENT_ERROR_LIMITS.message);
  });
});
