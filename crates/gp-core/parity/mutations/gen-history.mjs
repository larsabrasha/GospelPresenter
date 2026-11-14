// Random inputs for history.ts's restoreSongVersion, between songs' changes that keep the versions it restores.
import { generator as songs } from './gen-songs.mjs';
import { generator as arrangements } from './gen-arrangements.mjs';

export function generator(t, step) {
  const { random, pick, idsOf, opt } = t;
  if (random() < 0.6) return (random() < 0.7 ? songs : arrangements)(t, step);
  const versions = idsOf('SELECT id || char(9) || song_id FROM song_versions').map((v) => v.split('\t'));
  const [versionId, songId] = versions.length && random() < 0.85 ? pick(versions) : [pick(['s1@1', 'vx', '', 'x'.repeat(201)]), pick(['s1', 's2'])];
  return { name: 'restoreSongVersion', args: opt({ songId: random() < 0.9 ? songId : pick(['s1', 's2', 'sx', '']), versionId: random() < 0.97 ? versionId : undefined }) };
}
