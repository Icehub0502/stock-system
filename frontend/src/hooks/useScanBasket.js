import { useCallback, useEffect, useState } from 'react';
import { addToBasket, setBasketQty } from '../utils/scanBatch';

// What has been scanned on this bill but not put on it yet. Kept in the browser so that a phone that locks or
// reloads in the middle of unpacking a delivery does not lose the count; it stays on this device only.
function storageKey(sessionId) {
  return sessionId ? `scan-basket:${sessionId}` : null;
}

function readBasket(key) {
  if (!key) return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(parsed)
      ? parsed.filter((row) => row && typeof row.code === 'string' && Number.isInteger(row.qty) && row.qty > 0)
      : [];
  } catch {
    return [];
  }
}

function writeBasket(key, items) {
  if (!key) return;
  try {
    if (items.length > 0) localStorage.setItem(key, JSON.stringify(items));
    else localStorage.removeItem(key);
  } catch {
    // storage blocked or full: the basket still works until the page closes
  }
}

// What is waiting on this device for a bill, for the pages that show bills
export function basketSummary(sessionId) {
  const items = readBasket(storageKey(sessionId));
  return { codes: items.length, qty: items.reduce((sum, row) => sum + row.qty, 0) };
}

// Ids of the bills with scans waiting on this device
export function basketSessionIds() {
  try {
    return Object.keys(localStorage)
      .map((key) => /^scan-basket:(\d+)$/.exec(key))
      .filter(Boolean)
      .map((match) => Number(match[1]));
  } catch {
    return [];
  }
}

// the bill is gone, so what waited for it has nowhere to go
export function forgetBasket(sessionId) {
  writeBasket(storageKey(sessionId), []);
}

export default function useScanBasket(sessionId) {
  const key = storageKey(sessionId);
  const [items, setItems] = useState(() => readBasket(key));
  const [loadedKey, setLoadedKey] = useState(key);

  // another bill was opened: show its basket straight away instead of writing this one over it
  if (loadedKey !== key) {
    setLoadedKey(key);
    setItems(readBasket(key));
  }

  useEffect(() => {
    if (loadedKey === key) writeBasket(key, items);
  }, [items, key, loadedKey]);

  const add = useCallback((code) => setItems((prev) => addToBasket(prev, code)), []);
  const setQty = useCallback((code, qty) => setItems((prev) => setBasketQty(prev, code, qty)), []);
  const clear = useCallback(() => setItems([]), []);

  return {
    items,
    add,
    setQty,
    clear,
    totalQty: items.reduce((sum, row) => sum + row.qty, 0),
  };
}
