// The trial's tokens, as setup.sh wrote them to .local/tokens.env (git-ignored).
import { readFileSync } from 'node:fs';

export function trialToken(name: 'SETUP_TOKEN' | 'TRIAL_DEBUG_TOKEN'): string {
  const text = readFileSync(new URL('./.local/tokens.env', import.meta.url), 'utf8');
  const value = text.match(new RegExp(`^${name}=(.*)$`, 'm'))?.[1]?.trim();
  if (!value) throw new Error(`${name} is not in scripts/cf-trial/.local/tokens.env; run setup.sh first`);
  return value;
}
