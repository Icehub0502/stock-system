import React, { Suspense, lazy } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute";
import NavBar from "./components/NavBar";
import QueueNavBar from "./components/QueueNavBar";
import BottomNav from "./components/BottomNav";
import PageSkeleton from "./components/PageSkeleton";
import { hasRole, isReadOnly } from "./utils/roles";
import { BranchBanner } from "./components/BranchSwitcher";
import { isQueueHost } from "./utils/isQueueHost";
// LoginPage stays a static import — every visitor needs it before we know
// their role, so lazy-loading it would only add a network round trip.
import LoginPage from "./pages/LoginPage";

// Route-level code splitting: each page ships in its own chunk and is only
// downloaded when a user actually navigates to it — e.g. technician-only
// accounts never pull in the office-only pages below.
const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const StockAllPage = lazy(() => import("./pages/StockAllPage"));
const TechnicianScanPage = lazy(() => import("./pages/TechnicianScanPage"));
const TransactionHistoryPage = lazy(() => import("./pages/TransactionHistoryPage"));
const ReceiptSessionPage = lazy(() => import("./pages/ReceiptSessionPage"));
const ReceiptListPage = lazy(() => import("./pages/ReceiptListPage"));
const QuotationListPage = lazy(() => import("./pages/QuotationListPage"));
const AppointmentsPage = lazy(() => import("./pages/AppointmentsPage"));
const DeclinedSummaryPage = lazy(() => import("./pages/DeclinedSummaryPage"));
const PendingDeliveryPage = lazy(() => import("./pages/PendingDeliveryPage"));
const CustomerChannelPage = lazy(() => import("./pages/CustomerChannelPage"));
const CustomerManagementPage = lazy(() => import("./pages/CustomerManagementPage"));
const VehicleManagementPage = lazy(() => import("./pages/VehicleManagementPage"));
const ServiceItemManagementPage = lazy(() => import("./pages/ServiceItemManagementPage"));
const OwnerOverviewPage = lazy(() => import("./pages/OwnerOverviewPage"));
const ManagerPage = lazy(() => import("./pages/ManagerPage"));
const OwnerDashboardPage = lazy(() => import("./pages/OwnerDashboardPage"));
const StockCostsPage = lazy(() => import("./pages/StockCostsPage"));
const SuppliersPage = lazy(() => import("./pages/SuppliersPage"));
const DevConsole = lazy(() => import("./pages/dev/DevConsole"));
const WarrantyManagementPage = lazy(() => import("./pages/WarrantyManagementPage"));
const ClaimManagementPage = lazy(() => import("./pages/ClaimManagementPage"));
const ProductCostPage = lazy(() => import("./pages/ProductCostPage"));
const ModelPricesPage = lazy(() => import("./pages/ModelPricesPage"));
const DocHeaderSettingsPage = lazy(() => import("./pages/DocHeaderSettingsPage"));
const DailySalesSummaryPage = lazy(() => import("./pages/DailySalesSummaryPage"));
const VehicleServiceHistoryPage = lazy(() => import("./pages/VehicleServiceHistoryPage"));
const FollowUpPage = lazy(() => import("./pages/FollowUpPage"));
const ClaimDocumentsPage = lazy(() => import("./pages/ClaimDocumentsPage"));
const WarrantyRegisterPage = lazy(() => import("./pages/WarrantyRegisterPage"));
const PriceListPage = lazy(() => import("./pages/PriceListPage"));
const StockDeductionPage = lazy(() => import("./pages/StockDeductionPage"));
const StockUsageReportPage = lazy(() => import("./pages/StockUsageReportPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
// ระบบคิวรับรถ (subdomain queue.champ-powerspk.com แต่ route เดียวกันนี้ทำงาน
// บนโดเมนหลักได้ด้วย เพราะเป็น build เดียวกัน) BoardPage ไม่ต้องล็อกอิน — จอ TV
// ห้องรับรอง
const BoardPage = lazy(() => import("./pages/BoardPage"));
const JobBoardPage = lazy(() => import("./pages/JobBoardPage"));
const JobDetailPage = lazy(() => import("./pages/JobDetailPage"));
// หน้าลูกค้าติดตามสถานะรถของตัวเอง — สาธารณะ ไม่ต้องล็อกอิน (สแกน QR ที่พนักงาน
// พิมพ์/โชว์ให้ ดู track.routes.js ฝั่ง backend)
const TrackPage = lazy(() => import("./pages/TrackPage"));
const CustomerHistoryPage = lazy(() => import("./pages/CustomerHistoryPage"));
const VehicleHistoryPage = lazy(() => import("./pages/VehicleHistoryPage"));

// บัญชีดูได้อย่างเดียว: บอกไว้ทุกหน้า จะได้รู้ว่าทำไมกดแก้ไขแล้วไม่ผ่าน
function ReadOnlyBanner() {
  const { user } = useAuth();
  if (!isReadOnly(user)) return null;
  return <div className="readonly-banner" role="status">บัญชี: ดูข้อมูลได้อย่างเดียว แก้ไขไม่ได้</div>;
}

function Home() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  // subdomain คิวรับรถ ไม่มีแดชบอร์ด/หน้าสแกนของระบบหลักให้ไปต่อ (ดู
  // utils/isQueueHost.js) — พาไปหน้ารายการงานแทนเสมอไม่ว่า role ไหน
  if (isQueueHost()) return <Navigate to="/jobs" replace />;
  if (user.role === "owner") return <Navigate to="/owner" replace />;
  return hasRole(user, "office") ? (
    <Navigate to="/dashboard" replace />
  ) : (
    <Navigate to="/scan" replace />
  );
}

function AppRoutes() {
  const location = useLocation();
  // หน้ารายการอะไหล่บนแท็บเล็ตใช้เต็มจอแบบแอป — ซ่อนแถบเมนูบน/ล่างและ
  // ยกเลิก padding ของ .container เพื่อให้เนื้อหาเต็มพื้นที่จริง ๆ
  const isKiosk = location.pathname.startsWith("/board") || location.pathname.startsWith("/track");
  // subdomain คิวรับรถ ใช้แถบเมนูของตัวเอง (QueueNavBar) แทน NavBar เต็มรูปแบบ —
  // login/session เดียวกัน แค่ไม่โชว์เมนูสต๊อก/ใบเสนอราคา/รายงานที่ไม่เกี่ยวข้อง
  // (ดู utils/isQueueHost.js) BottomNav (แถบล่างมือถือ) ก็ผูกกับเมนูระบบหลัก
  // ล้วน ๆ เหมือนกัน จึงซ่อนไปด้วยแทนที่จะทำ mobile bar แยกอีกชุด
  const queueHost = isQueueHost();
  return (
    <>
      {!isKiosk && (queueHost ? <QueueNavBar /> : <><NavBar /><BranchBanner /><ReadOnlyBanner /></>)}
      <div className={isKiosk ? "" : "container"}>
        {/* key={pathname} forces this subtree to remount on navigation, which
            both retriggers the fade-in animation and gives Suspense a fresh
            boundary per page instead of reusing the previous page's. */}
        <div key={location.pathname} className="page-fade-in">
        <Suspense fallback={<PageSkeleton />}>
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
            path="/stock-all"
            element={
              <ProtectedRoute roles={["office"]}>
                <StockAllPage />
              </ProtectedRoute>
            }
          />
          <Route path="/stock-rack" element={<Navigate to="/stock-all" replace />} />
          <Route
            path="/history"
            element={
              <ProtectedRoute roles={["office"]} notFor={["sales"]}>
                <TransactionHistoryPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/scan"
            element={
              <ProtectedRoute roles={["office", "technician"]} notFor={["sales", "accountant"]}>
                <TechnicianScanPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/receipts"
            element={
              <ProtectedRoute roles={["office"]} notFor={["sales"]}>
                <ReceiptSessionPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/product-costs"
            element={
              <ProtectedRoute minRole="manager">
                <ProductCostPage />
              </ProtectedRoute>
            }
          />
          <Route path="/wing-arms" element={<Navigate to="/stock-all" replace />} />
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
            path="/customers/:id/history"
            element={
              <ProtectedRoute roles={["office"]}>
                <CustomerHistoryPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/vehicles/:id/history"
            element={
              <ProtectedRoute roles={["office"]}>
                <VehicleHistoryPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/service-items"
            element={
              <ProtectedRoute roles={["office"]} notFor={["accountant"]}>
                <ServiceItemManagementPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/warranties"
            element={
              <ProtectedRoute roles={["office"]} notFor={["accountant"]}>
                <WarrantyManagementPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/claims"
            element={
              <ProtectedRoute roles={["office"]}>
                <ClaimManagementPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/follow-ups"
            element={
              <ProtectedRoute roles={["office"]} notFor={["accountant"]}>
                <FollowUpPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/price-list"
            element={
              <ProtectedRoute roles={["office"]}>
                <PriceListPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/warranty-register"
            element={
              <ProtectedRoute roles={["office"]}>
                <WarrantyRegisterPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/claim-documents"
            element={
              <ProtectedRoute roles={["office"]}>
                <ClaimDocumentsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/manager"
            element={
              <ProtectedRoute minRole="manager">
                <ManagerPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/stock-costs"
            element={
              <ProtectedRoute roles={["office"]} notFor={["sales", "accountant"]}>
                <StockCostsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/suppliers"
            element={
              <ProtectedRoute minRole="manager" notFor={["accountant"]}>
                <SuppliersPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/owner"
            element={
              <ProtectedRoute minRole="owner">
                <OwnerDashboardPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/owner/overview"
            element={
              <ProtectedRoute minRole="owner">
                <OwnerOverviewPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/dev/*"
            element={
              <ProtectedRoute minRole="dev">
                <DevConsole />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings"
            element={
              <ProtectedRoute minRole="manager" notFor={["accountant"]}>
                <SettingsPage />
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
            path="/appointments"
            element={
              <ProtectedRoute roles={["office"]} notFor={["accountant"]}>
                <AppointmentsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/quotations/declined-summary"
            element={
              <ProtectedRoute roles={["office"]}>
                <DeclinedSummaryPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/customers/found-via"
            element={
              <ProtectedRoute roles={["office"]} notFor={["accountant"]}>
                <CustomerChannelPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/model-prices"
            element={
              <ProtectedRoute minRole="manager" notFor={["accountant"]}>
                <ModelPricesPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/doc-header"
            element={
              <ProtectedRoute minRole="manager">
                <DocHeaderSettingsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/daily-summary"
            element={
              <ProtectedRoute minRole="manager">
                <DailySalesSummaryPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/vehicle-history"
            element={
              <ProtectedRoute roles={["office"]}>
                <VehicleServiceHistoryPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/vehicle-history/:id"
            element={
              <ProtectedRoute roles={["office"]}>
                <VehicleServiceHistoryPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/stock-deduction"
            element={
              <ProtectedRoute roles={["office"]} notFor={["sales", "accountant"]}>
                <StockDeductionPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/stock-usage-report"
            element={
              <ProtectedRoute roles={["office"]} notFor={["sales"]}>
                <StockUsageReportPage />
              </ProtectedRoute>
            }
          />
          {/* /board, /track เปิดสาธารณะ ไม่ต้องล็อกอิน (จอ TV ห้องรับรอง, หน้าลูกค้า
              ติดตามสถานะรถ) — ตั้งใจไม่มี ProtectedRoute ห่อ ต่างจากทุก route อื่นในไฟล์นี้ */}
          <Route path="/board" element={<BoardPage />} />
          <Route path="/track" element={<TrackPage />} />
          <Route
            path="/jobs"
            element={
              <ProtectedRoute roles={["office"]}>
                <JobBoardPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/jobs/pending-delivery"
            element={
              <ProtectedRoute roles={["office"]}>
                <PendingDeliveryPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/jobs/:id"
            element={
              <ProtectedRoute roles={["office"]}>
                <JobDetailPage />
              </ProtectedRoute>
            }
          />
        </Routes>
        </Suspense>
        </div>
      </div>
      {!isKiosk && !queueHost && <BottomNav />}
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