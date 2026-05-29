const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// GET /api/appointments
// List all appointments
// PERFORMANCE BUG: Classic N+1 Query Issue!
// Instead of using Prisma's include, it loops through each appointment and executes
// individual select statements for Patient and Doctor details.
router.get('/', authenticate, async (req, res) => {
  try {
    const { doctorId, status, date } = req.query;

    const where = {};
    if (doctorId) where.doctorId = doctorId;
    if (status) where.status = status;
    
    // [FIXED]: Added date filtering to support "Daily Bookings" list
    if (date === 'today') {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date();
      endOfDay.setHours(23, 59, 59, 999);
      where.appointmentDate = {
        gte: startOfDay,
        lte: endOfDay
      };
    }

    // [FIXED]: Resolved N+1 query bottleneck by using Prisma's `include` feature.
    // This allows the database to fetch related Patient and Doctor records in a single optimized query via SQL JOINs.
    const detailedAppointments = await prisma.appointment.findMany({
      where,
      orderBy: { appointmentDate: 'asc' },
      include: {
        patient: {
          select: { id: true, name: true, phoneNumber: true, age: true, medicalHistory: true }
        },
        doctor: {
          select: { id: true, name: true, specialization: true }
        },
        queueTokens: true
      }
    });

    res.json({
      success: true,
      count: detailedAppointments.length,
      appointments: detailedAppointments,
    });
  } catch (error) {
    // [FIXED]: Stopped leaking raw error.message
    console.error('Appointments list error:', error);
    res.status(500).json({ error: 'Failed to retrieve appointments' });
  }
});

// POST /api/appointments
// Book an appointment
// [FIXED]: Added time-slot window duplicate check + schema-level @@unique constraint
router.post('/', authenticate, async (req, res) => {
  try {
    const { patientId, doctorId, appointmentDate, reason } = req.body;

    if (!patientId || !doctorId || !appointmentDate) {
      return res.status(400).json({ error: 'Patient, Doctor, and Appointment Date are required.' });
    }

    const appDate = new Date(appointmentDate);

    // [FIXED]: Check for existing bookings within a 30-minute window (not just exact millisecond)
    // This prevents near-duplicate bookings like 10:00:00 and 10:00:01.
    // The @@unique([doctorId, appointmentDate]) constraint in schema.prisma acts as the final safety net.
    const windowStart = new Date(appDate.getTime() - 30 * 60 * 1000);
    const windowEnd = new Date(appDate.getTime() + 30 * 60 * 1000);

    const existingBooking = await prisma.appointment.findFirst({
      where: {
        doctorId,
        appointmentDate: { gte: windowStart, lte: windowEnd },
        status: { not: 'CANCELLED' },
      },
    });

    if (existingBooking) {
      return res.status(400).json({
        error: 'Double booking blocked. Doctor already has an appointment within this time slot.',
      });
    }

    const appointment = await prisma.appointment.create({
      data: {
        patientId,
        doctorId,
        appointmentDate: appDate,
        reason: reason || '',
        status: 'PENDING',
      },
    });

    res.status(201).json({
      message: 'Appointment booked successfully',
      appointment,
    });
  } catch (error) {
    // [FIXED]: Stopped leaking raw error.message
    console.error('Appointment booking error:', error);
    res.status(500).json({ error: 'Failed to book appointment' });
  }
});

// PATCH /api/appointments/:id
// Update appointment status (COMPLETED, CANCELLED, etc.)
router.patch('/:id', authenticate, async (req, res) => {
  try {
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({ error: 'Status is required' });
    }

    const updated = await prisma.appointment.update({
      where: { id: req.params.id },
      data: { status },
    });

    res.json(updated);
  } catch (error) {
    // [FIXED]: Stopped leaking raw error.message
    console.error('Appointment update error:', error);
    res.status(500).json({ error: 'Failed to update appointment' });
  }
});

module.exports = router;
