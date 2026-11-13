import { useEffect, useState } from 'react';
import { serverOrigin } from '../server.ts';

/**
 * Where other devices reach this server (spec 04 §7: links are built against
 * the server's address): on a desktop host its LAN address, not the
 * 127.0.0.1 its own window uses; elsewhere the server's (server.ts: this page's, or the phone app's).
 */
export function useServerBase(): string {
  const [base, setBase] = useState(serverOrigin);
  useEffect(() => {
    void window.gpDesktop?.lanUrls().then(([lan]) => lan && setBase(lan));
  }, []);
  return base;
}
