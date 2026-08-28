import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function ProtectedRoute({ roles, ownerOnly, children }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  // เจ้าของร้าน (username 'ice') เท่านั้น — ใช้กับหน้า "ตั้งค่า" ไม่ผูกกับ role เพราะ
  // ระบบยังไม่มี role แยกสำหรับเจ้าของร้านโดยเฉพาะ (มีแค่ office/technician)
  if (ownerOnly && user.username !== 'ice') return <Navigate to="/" replace />;
  return children;
}
