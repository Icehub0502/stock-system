import React, { useState } from "react";
import client from "../api/client";

export default function CustomerFormModal({ onClose, onSuccess }) {
  const [formData, setFormData] = useState({
    customer_name: "",
    phone: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await client.post('/quotation-customers', formData);
      onSuccess();
    } catch (err) {
      setError(err.response?.data?.error || "เกิดข้อผิดพลาด");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card medium" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>เพิ่มลูกค้าใหม่</h2>
          <button className="btn-close" onClick={onClose}>✕</button>
        </div>

        {error && <div className="error-message">{error}</div>}

        <form onSubmit={handleSubmit} className="modal-form">
          <div className="form-group">
            <label>ชื่อลูกค้า *</label>
            <input
              type="text"
              name="customer_name"
              value={formData.customer_name}
              onChange={handleInputChange}
              placeholder="กรอกชื่อลูกค้า"
              required
            />
          </div>

          <div className="form-group">
            <label>เบอร์โทรศัพท์</label>
            <input
              type="tel"
              name="phone"
              value={formData.phone}
              onChange={handleInputChange}
              placeholder="098-xxx-xxxx"
            />
          </div>

          <div className="modal-footer">
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? "กำลังบันทึก..." : "เพิ่มลูกค้า"}
            </button>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              ยกเลิก
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
