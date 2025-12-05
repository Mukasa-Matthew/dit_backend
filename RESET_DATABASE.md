# Database Reset Guide

## Complete Database Reset (Drop & Recreate)

### Option 1: Using MySQL CLI (Recommended)

```bash
# 1. Connect to MySQL (replace with your credentials)
mysql -u root -p

# 2. Drop the database (replace 'your_database_name' with your actual database name)
DROP DATABASE IF EXISTS your_database_name;

# 3. Create the database fresh
CREATE DATABASE your_database_name CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

# 4. Exit MySQL
EXIT;
```

Then run Prisma commands:

```bash
cd backend

# 5. Reset Prisma migrations (removes migration history)
npx prisma migrate reset

# OR if you want to keep migration history, just run:
# 6. Run all migrations from scratch
npx prisma migrate deploy

# 7. Generate Prisma Client
npx prisma generate

# 8. Seed the database (creates admin user)
npm run prisma:seed
```

### Option 2: Using Prisma Migrate Reset (Easier)

```bash
cd backend

# This command will:
# - Drop the database
# - Create the database
# - Run all migrations
# - Run the seed script
npx prisma migrate reset

# Generate Prisma Client (if needed)
npx prisma generate
```

**Note:** `prisma migrate reset` will:
- Drop the database
- Recreate it
- Apply all migrations
- Run the seed script automatically

### Option 3: Manual Step-by-Step

```bash
cd backend

# 1. Drop database via MySQL
mysql -u root -p -e "DROP DATABASE IF EXISTS your_database_name;"

# 2. Create database
mysql -u root -p -e "CREATE DATABASE your_database_name CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

# 3. Run migrations
npx prisma migrate deploy

# 4. Generate Prisma Client
npx prisma generate

# 5. Seed database
npm run prisma:seed
```

## Quick Reset Script

Create a file `reset-db.sh` (Linux/Mac) or `reset-db.bat` (Windows):

### Linux/Mac (`reset-db.sh`):
```bash
#!/bin/bash
cd backend
echo "🔄 Resetting database..."
npx prisma migrate reset --force
echo "✅ Database reset complete!"
```

### Windows (`reset-db.bat`):
```batch
@echo off
cd backend
echo Resetting database...
npx prisma migrate reset --force
echo Database reset complete!
pause
```

## Environment Variables Required

Make sure your `.env` file has:

```env
DATABASE_URL=mysql://username:password@localhost:3306/your_database_name
ADMIN_EMAIL=admin@organization.com
ADMIN_PASSWORD=ChangeMe123!
ADMIN_NAME=Election Administrator
JWT_SECRET=your-secret-key-here
```

## What Gets Reset

When you reset the database:
- ✅ All tables are dropped and recreated
- ✅ All data is deleted
- ✅ All migrations are reapplied
- ✅ Seed script runs (creates admin user)
- ✅ Audit logs are cleared

## What to Do After Reset

1. **Create admin user** (if seed didn't work):
   - Use the admin recovery endpoint, OR
   - Check seed.js output for admin credentials

2. **Import voters** (if needed):
   - Use the admin dashboard to import CSV

3. **Create positions**:
   - Use the admin dashboard to create election positions

4. **Create officers** (if needed):
   - Use the admin dashboard to create returning officers

## Troubleshooting

### Error: "Database does not exist"
```bash
# Create the database first
mysql -u root -p -e "CREATE DATABASE your_database_name CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
```

### Error: "Migration failed"
```bash
# Check migration status
npx prisma migrate status

# If needed, mark migrations as applied
npx prisma migrate resolve --applied <migration_name>
```

### Error: "Cannot connect to database"
- Check DATABASE_URL in `.env` file
- Verify MySQL is running: `mysql -u root -p`
- Check database credentials



