// A downloaded track must really use its local file, even while signed in online.
// Resolve the remote URL lazily: offline sessions must never access it.
export async function playbackSource(
  songId: string,
  offline: boolean,
  localSource: (id: string) => Promise<string | undefined>,
  remoteSource: (id: string) => string,
): Promise<{ uri: string }> {
  let local: string | undefined;
  try { local = await localSource(songId); }
  catch (error) { if (offline) throw error; }
  if (local) return { uri: local };
  if (offline) throw new Error('Il file di questo brano non è disponibile su questo iPhone.');
  return { uri: remoteSource(songId) };
}
