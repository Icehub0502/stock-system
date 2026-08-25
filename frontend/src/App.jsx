import React, { Suspense, lazy } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute";
import NavBar from "./components/NavBar";
import QueueNavBar from "./components/QueueNavBar";
import BottomNav from "./components/BottomNav";
import PageSkeleton from "./components/PageSkeleton";
import { isQueueHost } from "./utils/isQueueHost";
// LoginPage stays a static import — every visitor needs it before we know
// their role, so lazy-loading it would only add a network round trip.
import LoginPage from "./pages/LoginPage";

// Route-level code splitting: each page ships in its own chunk and is only
// downloaded when a user actually navigates to it — e.g. technician-only
// accounts never pull in the office-only pages below.
const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const StockRackPage = lazy(() => import("./pages/StockRackPage"));
const TechnicianScanPage = lazy(() => import("./pages/TechnicianScanPage"));
const TransactionHistoryPage = lazy(() => import("./pages/TransactionHistoryPage"));
const ReceiptSessionPage = lazy(() => import("./pages/ReceiptSessionPage"));
const ReceiptListPage = lazy(() => import("./pages/ReceiptListPage"));
const QuotationListPage = lazy(() => import("./pages/QuotationListPage"));
const AppointmentsPage = lazy(() => import("./pages/AppointmentsPage"));
const DeclinedSummaryPage = lazy(() => import("./pages/DeclinedSummaryPage"));
const CustomerChannelPage = lazy(() => import("./pages/CustomerChannelPage"));
const CustomerManagementPage = lazy(() => import("./pages/CustomerManagementPage"));
const VehicleManagementPage = lazy(() => import("./pages/VehicleManagementPage"));
const ServiceItemManagementPage = lazy(() => import("./pages/ServiceItemManagementPage"));
const WarrantyManagementPage = lazy(() => import("./pages/WarrantyManagementPage"));
const ProductCostPage = lazy(() => import("./pages/ProductCostPage"));
const QuotePartPriceManagementPage = lazy(() => import("./pages/QuotePartPriceManagementPage"));
const WingArmDashboard = lazy(() => import("./pages/WingArmDashboard"));
const DailySalesSummaryPage = lazy(() => import("./pages/DailySalesSummaryPage"));
const RepairNoticeListPage = lazy(() => import("./pages/RepairNoticeListPage"));
const RepairNoticePage = lazy(() => import("./pages/RepairNoticePage"));
const StockDeductionPage = lazy(() => import("./pages/StockDeductionPage"));
const StockUsageReportPage = lazy(() => import("./pages/StockUsageReportPage"));
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

function Home() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  // subdomain คิวรับรถ ไม่มีแดชบอร์ด/หน้าสแกนของระบบหลักให้ไปต่อ (ดู
  // utils/isQueueHost.js) — พาไปหน้ารายการงานแทนเสมอไม่ว่า role ไหน
  if (isQueueHost()) return <Navigate to="/jobs" replace />;
  return user.role === "office" ? (
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
      {!isKiosk && (queueHost ? <QueueNavBar /> : <NavBar />)}
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
            path="/appointments"
            element={
              <ProtectedRoute roles={["office"]}>
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
              <ProtectedRoute roles={["office"]}>
                <CustomerChannelPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/quote-parts"
            element={
              <ProtectedRoute roles={["office"]}>
                <QuotePartPriceManagementPage />
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
          <Route
            path="/stock-deduction"
            element={
              <ProtectedRoute roles={["office"]}>
                <StockDeductionPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/stock-usage-report"
            element={
              <ProtectedRoute roles={["office"]}>
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