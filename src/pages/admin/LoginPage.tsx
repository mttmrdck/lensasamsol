import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError, post } from '../../lib/api';
import { Button, Callout, Field, Input } from '../../components/ui';
import type { Me } from './AdminApp';

export default function LoginPage({ me }: { me?: Me }) {
  const [username, setUsername] = useState(import.meta.env.DEV ? 'admin' : '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const next = params.get('next');
  const safeNext = next && next.startsWith('/admin') && !next.startsWith('//') ? next : '/admin';

  if (me?.authenticated) {
    queueMicrotask(() => navigate(safeNext, { replace: true }));
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post('/api/auth/login', { username, password });
      await qc.invalidateQueries({ queryKey: ['me'] });
      navigate(safeNext, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sign-in failed.');
      setBusy(false);
    }
  };

  return (
    <main className="studio-login grid min-h-svh place-items-center bg-canvas px-4 py-12">
      <div className="w-full max-w-[400px]">
        <div className="mb-8 flex flex-col items-center gap-3">
          <img src="/brand/icon-192.png" alt="" width={56} height={56} className="h-14 w-14" />
          <p className="font-display text-[26px] tracking-[-0.02em]">lensasamsol</p>
        </div>
        <form
          onSubmit={submit}
          className="flex flex-col gap-6 border-y border-line py-8"
        >
          <div className="flex flex-col gap-1">
            <h1 className="font-display text-[36px] tracking-[-0.03em]">Sign in</h1>
            <p className="text-[14px] text-slate">Manage collections, Drive folders and gallery design.</p>
          </div>
          {me && !me.configured && (
            <Callout tone="warn" title="Administrator accounts not set">
              Set ADMIN_CREDENTIALS_JSON on the server (see ENVIRONMENT.md) before signing in.
            </Callout>
          )}
          <Field label="User ID" htmlFor="username">
            <Input id="username" autoComplete="username" value={username} onChange={e=>setUsername(e.target.value)} required maxLength={80} />
          </Field>
          <Field label="Password" htmlFor="password" error={error}>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={!!error}
              autoFocus
              required
            />
          </Field>
          <Button type="submit" variant="primary" loading={busy} className="h-10">
            Sign in
          </Button>
          {import.meta.env.DEV && me?.demoMode && (
            <p className="text-center text-[12px] leading-5 text-slate">
              Local demo passphrase: <span className="font-mono">archive-demo-passphrase</span>
            </p>
          )}
        </form>
        <p className="mt-6 text-center text-[12px] text-muted">
          Private studio access. Client galleries open through their individual links.
        </p>
      </div>
    </main>
  );
}
