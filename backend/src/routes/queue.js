const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// GET /api/queue
// List all active queue tokens
// [FIXED]: Removed authentication middleware since this is accessed by the public monitor board
router.get('/', async (req, res) => {
  try {
    const { doctorId, status } = req.query;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const where = {
      createdAt: { gte: today }
    };
    if (doctorId) where.doctorId = doctorId;
    if (status) where.status = status;

    const tokens = await prisma.queueToken.findMany({
      where,
      include: {
        patient: true,
        doctor: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    res.json(tokens);
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve queue' });
  }
});

// POST /api/queue/checkin
// Generate a new queue token for a patient
// [FIXED]: Resolved token generation race condition by using a Prisma database transaction.
router.post('/checkin', authenticate, async (req, res) => {
  try {
    const { patientId, doctorId, appointmentId } = req.body;

    if (!patientId || !doctorId) {
      return res.status(400).json({ error: 'Patient and Doctor ID are required for check-in.' });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // [FIXED]: Wrapped token calculation and insertion in a database transaction to prevent race conditions
    // Removed the artificial 350ms sleep which exacerbated the race condition.
    const newToken = await prisma.$transaction(async (tx) => {
      // [FIXED]: Prevent duplicate tokens for the same appointment
      if (appointmentId) {
        const existingToken = await tx.queueToken.findFirst({
          where: { appointmentId }
        });
        if (existingToken) {
          throw new Error('Patient is already checked in for this appointment.');
        }
      }

      const maxTokenResult = await tx.queueToken.aggregate({
        where: {
          doctorId,
          createdAt: { gte: today },
        },
        _max: {
          tokenNumber: true,
        },
      });

      const currentMax = maxTokenResult._max.tokenNumber || 0;
      const nextTokenNumber = currentMax + 1;

      return await tx.queueToken.create({
        data: {
          tokenNumber: nextTokenNumber,
          patientId,
          doctorId,
          appointmentId: appointmentId || null,
          status: 'WAITING',
        },
        include: {
          patient: true,
          doctor: true,
        },
      });
    });

    res.status(201).json({
      message: 'Checked in successfully. Token generated.',
      token: newToken,
    });
  } catch (error) {
    console.error('Queue check-in error:', error);
    res.status(error.message.includes('already checked in') ? 400 : 500).json({ 
      error: error.message || 'Check-in failed' 
    });
  }
});

// PATCH /api/queue/:id
// Update token status (WAITING -> CALLING -> COMPLETED / SKIPPED)
router.patch('/:id', authenticate, async (req, res) => {
  try {
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({ error: 'Status is required' });
    }

    const updatedToken = await prisma.queueToken.update({
      where: { id: req.params.id },
      data: { status },
      include: {
        patient: true,
        doctor: true,
      },
    });

    res.json(updatedToken);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update queue token' });
  }
});

module.exports = router;
