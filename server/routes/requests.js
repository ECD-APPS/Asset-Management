const express = require('express');
const router = express.Router();
const Request = require('../models/Request');
const Store = require('../models/Store');
const ExcelJS = require('exceljs');
const { protect, admin, adminOrViewer, restrictViewer } = require('../middleware/authMiddleware');
const sendEmail = require('../utils/sendEmail');
const escapeRegex = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const getScopedStoreId = (req) => String(req.activeStore || req.user?.assignedStore || '').trim();
const getStoreIds = async (storeId) => {
  if (!storeId) return [];
  const children = await Store.find({ parentStore: storeId }).select('_id').lean();
  return [storeId, ...children.map((c) => c._id)];
};
const canAccessRequest = async (req, requestStoreId) => {
  if (req.user?.role === 'Super Admin') return true;
  const scopedStoreId = getScopedStoreId(req);
  if (!scopedStoreId) return false;
  const storeIds = await getStoreIds(scopedStoreId);
  const allowed = new Set(storeIds.map((id) => String(id)));
  return allowed.has(String(requestStoreId || ''));
};

async function applyViewerStoreFilter(req, filter) {
  if (req.user?.role !== 'Viewer') {
    if (req.activeStore) {
      filter.store = req.activeStore;
    }
    return;
  }

  const scope = req.user.accessScope || 'All';
  if (scope === 'All') {
    if (req.activeStore) {
      filter.store = req.activeStore;
    }
    return;
  }

  const mainStores = await Store.find({
    isMainStore: true,
    name: { $regex: scope, $options: 'i' }
  }).select('_id').lean();

  const mainIds = mainStores.map(s => s._id);
  const childStores = await Store.find({ parentStore: { $in: mainIds } }).select('_id').lean();
  const allowedIds = [...mainIds, ...childStores.map(s => s._id)];

  if (req.activeStore) {
    const isAllowed = allowedIds.some(id => String(id) === String(req.activeStore));
    filter.store = isAllowed ? req.activeStore : { $in: [] };
  } else {
    filter.store = { $in: allowedIds };
  }
}

router.post('/', protect, restrictViewer, async (req, res) => {
  try {
    const { item_name, quantity, description, store } = req.body;
    const safeItemName = String(item_name || '').trim();
    const safeDescription = String(description || '').trim();
    const safeQuantity = Math.max(1, parseInt(quantity, 10) || 1);
    if (!safeItemName) {
      return res.status(400).json({ message: 'Item name is required' });
    }

    let targetStoreId = null;
    if (req.user?.role === 'Super Admin') {
      targetStoreId = store || req.activeStore || null;
    } else {
      targetStoreId = req.activeStore || req.user?.assignedStore || null;
    }
    if (!targetStoreId) {
      return res.status(400).json({ message: 'Store context is required for request submission' });
    }

    const request = await Request.create({
      item_name: safeItemName,
      quantity: safeQuantity,
      description: safeDescription,
      requester: req.user._id,
      store: targetStoreId
    });

    // Notify admin on new request
    try {
      const adminRecipient = process.env.SMTP_EMAIL;
      await sendEmail({
        email: adminRecipient,
        subject: `New Technician Request - ${req.user?.name || 'Unknown'}`,
        html: `
          <div style="font-family: system-ui, Arial, sans-serif">
            <h2>New Request Submitted</h2>
            <p><strong>Technician:</strong> ${req.user?.name || '-'} (${req.user?.email || '-'})</p>
            <p><strong>Item:</strong> ${safeItemName}</p>
            <p><strong>Quantity:</strong> ${safeQuantity}</p>
            <p><strong>Description:</strong> ${safeDescription || '-'}</p>
            <p><strong>Store:</strong> ${targetStoreId || '-'}</p>
            <p style="color: #6b7280; font-size: 12px">Expo Stores</p>
          </div>
        `
      });
    } catch (mailErr) {
      // Silent fail, do not block API
    }

    res.status(201).json(request);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.get('/', protect, adminOrViewer, async (req, res) => {
  try {
    const { status, q } = req.query;
    const filter = {};
    if (status) filter.status = status;
    await applyViewerStoreFilter(req, filter);
    
    let requests = await Request.find(filter)
      .populate('requester', 'name email phone username')
      .populate('store', 'name')
      .sort({ createdAt: -1 })
      .lean();
    if (q) {
      const qSafe = String(q).trim().slice(0, 120);
      const rx = new RegExp(escapeRegex(qSafe), 'i');
      requests = requests.filter(r =>
        rx.test(r.requester?.name || '') ||
        rx.test(r.requester?.email || '') ||
        rx.test(r.requester?.phone || '') ||
        rx.test(r.requester?.username || '')
      );
    }
    res.json(requests);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.put('/:id', protect, admin, async (req, res) => {
  try {
    const request = await Request.findById(req.params.id).populate('requester', 'name email');
    if (!request) return res.status(404).json({ message: 'Request not found' });
    
    // Isolation Check
    if (!(await canAccessRequest(req, request.store))) {
      return res.status(404).json({ message: 'Request not found' });
    }

    const allowedStatuses = new Set(['Pending', 'Approved', 'Ordered', 'Rejected']);
    const nextStatus = String(req.body?.status || request.status);
    if (!allowedStatuses.has(nextStatus)) {
      return res.status(400).json({ message: 'Invalid request status' });
    }
    request.status = nextStatus;
    await request.save();

    // Notify technician on status change
    if (request.requester?.email) {
      try {
        await sendEmail({
          email: request.requester.email,
          subject: `Your Request Status Updated: ${request.status}`,
          html: `
            <div style="font-family: system-ui, Arial, sans-serif">
              <h2>Request Status Updated</h2>
              <p><strong>Item:</strong> ${request.item_name}</p>
              <p><strong>Quantity:</strong> ${request.quantity}</p>
              <p><strong>New Status:</strong> ${request.status}</p>
              <p style="color: #6b7280; font-size: 12px">Expo Stores</p>
            </div>
          `
        });
      } catch (mailErr) {
        // Silent fail
      }
    }

    res.json(request);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

module.exports = router;

// Export requests to Excel
router.get('/export', protect, adminOrViewer, async (req, res) => {
  try {
    const { status, q } = req.query;
    const filter = {};
    if (status) filter.status = status;
    await applyViewerStoreFilter(req, filter);
    
    let requests = await Request.find(filter)
      .populate('requester', 'name email phone username')
      .populate('store', 'name')
      .sort({ updatedAt: -1 })
      .lean();
    if (q) {
      const qSafe = String(q).trim().slice(0, 120);
      const rx = new RegExp(escapeRegex(qSafe), 'i');
      requests = requests.filter(r =>
        rx.test(r.requester?.name || '') ||
        rx.test(r.requester?.email || '') ||
        rx.test(r.requester?.phone || '') ||
        rx.test(r.requester?.username || '')
      );
    }
    const header = ['ITEM','QUANTITY','DESCRIPTION','STATUS','STORE','TECHNICIAN NAME','TECHNICIAN EMAIL','TECHNICIAN PHONE','TECHNICIAN USERNAME','CREATED AT','UPDATED AT'];
    const rows = requests.map(r => ([
      r.item_name,
      r.quantity,
      r.description || '',
      r.status,
      r.store ? r.store.name : '',
      r.requester ? r.requester.name : '',
      r.requester ? r.requester.email : '',
      r.requester ? (r.requester.phone || '') : '',
      r.requester ? (r.requester.username || '') : '',
      r.createdAt,
      r.updatedAt
    ]));
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('REQUESTS');
    ws.addRows([header, ...rows]);
    ws.columns = [{ width: 24 },{ width: 10 },{ width: 32 },{ width: 12 },{ width: 16 },{ width: 22 },{ width: 26 },{ width: 18 },{ width: 18 },{ width: 22 },{ width: 22 }];
    ws.autoFilter = 'A1:K1';
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    res.setHeader('Content-Disposition', 'attachment; filename=REQUESTS_EXPORT.xlsx');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Technician: list own requests
router.get('/mine', protect, async (req, res) => {
  try {
    const filter = { requester: req.user._id };
    if (req.activeStore) {
      filter.store = req.activeStore;
    }
    const my = await Request.find(filter)
      .populate('store', 'name')
      .sort({ updatedAt: -1 })
      .lean();
    res.json(my);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});
