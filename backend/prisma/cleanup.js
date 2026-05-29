const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function cleanup() {
  console.log('Cleaning up duplicate doctors...');
  
  // Find all doctors
  const doctors = await prisma.doctor.findMany();
  
  // Group by name
  const nameToDocs = {};
  for (const doc of doctors) {
    if (!nameToDocs[doc.name]) {
      nameToDocs[doc.name] = [];
    }
    nameToDocs[doc.name].push(doc);
  }
  
  for (const [name, docs] of Object.entries(nameToDocs)) {
    if (docs.length > 1) {
      console.log(`Found ${docs.length} doctors named ${name}. Keeping the first one and deleting the rest.`);
      // Keep the first one, delete the rest
      const docsToDelete = docs.slice(1);
      for (const doc of docsToDelete) {
        // First delete their related records (QueueTokens and Appointments)
        await prisma.queueToken.deleteMany({ where: { doctorId: doc.id } });
        await prisma.appointment.deleteMany({ where: { doctorId: doc.id } });
        await prisma.doctor.delete({ where: { id: doc.id } });
        console.log(`Deleted duplicate doctor: ${doc.id}`);
      }
    }
  }
  
  console.log('Cleanup complete.');
}

cleanup().catch(console.error).finally(() => prisma.$disconnect());
