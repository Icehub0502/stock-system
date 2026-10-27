import React, { useEffect, useState } from 'react';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';
import { hasRole } from '../utils/roles';

// Branches the logged-in owner/dev may work in. Fetched once per page load; managers and below get none.
function useBranches() {
  const { user } = useAuth();
  const [info, setInfo] = useState(null);

  useEffect(() => {
    if (!user || !hasRole(user, 'owner')) return undefined;
    let cancelled = false;
    client.get('/auth/branches')
      .then((res) => { if (!cancelled) setInfo(res.data.data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [user]);

  return info;
}

// Dropdown in the top bar: switch the shop this session works in.
export function BranchSwitcher() {
  const { user, switchShop } = useAuth();
  const info = useBranches();
  const [busy, setBusy] = useState(false);

  if (!user || !info || info.branches.length < 2) return null;

  const change = async (e) => {
    const shopId = Number(e.target.value);
    if (!shopId || shopId === user.shop_id) return;
    setBusy(true);
    try {
      await switchShop(shopId);
    } catch (err) {
      alert(err.response?.data?.error || 'สลับสาขาไม่สำเร็จ');
      setBusy(false);
    }
  };

  return (
    <select
      className="branch-switcher"
      value={user.shop_id}
      onChange={change}
      disabled={busy}
      aria-label="สลับสาขา"
      title="สลับสาขาที่กำลังทำงาน"
    >
      {info.branches.map((b) => (
        <option key={b.id} value={b.id}>
          {user.role === 'dev' ? `${b.group_name} · ` : ''}{b.name}{b.status === 'suspended' ? ' (ระงับ)' : ''}
        </option>
      ))}
    </select>
  );
}

// Red bar on every page while working in a shop other than the account's own one,
// so nobody forgets which shop they are changing data in.
export function BranchBanner() {
  const { user, switchShop } = useAuth();
  const info = useBranches();
  const [busy, setBusy] = useState(false);

  if (!user || !info) return null;
  const homeShopId = Number(user.home_shop_id) || user.shop_id;
  if (user.shop_id === homeShopId) return null;

  const current = info.branches.find((b) => b.id === user.shop_id);
  const goHome = async () => {
    setBusy(true);
    try {
      await switchShop(homeShopId);
    } catch (err) {
      alert(err.response?.data?.error || 'กลับสาขาของฉันไม่สำเร็จ');
      setBusy(false);
    }
  };

  return (
    <div className="branch-banner" role="status">
      <span>กำลังทำงานในสาขา: <strong>{current ? current.name : `#${user.shop_id}`}</strong></span>
      <button type="button" onClick={goHome} disabled={busy}>กลับสาขาของฉัน</button>
    </div>
  );
}
