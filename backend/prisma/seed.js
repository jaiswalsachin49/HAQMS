const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  console.log('Starting seed...');

  const password = await bcrypt.hash('password123', 10);

  // 1. Seed Users
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

  const doctorUser = await prisma.user.upsert({
    where: { email: 'doctor1@haqms.com' },
    update: {},
    create: {
      email: 'doctor1@haqms.com',
      password,
      name: 'Dr. Gregory House',
      role: 'DOCTOR',
    },
  });

  // 2. Seed Doctors
  const doctor1 = await prisma.doctor.create({
    data: {
      name: 'Dr. Gregory House',
      specialization: 'Diagnostic Medicine',
      department: 'Diagnostics',
      consultationFee: 500,
      experience: 15,
    },
  });

  const doctor2 = await prisma.doctor.create({
    data: {
      name: 'Dr. Stephen Strange',
      specialization: 'Neurosurgery',
      department: 'Surgery',
      consultationFee: 1200,
      experience: 20,
    },
  });

  // 3. Seed Patients (Include Bruce Wayne and Clark Kent with NULL medical history to intentionally cause crashes)
  const patient1 = await prisma.patient.upsert({
    where: { email: 'clark@kent.com' },
    update: {},
    create: {
      name: 'Clark Kent',
      email: 'clark@kent.com',
      phoneNumber: '555-0101',
      age: 33,
      gender: 'Male',
      medicalHistory: null, // Intentionally null to crash frontend
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
      medicalHistory: null, // Intentionally null to crash frontend
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

  // 4. Seed Appointments
  const appointment1 = await prisma.appointment.create({
    data: {
      patientId: patient1.id,
      doctorId: doctor1.id,
      appointmentDate: new Date(new Date().setHours(10, 0, 0, 0)),
      reason: 'Regular Checkup',
      status: 'PENDING',
    },
  });
  
  const appointment2 = await prisma.appointment.create({
    data: {
      patientId: patient3.id,
      doctorId: doctor1.id,
      appointmentDate: new Date(new Date().setHours(11, 0, 0, 0)),
      reason: 'Web shooters acting up',
      status: 'PENDING',
    },
  });

  // 5. Seed Queue Tokens
  await prisma.queueToken.create({
    data: {
      tokenNumber: 1,
      patientId: patient1.id,
      doctorId: doctor1.id,
      appointmentId: appointment1.id,
      status: 'WAITING',
    },
  });
  
  await prisma.queueToken.create({
    data: {
      tokenNumber: 2,
      patientId: patient3.id,
      doctorId: doctor1.id,
      appointmentId: appointment2.id,
      status: 'WAITING',
    },
  });


  console.log('Seeding finished.');
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
