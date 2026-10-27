import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { hasRole } from '../utils/roles';

// roles: the lowest role in the list is the minimum (a higher role never loses access).
// minRole: explicit minimum, e.g. "manager" for pages with sales figures / shop settings.
export default function ProtectedRoute({ roles, minRole, children }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.some((r) => hasRole(user, r))) return <Navigate to="/" replace />;
  if (minRole && !hasRole(user, minRole)) return <Navigate to="/" replace />;
  return children;
}
