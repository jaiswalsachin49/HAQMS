const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function healDatabase() {
  console.log('[DB-HEALER] Starting database diagnostics and self-healing...');
  try {
    // 1. Find all doctors
    const doctors = await prisma.doctor.findMany({
      include: {
        appointments: true,
        queueTokens: true,
      }
    });

    // 2. Group by name to identify duplicates
    const nameToDocs = {};
    for (const doc of doctors) {
      if (!nameToDocs[doc.name]) {
        nameToDocs[doc.name] = [];
      }
      nameToDocs[doc.name].push(doc);
    }

    for (const [name, docList] of Object.entries(nameToDocs)) {
      if (docList.length > 1) {
        console.log(`[DB-HEALER] Found duplicate doctors for: "${name}" (${docList.length} records)`);

        // We need to select the canonical one.
        // Rule: Prefer the one that has a userId assigned. If none, prefer the one with the most appointments or just the first one.
        let canonical = docList.find(d => d.userId !== null && d.userId !== undefined);
        if (!canonical) {
          // If none have a userId, select the one with most appointments/tokens to minimize reassignments, or first one
          canonical = docList.sort((a, b) => 
            (b.appointments.length + b.queueTokens.length) - (a.appointments.length + a.queueTokens.length)
          )[0];
        }

        console.log(`[DB-HEALER] Canonical doctor chosen: "${canonical.name}" (ID: ${canonical.id}, userId: ${canonical.userId})`);

        // Get duplicate doctors to delete
        const duplicates = docList.filter(d => d.id !== canonical.id);

        for (const duplicate of duplicates) {
          console.log(`[DB-HEALER] Merging duplicate doctor (ID: ${duplicate.id}) into canonical (ID: ${canonical.id})...`);
          
          // Reassign appointments
          if (duplicate.appointments.length > 0) {
            const apptUpdate = await prisma.appointment.updateMany({
              where: { doctorId: duplicate.id },
              data: { doctorId: canonical.id }
            });
            console.log(`[DB-HEALER] Reassigned ${apptUpdate.count} appointments.`);
          }

          // Reassign queue tokens
          if (duplicate.queueTokens.length > 0) {
            const tokenUpdate = await prisma.queueToken.updateMany({
              where: { doctorId: duplicate.id },
              data: { doctorId: canonical.id }
            });
            console.log(`[DB-HEALER] Reassigned ${tokenUpdate.count} queue tokens.`);
          }

          // Delete the duplicate doctor record
          await prisma.doctor.delete({
            where: { id: duplicate.id }
          });
          console.log(`[DB-HEALER] Deleted duplicate doctor record: ${duplicate.id}`);
        }
      }
    }

    // 3. Make sure the canonical doctors are linked to the correct User account via userId
    // Let's get all active doctors and all users with role 'DOCTOR'
    const activeDoctors = await prisma.doctor.findMany();
    const doctorUsers = await prisma.user.findMany({
      where: { role: 'DOCTOR' }
    });

    for (const doc of activeDoctors) {
      if (!doc.userId) {
        // Try to match a User by name
        let matchingUser = doctorUsers.find(u => u.name.toLowerCase() === doc.name.toLowerCase());
        
        if (matchingUser) {
          console.log(`[DB-HEALER] Linking Doctor "${doc.name}" (ID: ${doc.id}) to User "${matchingUser.name}" (ID: ${matchingUser.id})`);
          await prisma.doctor.update({
            where: { id: doc.id },
            data: { userId: matchingUser.id }
          });
        } else {
          console.warn(`[DB-HEALER] No matching User found for Doctor "${doc.name}".`);
        }
      }
    }

    console.log('[DB-HEALER] Database diagnostics and self-healing completed successfully.');
  } catch (error) {
    console.error('[DB-HEALER] Critical error during database healing:', error);
  } finally {
    await prisma.$disconnect();
  }
}

module.exports = healDatabase;
