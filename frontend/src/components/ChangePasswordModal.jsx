import React, { useState } from "react";
import client from "../api/client";

export default function ChangePasswordModal({ onClose }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (newPassword.length < 4) {
      setError("รหัสผ่านใหม่ต้องมีอย่างน้อย 4 ตัวอักษร");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("รหัสผ่านใหม่และยืนยันรหัสผ่านไม่ตรงกัน");
      return;
    }
    setSaving(true);
    try {
      await client.put("/auth/change-password", {
        current_password: currentPassword,
        new_password: newPassword,
      });
      setSuccess(true);
    } catch (err) {
      setError(err.response?.data?.error || "เปลี่ยนรหัสผ่านไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" style={{ maxWidth: 380 }} onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">เปลี่ยนรหัสผ่าน</h3>

        {success ? (
          <>
            <p className="success-text">เปลี่ยนรหัสผ่านสำเร็จ</p>
            <div className="modal-actions">
              <button type="button" className="btn-primary" onClick={onClose}>ปิด</button>
            </div>
          </>
        ) : (
          <form onSubmit={handleSubmit} className="modal-form">
            <label>รหัสผ่านเดิม</label>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoFocus
              required
            />
            <label>รหัสผ่านใหม่</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
            />
            <label>ยืนยันรหัสผ่านใหม่</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />

            {error && <p className="error-text">{error}</p>}

            <div className="modal-actions">
              <button type="submit" className="btn-primary" disabled={saving}>
                {saving ? "กำลังบันทึก..." : "บันทึกรหัสผ่านใหม่"}
              </button>
              <button type="button" onClick={onClose}>ยกเลิก</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
