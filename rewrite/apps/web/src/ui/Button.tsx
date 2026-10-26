import type { ButtonHTMLAttributes } from 'react';

/** The app's button. Every button goes through here, so they look and behave alike. */
export function Button({ variant = 'normal', className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'normal' | 'primary' | 'danger' }) {
  return <button type="button" className={`btn btn-${variant} ${className ?? ''}`} {...rest} />;
}
