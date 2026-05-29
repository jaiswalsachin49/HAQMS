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
          
          // Reassign appointments one by one to handle collisions safely
          if (duplicate.appointments.length > 0) {
            for (const appt of duplicate.appointments) {
              // Check if canonical doctor already has an appointment at this exact date/time
              const collision = await prisma.appointment.findFirst({
                where: {
                  doctorId: canonical.id,
                  appointmentDate: appt.appointmentDate
                }
              });

              if (collision) {
                console.log(`[DB-HEALER] Collision found for appointment at ${appt.appointmentDate}. Consolidating associated queue tokens...`);
                
                // Reassign queue tokens from the duplicate appointment to the collision appointment
                const duplicateTokens = await prisma.queueToken.findMany({
                  where: { appointmentId: appt.id }
                });

                for (const token of duplicateTokens) {
                  // Check if the collision appointment already has a queue token for this tokenNumber
                  const tokenCollision = await prisma.queueToken.findFirst({
                    where: {
                      appointmentId: collision.id,
                      tokenNumber: token.tokenNumber
                    }
                  });

                  if (tokenCollision) {
                    // Redundant token, delete it
                    await prisma.queueToken.delete({ where: { id: token.id } });
                  } else {
                    // Reassign the token to the collision appointment and canonical doctor
                    await prisma.queueToken.update({
                      where: { id: token.id },
                      data: {
                        appointmentId: collision.id,
                        doctorId: canonical.id
                      }
                    });
                  }
                }

                // Delete the duplicate appointment since it's redundant
                await prisma.appointment.delete({
                  where: { id: appt.id }
                });
                console.log(`[DB-HEALER] Deleted redundant duplicate appointment: ${appt.id}`);
              } else {
                // No collision, safe to reassign to canonical doctor
                await prisma.appointment.update({
                  where: { id: appt.id },
                  data: { doctorId: canonical.id }
                });
              }
            }
          }

          // Reassign any remaining queue tokens that were not handled by appointment merging
          const remainingTokens = await prisma.queueToken.findMany({
            where: { doctorId: duplicate.id }
          });

          for (const token of remainingTokens) {
            // Check if there is a collision for this tokenNumber under canonical doctor on the same day
            const tokenDate = new Date(token.createdAt);
            const startOfDay = new Date(tokenDate.setHours(0,0,0,0));
            const endOfDay = new Date(tokenDate.setHours(23,59,59,999));

            const tokenCollision = await prisma.queueToken.findFirst({
              where: {
                doctorId: canonical.id,
                tokenNumber: token.tokenNumber,
                createdAt: {
                  gte: startOfDay,
                  lte: endOfDay
                }
              }
            });

            if (tokenCollision) {
              // Delete redundant queue token
              await prisma.queueToken.delete({ where: { id: token.id } });
            } else {
              // Reassign
              await prisma.queueToken.update({
                where: { id: token.id },
                data: { doctorId: canonical.id }
              });
            }
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
