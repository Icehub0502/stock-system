import { useCallback, useEffect, useState } from 'react';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';

// Print header of the signed-in shop (company details, logo, colour) for each document type.
// Fetched once per shop and shared by every print template and preview; saving the settings page calls
// refreshDocHeaders() so open screens pick the new header up.

const EMPTY = {
  company_name: '', address: '', phone: '', line_id: '', tax_id: '', branch_text: '',
  title: '', accent_color: '', logo_path: '', logo_width: 130,
};

let cache = null; // { shopId, data }
let inflight = null;
const listeners = new Set();

function load(shopId, force = false) {
  if (!force && cache && cache.shopId === shopId) return Promise.resolve(cache.data);
  if (!force && inflight && inflight.shopId === shopId) return inflight.promise;
  const promise = client.get('/doc-settings')
    .then((res) => {
      cache = { shopId, data: res.data.data };
      listeners.forEach((fn) => fn());
      return cache.data;
    })
    .catch(() => null)
    .finally(() => { if (inflight && inflight.promise === promise) inflight = null; });
  inflight = { shopId, promise };
  return promise;
}

export function refreshDocHeaders(shopId) {
  return load(shopId, true);
}

// docType: 'quotation' | 'receipt' → { header, loaded }
export function useDocHeader(docType) {
  const { user } = useAuth();
  const shopId = user ? user.shop_id : null;
  const [, setTick] = useState(0);

  useEffect(() => {
    const onChange = () => setTick((n) => n + 1);
    listeners.add(onChange);
    if (shopId) load(shopId);
    return () => { listeners.delete(onChange); };
  }, [shopId]);

  const fresh = cache && cache.shopId === shopId ? cache.data : null;
  return { header: fresh ? fresh[docType] || EMPTY : EMPTY, loaded: Boolean(fresh) };
}

export function useRefreshDocHeaders() {
  const { user } = useAuth();
  return useCallback(() => refreshDocHeaders(user ? user.shop_id : null), [user]);
}
