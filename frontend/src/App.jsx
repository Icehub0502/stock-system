import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute";
import NavBar from "./components/NavBar";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import StockRackPage from "./pages/StockRackPage";
import TechnicianScanPage from "./pages/TechnicianScanPage";
import TransactionHistoryPage from "./pages/TransactionHistoryPage";
import ReceiptSessionPage from "./pages/ReceiptSessionPage";
import ReceiptListPage from "./pages/ReceiptListPage";
import QuotationListPage from "./pages/QuotationListPage";
import CustomerManagementPage from "./pages/CustomerManagementPage";
import VehicleManagementPage from "./pages/VehicleManagementPage";
import ServiceItemManagementPage from "./pages/ServiceItemManagementPage";
import WarrantyManagementPage from "./pages/WarrantyManagementPage";
import ProductCostPage from "./pages/ProductCostPage";
import WingArmDashboard from "./pages/WingArmDashboard";
import DailySalesSummaryPage from "./pages/DailySalesSummaryPage";
import RepairNoticeListPage from "./pages/RepairNoticeListPage";
import RepairNoticePage from "./pages/RepairNoticePage";

function Home() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return user.role === "office" ? (
    <Navigate to="/dashboard" replace />
  ) : (
    <Navigate to="/scan" replace />
  );
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
            path="/dashboard"
            element={
              <ProtectedRoute roles={["office"]}>
                <DashboardPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/stock-rack"
            element={
              <ProtectedRoute roles={["office"]}>
                <StockRackPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/history"
            element={
              <ProtectedRoute roles={["office"]}>
                <TransactionHistoryPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/scan"
            element={
              <ProtectedRoute roles={["office", "technician"]}>
                <TechnicianScanPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/receipts"
            element={
              <ProtectedRoute roles={["office"]}>
                <ReceiptSessionPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/product-costs"
            element={
              <ProtectedRoute roles={["office"]}>
                <ProductCostPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/wing-arms"
            element={
              <ProtectedRoute roles={["office"]}> {/* ✅ ใส่ guard ด้วย */}
                <WingArmDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/customers"
            element={
              <ProtectedRoute roles={["office"]}>
                <CustomerManagementPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/vehicles"
            element={
              <ProtectedRoute roles={["office"]}>
                <VehicleManagementPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/service-items"
            element={
              <ProtectedRoute roles={["office"]}>
                <ServiceItemManagementPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/warranties"
            element={
              <ProtectedRoute roles={["office"]}>
                <WarrantyManagementPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/receipt-list"
            element={
              <ProtectedRoute roles={["office"]}>
                <ReceiptListPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/quotations"
            element={
              <ProtectedRoute roles={["office"]}>
                <QuotationListPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/daily-summary"
            element={
              <ProtectedRoute roles={["office"]}>
                <DailySalesSummaryPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/repair-notices"
            element={
              <ProtectedRoute roles={["office", "technician"]}>
                <RepairNoticeListPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/repair-notices/new"
            element={
              <ProtectedRoute roles={["office", "technician"]}>
                <RepairNoticePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/repair-notices/:id"
            element={
              <ProtectedRoute roles={["office", "technician"]}>
                <RepairNoticePage />
              </ProtectedRoute>
            }
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