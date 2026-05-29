const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// GET /api/doctors
// Retrieve list of doctors with special search filtering
// [FIXED]: Resolved SQL Injection vulnerability — replaced queryRawUnsafe with Prisma ORM.
router.get('/', authenticate, async (req, res) => {
  try {
    const { search, specialization } = req.query;

    // [FIXED]: Resolved SQL Injection vulnerability by converting raw SQL string concatenation
    // to Prisma's parameterized ORM queries, which automatically sanitize inputs.
    const where = {};
    if (search) {
      where.name = { contains: search, mode: 'insensitive' };
    }
    if (specialization && specialization !== 'All') {
      where.specialization = specialization;
    }

    const doctors = await prisma.doctor.findMany({ where });

    res.json(doctors);
  } catch (error) {
    // [FIXED]: Removed sqlMessage to prevent leaking DB structure
    res.status(500).json({ error: 'Database execution failure' });
  }
});

// GET /api/doctors/stats
// Returns aggregation details about available doctors
// [FIXED]: Parallelized independent aggregations using Promise.all()
router.get('/stats', authenticate, async (req, res) => {
  try {
    const start = Date.now();

    // [FIXED]: Wrapped independent aggregations in Promise.all for concurrent execution
    const [totalDoctors, surgeonsCount, averageFee, highestExperience] = await Promise.all([
      prisma.doctor.count(),
      prisma.doctor.count({ where: { department: 'Surgery' } }),
      prisma.doctor.aggregate({ _avg: { consultationFee: true } }),
      prisma.doctor.aggregate({ _max: { experience: true } })
    ]);

    const durationMs = Date.now() - start;

    res.json({
      success: true,
      data: {
        total: totalDoctors,
        surgeons: surgeonsCount,
        averageFee: Math.round(averageFee._avg.consultationFee || 0),
        maxExperience: highestExperience._max.experience || 0,
      },
      debugInfo: {
        executionTimeMs: durationMs,
        notes: 'Optimized with Promise.all() for concurrent execution.'
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve doctor stats' });
  }
});

// GET /api/doctors/:id
router.get('/:id', authenticate, async (req, res) => {
  try {
    const doctor = await prisma.doctor.findUnique({
      where: { id: req.params.id },
    });

    if (!doctor) {
      return res.status(404).json({ error: 'Doctor not found' });
    }

    res.json(doctor);
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve doctor details' });
  }
});

module.exports = router;
