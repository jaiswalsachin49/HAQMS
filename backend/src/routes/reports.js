const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// GET /api/reports/doctor-stats
// Highly inefficient nested loop aggregate reporting for admin/receptionists dashboard
// PERFORMANCE BUG: Performs multiple nested DB queries inside a loop for every doctor.
// Runs sequentially, blocking/scaling terrible with doctors count.
router.get('/doctor-stats', authenticate, async (req, res) => {
  try {
    const start = Date.now();

    // 1. Fetch all doctors
    const doctors = await prisma.doctor.findMany();
    // [FIXED]: Replaced sequential database loop with concurrent Promise.all execution.
    // Removed the deliberate artificial wait that was blocking the thread.
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const reportPromises = doctors.map(async (doc) => {
      const [totalAppointments, completedAppointments, cancelledAppointments, queueTokensCount] = await Promise.all([
        prisma.appointment.count({ where: { doctorId: doc.id } }),
        prisma.appointment.count({ where: { doctorId: doc.id, status: 'COMPLETED' } }),
        prisma.appointment.count({ where: { doctorId: doc.id, status: 'CANCELLED' } }),
        prisma.queueToken.count({ where: { doctorId: doc.id, createdAt: { gte: today } } })
      ]);

      const revenue = completedAppointments * doc.consultationFee;

      return {
        id: doc.id,
        name: doc.name,
        specialization: doc.specialization,
        department: doc.department,
        totalAppointments,
        completedAppointments,
        cancelledAppointments,
        todayQueueSize: queueTokensCount,
        revenue,
      };
    });

    const reportData = await Promise.all(reportPromises);

    const durationMs = Date.now() - start;

    res.json({
      success: true,
      timeTakenMs: durationMs,
      data: reportData,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate report', details: error.message });
  }
});

module.exports = router;
