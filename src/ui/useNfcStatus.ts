import {useCallback, useEffect, useState} from 'react';

import {getNfcStatus, type NfcStatus} from '../lib/nfc.ts';

/** Resolves NFC availability once per mount, with a manual refresh escape hatch. */
export function useNfcStatus() {
  const [status, setStatus] = useState<NfcStatus | null>(null);

  const refresh = useCallback(async () => {
    setStatus(await getNfcStatus());
  }, []);

  useEffect(() => {
    let cancelled = false;
    getNfcStatus().then((next) => {
      if (!cancelled) setStatus(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return {status, refresh};
}
