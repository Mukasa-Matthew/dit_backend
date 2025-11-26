require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seed...');

  // Get admin credentials from .env
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@organization.com';
  const adminPassword = process.env.ADMIN_PASSWORD || 'ChangeMe123!';
  const adminName = process.env.ADMIN_NAME || 'Election Administrator';

  if (!adminEmail || !adminPassword) {
    throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD must be set in .env file');
  }

  // Delete all non-admin users
  const deletedCount = await prisma.user.deleteMany({
    where: {
      role: {
        not: 'ADMIN'
      }
    }
  });
  console.log(`🗑️  Deleted ${deletedCount.count} non-admin users`);

  // Create/Update Election Admin from .env
  const hashedPassword = await bcrypt.hash(adminPassword, 12);
  const admin = await prisma.user.upsert({
    where: { email: adminEmail.toLowerCase() },
    update: {
      password: hashedPassword,
      name: adminName,
      status: 'ACTIVE',
      emailVerified: true,
    },
    create: {
      email: adminEmail.toLowerCase(),
      password: hashedPassword,
      name: adminName,
      role: 'ADMIN',
      status: 'ACTIVE',
      emailVerified: true,
    },
  });
  console.log('✅ Created/Updated Admin:', admin.email);

  // Note: Other users (officers, candidates) should be created via admin dashboard
  // Positions, voters, and candidates will be managed through the admin interface
  
  // IMPORTANT: Positions should NEVER be created in seed files.
  // Positions can ONLY be created by ADMIN users via the admin dashboard.
  // This ensures proper audit logging and access control.

  // Log initial setup
  await prisma.auditLog.create({
    data: {
      actorType: 'system',
      action: 'SEED_DATABASE',
      entity: 'system',
      payload: {
        adminCreated: true,
        adminEmail: admin.email,
      },
    },
  });

  console.log('✅ Database seed completed!');
  console.log('\n📝 Admin Credentials (from .env):');
  console.log(`Email: ${admin.email}`);
  console.log('Password: [Set in ADMIN_PASSWORD in .env]');
  console.log('\n💡 Other users should be created via the admin dashboard.');
}

main()
  .catch((e) => {
    console.error('❌ Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

