import { describe, expect, it } from 'vitest';
import { connectionIdentityChanged } from './connection-session';
describe('connection auth invalidation',()=>{
  it('preserves an in-flight OAuth redirect on same-user tab focus and token refresh',()=>{
    expect(connectionIdentityChanged('creator','creator')).toBe(false);
  });
  it('invalidates private data and in-flight work on sign-out or an account switch',()=>{
    expect(connectionIdentityChanged('creator',null)).toBe(true);
    expect(connectionIdentityChanged('creator','other')).toBe(true);
  });
  it('loads initial signed-in and signed-out status',()=>{
    expect(connectionIdentityChanged(undefined,'creator')).toBe(true);
    expect(connectionIdentityChanged(undefined,null)).toBe(true);
  });
});
