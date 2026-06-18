import React, { useState } from 'react';
import client from '../api/client';
import QRScanner from '../components/QRScanner';
import ConfirmStockModal from '../components/ConfirmStockModal';

export default function TechnicianScanPage() {
  const [mode, setMode] = useState('IN'); // 'IN' or 'OUT'
  const [scanning, setScanning] = useState(true);
  const [rack, setRack] = useState(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');

  const handleScanResult = async (code) => {
    if (!scanning) return;
    setScanning(false);
    setErrorMsg('');
    setMessage(null);
    try {
      const res = await client.get(`/racks/lookup/${encodeURIComponent(code)}`);
      setRack(res.data);
    } catch (err) {
      setErrorMsg(err.response?.data?.error || 'ไม่พบรหัสรุ่นนี้ในระบบ');
      setScanning(true);
    }
  };

  const handleConfirm = async (qty) => {
    setLoading(true);
    setErrorMsg('');
    try {
      const endpoint = mode === 'IN' ? '/transactions/in' : '/transactions/out';
      const res = await client.post(endpoint, { model_code: rack.model_code, qty });
      setMessage(
        `${mode === 'IN' ? 'รับเข้า' : 'จ่ายออก'} "${rack.name}" (${rack.model_code}) จำนวน ${qty} สำเร็จ — คงเหลือ ${res.data.rack.stock_qty}`
      );
      setRack(null);
      setScanning(true);
    } catch (err) {
      setErrorMsg(err.response?.data?.error || 'ทำรายการไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    setRack(null);
    setScanning(true);
  };

  return (
    <div className="scan-page">
      <h2>สแกน QR Code</h2>
      <div className="mode-toggle">
        <button className={mode === 'IN' ? 'active' : ''} onClick={() => setMode('IN')}>
          รับเข้าสต็อก
        </button>
        <button className={mode === 'OUT' ? 'active' : ''} onClick={() => setMode('OUT')}>
          จ่ายออกจากสต็อก
        </button>
      </div>

      {message && <p className="success-text">{message}</p>}
      {errorMsg && <p className="error-text">{errorMsg}</p>}

      {scanning && <QRScanner active={scanning} onResult={handleScanResult} />}

      <ConfirmStockModal
        rack={rack}
        mode={mode}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
        loading={loading}
      />
    </div>
  );
}
