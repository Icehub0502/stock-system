import React, { createContext, useContext, useState } from 'react';
import client from '../api/client';
import { disconnectSockets } from '../utils/socket';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem('user');
    return saved ? JSON.parse(saved) : null;
  });

  // shopCode empty = the main shop (shop 1)
  const login = async (username, password, shopCode = '') => {
    const res = await client.post('/auth/login', { username, password, shop_code: shopCode.trim() });
    localStorage.setItem('token', res.data.token);
    localStorage.setItem('user', JSON.stringify(res.data.user));
    setUser(res.data.user);
    return res.data.user;
  };

  // Work inside another branch (owner: own group, dev: any shop). A new token is issued for that shop;
  // the page is reloaded afterwards so every screen, cache and live connection starts fresh in the new shop.
  const switchShop = async (shopId) => {
    const res = await client.post('/auth/switch-shop', { shop_id: shopId });
    localStorage.setItem('token', res.data.token);
    localStorage.setItem('user', JSON.stringify(res.data.user));
    window.location.assign('/');
  };

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
    disconnectSockets();
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, switchShop }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}


