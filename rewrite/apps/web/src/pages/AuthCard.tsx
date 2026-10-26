import type { ReactNode } from 'react';
import { t } from '../i18n.ts';

/** The frame of the screens before the app: sign-in, setup, invite and pairing. */
export function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="auth">
      <div className="auth-card">
        <p className="auth-brand">{t('app.name')}</p>
        <h1>{title}</h1>
        {children}
      </div>
    </main>
  );
}

export function FormError({ text }: { text: string | null }) {
  return text ? (
    <p className="danger" role="alert">
      {text}
    </p>
  ) : null;
}
