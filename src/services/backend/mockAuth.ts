import { read, write, safeStorage } from '../storage';
import type { AuthAdapter, AuthChangeEvent, AuthSession, MockAccount } from './types';

export const MOCK_ACCOUNTS: MockAccount[] = [
  { id: '11111111-1111-4111-8111-111111111111', email: 'alice.dev@localhost', name: 'Alice Dev' },
  { id: '22222222-2222-4222-8222-222222222222', email: 'bob.dev@localhost', name: 'Bob Dev' },
  { id: '33333333-3333-4333-8333-333333333333', email: 'carol.dev@localhost', name: 'Carol Dev' },
];

const SESSION_KEY = 'local-auth-session';

function toSession(account: MockAccount): AuthSession {
  return {
    user: {
      id: account.id,
      email: account.email,
      user_metadata: { full_name: account.name, name: account.name, avatar_url: '' },
    },
  };
}

/** In-browser Google OAuth stand-in for localhost development. */
export class MockGoogleAuth implements AuthAdapter {
  readonly kind = 'local' as const;
  readonly available = true;
  private session: AuthSession | null = null;
  private listeners = new Set<(event: AuthChangeEvent, session: AuthSession | null) => void>();

  async init() {
    const stored = read<AuthSession | null>(SESSION_KEY, null);
    if (stored?.user?.id && MOCK_ACCOUNTS.some(account => account.id === stored.user.id)) {
      this.session = stored;
    }
  }

  getSession() { return this.session; }

  onAuthStateChange(callback: (event: AuthChangeEvent, session: AuthSession | null) => void) {
    this.listeners.add(callback);
    return () => { this.listeners.delete(callback); };
  }

  listMockAccounts() { return MOCK_ACCOUNTS; }

  async signInWithGoogle(accountId?: string) {
    const account = MOCK_ACCOUNTS.find(item => item.id === accountId) ?? MOCK_ACCOUNTS[0];
    this.session = toSession(account);
    write(SESSION_KEY, this.session);
    this.emit('SIGNED_IN', this.session);
  }

  async signOut() {
    this.session = null;
    safeStorage.removeItem(`neon:${SESSION_KEY}`);
    this.emit('SIGNED_OUT', null);
  }

  private emit(event: AuthChangeEvent, session: AuthSession | null) {
    for (const listener of this.listeners) listener(event, session);
  }
}
