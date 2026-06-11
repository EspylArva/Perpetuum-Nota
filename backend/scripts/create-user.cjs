// Dev utility: create/ensure a user. Usage:
//   node scripts/create-user.cjs <email> <password> [role] [displayName]
// Requires DATABASE_URL in the environment (or backend/.env via dotenv).
try {
  require('dotenv').config();
} catch {
  /* dotenv optional */
}
const { PrismaClient } = require('@prisma/client');
const argon2 = require('argon2');

(async () => {
  const [email, password, role = 'USER', displayName] = process.argv.slice(2);
  if (!email || !password) {
    console.error(
      'usage: node scripts/create-user.cjs <email> <password> [role] [displayName]',
    );
    process.exit(1);
  }
  const prisma = new PrismaClient();
  const passwordHash = await argon2.hash(password);
  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      passwordHash,
      role,
      displayName: displayName || email.split('@')[0],
      isActive: true,
    },
  });
  console.log('USER ' + JSON.stringify({ id: user.id, email: user.email, role: user.role }));
  await prisma.$disconnect();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
