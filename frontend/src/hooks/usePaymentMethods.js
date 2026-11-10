import { useEffect, useState } from 'react';
import client from '../api/client';
import { PAYMENT_METHODS } from '../utils/paymentMethods';

// The payment methods (banks, cash, card) of the signed-in branch, set at หน้าตั้งค่า. Loaded once per sign-in and shared
// by every screen; [] until loaded, so no screen offers another branch's bank in the meantime.
let cache = { token: null, methods: null, promise: null };
const listeners = new Set();

function load() {
  const token = localStorage.getItem('token');
  if (cache.token === token && (cache.methods || cache.promise)) return cache.promise || Promise.resolve(cache.methods);
  cache = { token, methods: null, promise: null };
  cache.promise = client.get('/settings/payment-methods')
    .then((res) => (Array.isArray(res.data?.data) && res.data.data.length ? res.data.data : PAYMENT_METHODS))
    .catch(() => PAYMENT_METHODS)
    .then((methods) => {
      if (cache.token === token) cache = { token, methods, promise: null };
      listeners.forEach((fn) => fn(methods));
      return methods;
    });
  return cache.promise;
}

// after the list is saved at หน้าตั้งค่า, every open screen shows the new list
export function setPaymentMethodsCache(methods) {
  cache = { token: localStorage.getItem('token'), methods, promise: null };
  listeners.forEach((fn) => fn(methods));
}

// fetch as the app starts, so a bill-closing dialog opens with its banks already there
if (localStorage.getItem('token')) load();

export default function usePaymentMethods() {
  const token = localStorage.getItem('token');
  const [methods, setMethods] = useState(() => (cache.token === token && cache.methods) || []);
  useEffect(() => {
    listeners.add(setMethods);
    load().then(setMethods);
    return () => listeners.delete(setMethods);
  }, []);
  return methods;
}
