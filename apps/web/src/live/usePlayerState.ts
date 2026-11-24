import { useEffect, useState } from 'react';

/** What a player shows, from the presenting window's audio or video or a controller's mirror of it. */
export interface PlayerSource<S> {
  state(): S;
  subscribe(fn: () => void): () => void;
}

/** The player's state, and while it plays, a fresh position four times a second. */
export function usePlayerState<S>(control: PlayerSource<S>): S {
  const [state, setState] = useState(() => control.state());
  useEffect(() => {
    const update = () => setState(control.state());
    const off = control.subscribe(update);
    const tick = setInterval(update, 250);
    update();
    return () => {
      off();
      clearInterval(tick);
    };
  }, [control]);
  return state;
}
