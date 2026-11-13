import { removeRunDir } from './temp.ts';

export default function globalTeardown(): void {
  removeRunDir();
}
