const express = require('express');
const requireAdminAuth = require('../middleware/requireAdminAuth');
const {
  listMessages,
  getMessageById,
  markRead,
  archiveMessage,
  softDeleteMessage,
  restoreMessage,
} = require('../models/contactMessages');

const router = express.Router();

router.use(requireAdminAuth);

const VALID_STATUSES = ['unread', 'read', 'archived', 'deleted'];

function backTo(req, res) {
  res.redirect(req.get('Referer') || '/admin/messages');
}

router.get('/', (req, res) => {
  res.redirect('/admin/messages');
});

router.get('/messages', async (req, res, next) => {
  const status = VALID_STATUSES.includes(req.query.status) ? req.query.status : 'unread';

  try {
    const messages = await listMessages({ status });
    res.render('admin/messages', { messages, status });
  } catch (err) {
    next(err);
  }
});

router.get('/messages/:id', async (req, res, next) => {
  try {
    const message = await getMessageById(req.params.id);

    if (!message) {
      return res.status(404).render('errors/404');
    }

    res.render('admin/message-detail', { message });
  } catch (err) {
    next(err);
  }
});

router.post('/messages/:id/read', async (req, res, next) => {
  try {
    await markRead(req.params.id);
    backTo(req, res);
  } catch (err) {
    next(err);
  }
});

router.post('/messages/:id/archive', async (req, res, next) => {
  try {
    await archiveMessage(req.params.id);
    backTo(req, res);
  } catch (err) {
    next(err);
  }
});

router.post('/messages/:id/delete', async (req, res, next) => {
  try {
    await softDeleteMessage(req.params.id);
    backTo(req, res);
  } catch (err) {
    next(err);
  }
});

router.post('/messages/:id/restore', async (req, res, next) => {
  try {
    await restoreMessage(req.params.id);
    backTo(req, res);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
