const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  console.log('Starting seed...');

  const password = await bcrypt.hash('password123', 10);

  // 1. Seed Users (idempotent via upsert)
  const admin = await prisma.user.upsert({
    where: { email: 'admin@haqms.com' },
    update: {},
    create: {
      email: 'admin@haqms.com',
      password,
      name: 'System Admin',
      role: 'ADMIN',
    },
  });

  const receptionist = await prisma.user.upsert({
    where: { email: 'reception1@haqms.com' },
    update: {},
    create: {
      email: 'reception1@haqms.com',
      password,
      name: 'Front Desk Receptionist',
      role: 'RECEPTIONIST',
    },
  });

  const doctorUser1 = await prisma.user.upsert({
    where: { email: 'doctor1@haqms.com' },
    update: {},
    create: {
      email: 'doctor1@haqms.com',
      password,
      name: 'Dr. Gregory House',
      role: 'DOCTOR',
    },
  });

  const doctorUser2 = await prisma.user.upsert({
    where: { email: 'doctor2@haqms.com' },
    update: {},
    create: {
      email: 'doctor2@haqms.com',
      password,
      name: 'Dr. Stephen Strange',
      role: 'DOCTOR',
    },
  });

  // 2. Seed Doctors — idempotent via upsert on userId (unique constraint)
  // This links each Doctor profile to its User account, preventing duplicates
  // on repeated seed runs (e.g., on every deploy).
  const doctor1 = await prisma.doctor.upsert({
    where: { userId: doctorUser1.id },
    update: {
      name: 'Dr. Gregory House',
      specialization: 'Diagnostic Medicine',
      department: 'Diagnostics',
      consultationFee: 500,
      experience: 15,
    },
    create: {
      userId: doctorUser1.id,
      name: 'Dr. Gregory House',
      specialization: 'Diagnostic Medicine',
      department: 'Diagnostics',
      consultationFee: 500,
      experience: 15,
    },
  });

  const doctor2 = await prisma.doctor.upsert({
    where: { userId: doctorUser2.id },
    update: {
      name: 'Dr. Stephen Strange',
      specialization: 'Neurosurgery',
      department: 'Surgery',
      consultationFee: 1200,
      experience: 20,
    },
    create: {
      userId: doctorUser2.id,
      name: 'Dr. Stephen Strange',
      specialization: 'Neurosurgery',
      department: 'Surgery',
      consultationFee: 1200,
      experience: 20,
    },
  });

  // 3. Seed Patients (idempotent via upsert)
  const patient1 = await prisma.patient.upsert({
    where: { email: 'clark@kent.com' },
    update: {},
    create: {
      name: 'Clark Kent',
      email: 'clark@kent.com',
      phoneNumber: '555-0101',
      age: 33,
      gender: 'Male',
      medicalHistory: null, // Intentionally null to test frontend null-safety
    },
  });

  const patient2 = await prisma.patient.upsert({
    where: { email: 'bruce@wayne.com' },
    update: {},
    create: {
      name: 'Bruce Wayne',
      email: 'bruce@wayne.com',
      phoneNumber: '555-0202',
      age: 40,
      gender: 'Male',
      medicalHistory: null, // Intentionally null to test frontend null-safety
    },
  });

  const patient3 = await prisma.patient.upsert({
    where: { email: 'peter@parker.com' },
    update: {},
    create: {
      name: 'Peter Parker',
      email: 'peter@parker.com',
      phoneNumber: '555-0303',
      age: 21,
      gender: 'Male',
      medicalHistory: 'Spider bite anomaly. High radiation.',
    },
  });

  // 4. Seed Appointments (only if they don't already exist for this slot)
  // Use upsert on the unique constraint [doctorId, appointmentDate]
  const apptDate1 = new Date(new Date().setHours(10, 0, 0, 0));
  const apptDate2 = new Date(new Date().setHours(11, 0, 0, 0));

  const appointment1 = await prisma.appointment.upsert({
    where: { doctorId_appointmentDate: { doctorId: doctor1.id, appointmentDate: apptDate1 } },
    update: {},
    create: {
      patientId: patient1.id,
      doctorId: doctor1.id,
      appointmentDate: apptDate1,
      reason: 'Regular Checkup',
      status: 'PENDING',
    },
  });

  const appointment2 = await prisma.appointment.upsert({
    where: { doctorId_appointmentDate: { doctorId: doctor1.id, appointmentDate: apptDate2 } },
    update: {},
    create: {
      patientId: patient3.id,
      doctorId: doctor1.id,
      appointmentDate: apptDate2,
      reason: 'Web shooters acting up',
      status: 'PENDING',
    },
  });

  console.log('Seeding finished.');
  console.log(`  Users: admin, receptionist, doctor1 (${doctorUser1.email}), doctor2 (${doctorUser2.email})`);
  console.log(`  Doctors: ${doctor1.name} (userId: ${doctor1.userId}), ${doctor2.name} (userId: ${doctor2.userId})`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
