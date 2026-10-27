import type { ButtonHTMLAttributes } from 'react';
import { AppButton } from './AppButton.tsx';

/**
 * The button of the pages not yet moved to Tailwind, in their old look
 * (styles.css `.btn`). A page that moves uses AppButton instead; this goes
 * when the last one has.
 */
export function Button({ variant = 'normal', className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'normal' | 'primary' | 'danger' }) {
  return <AppButton variant="plain" className={`btn btn-${variant} ${className ?? ''}`} {...rest} />;
}
