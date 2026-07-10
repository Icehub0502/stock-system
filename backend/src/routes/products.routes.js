const express = require('express');
const { authenticate } = require('../middleware/auth');
const { getConnection } = require('../db/pool');

const router = express.Router();

// GET all products with search
router.get('/', authenticate, async (req, res) => {
  try {
    const { search } = req.query;
    const pool = getConnection();

    let query = 'SELECT id, product_name, description FROM products ORDER BY product_name ASC';
    const params = [];

    if (search) {
      query = 'SELECT id, product_name, description FROM products WHERE product_name LIKE ? ORDER BY product_name ASC';
      params.push(`%${search}%`);
    }

    const [rows] = await pool.query(query, params);
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('Get products error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch products' });
  }
});

// GET single product
router.get('/:id', authenticate, async (req, res) => {
  try {
    const pool = getConnection();
    const [rows] = await pool.query('SELECT id, product_name, description FROM products WHERE id = ?', [req.params.id]);
    
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('Get product error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch product' });
  }
});

// POST create product
router.post('/', authenticate, async (req, res) => {
  try {
    const { product_name, description } = req.body;

    if (!product_name) {
      return res.status(400).json({ success: false, message: 'Product name is required' });
    }

    const pool = getConnection();

    // Check if product already exists
    const [existing] = await pool.query('SELECT id FROM products WHERE product_name = ?', [product_name]);
    if (existing.length > 0) {
      return res.status(400).json({ success: false, message: 'Product already exists' });
    }

    const [result] = await pool.query(
      'INSERT INTO products (product_name, description) VALUES (?, ?)',
      [product_name, description || null]
    );

    res.status(201).json({
      success: true,
      message: 'Product created successfully',
      data: {
        id: result.insertId,
        product_name,
        description: description || null
      }
    });
  } catch (err) {
    console.error('Create product error:', err);
    res.status(500).json({ success: false, message: 'Failed to create product' });
  }
});

// PUT update product
router.put('/:id', authenticate, async (req, res) => {
  try {
    const { product_name, description } = req.body;
    const pool = getConnection();

    const [existing] = await pool.query('SELECT id FROM products WHERE id = ?', [req.params.id]);
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    await pool.query(
      'UPDATE products SET product_name = ?, description = ? WHERE id = ?',
      [product_name, description || null, req.params.id]
    );

    res.json({ success: true, message: 'Product updated successfully' });
  } catch (err) {
    console.error('Update product error:', err);
    res.status(500).json({ success: false, message: 'Failed to update product' });
  }
});

// DELETE product
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const pool = getConnection();

    const [existing] = await pool.query('SELECT id FROM products WHERE id = ?', [req.params.id]);
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    await pool.query('DELETE FROM products WHERE id = ?', [req.params.id]);

    res.json({ success: true, message: 'Product deleted successfully' });
  } catch (err) {
    console.error('Delete product error:', err);
    res.status(500).json({ success: false, message: 'Failed to delete product' });
  }
});

module.exports = router;
