import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import NavBar from './components/NavBar';
import LoginPage from './pages/LoginPage';
import OfficeDashboard from './pages/OfficeDashboard';
import TechnicianScanPage from './pages/TechnicianScanPage';
import TransactionHistoryPage from './pages/TransactionHistoryPage';

function Home() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return user.role === 'office'
    ? <Navigate to="/office" replace />
    : <Navigate to="/scan" replace />;
}

function AppRoutes() {
  return (
    <>
      <NavBar />
      <div className="container">
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<Home />} />
          <Route
            path="/office"
            element={<ProtectedRoute roles={['office']}><OfficeDashboard /></ProtectedRoute>}
          />
          <Route
            path="/history"
            element={<ProtectedRoute roles={['office']}><TransactionHistoryPage /></ProtectedRoute>}
          />
          <Route
            path="/scan"
            element={<ProtectedRoute roles={['office', 'technician']}><TechnicianScanPage /></ProtectedRoute>}
          />
        </Routes>
      </div>
    </>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
