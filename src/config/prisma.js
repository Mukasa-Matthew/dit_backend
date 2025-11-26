require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const mysql = require('mysql2/promise');

// Parse DATABASE_URL to create MySQL connection pool (for connection testing only)
function parseDatabaseUrl(url) {
  if (!url) return {};
  
  try {
    const dbUrl = new URL(url);
    return {
      host: dbUrl.hostname,
      port: parseInt(dbUrl.port) || 3306,
      user: dbUrl.username,
      password: dbUrl.password,
      database: dbUrl.pathname.slice(1), // Remove leading '/'
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0
    };
  } catch (error) {
    return {};
  }
}

// Create MySQL connection pool (only for connection testing)
const poolConfig = parseDatabaseUrl(process.env.DATABASE_URL);
const pool = mysql.createPool(poolConfig);

// Create Prisma Client instance with connection pooling optimizations
// Prisma 6 doesn't require adapters - it uses DATABASE_URL directly from schema.prisma
const prisma = new PrismaClient({
  log: ['error'], // Production: only log errors
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
});

// Test database connection
async function testConnection() {
  try {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is not set in .env file');
    }

    // Test connection using the pool directly (faster than Prisma $connect)
    const connection = await pool.getConnection();
    await connection.ping();
    connection.release();
    
    // Parse DATABASE_URL to show connection info (without password)
    const dbUrl = process.env.DATABASE_URL;
    const urlObj = new URL(dbUrl);
    
    console.log('✅ Database connected successfully!');
    console.log(`📍 Connected to: ${urlObj.hostname}:${urlObj.port || 3306}/${urlObj.pathname.slice(1)}`);
    
    return true;
  } catch (error) {
    console.error('\n❌ Database connection failed!');
    
    // Handle AggregateError (multiple errors)
    let actualError = error;
    if (error.name === 'AggregateError' && error.errors && error.errors.length > 0) {
      actualError = error.errors[0];
      if (error.errors.length > 1) {
        console.error(`⚠️  Multiple connection errors (${error.errors.length}):`);
      }
    }
    
    // Show detailed error information
    const errorMessage = actualError.message || error.message || error.toString() || 'Unknown error';
    const errorCode = actualError.code || error.code || actualError.errno || error.errno || 'N/A';
    
    console.error('🔴 Error Message:', errorMessage);
    console.error('🔴 Error Code:', errorCode);
    
    if (error.code === 'ECONNREFUSED' || error.code === 'P1001') {
      console.error('⚠️  Connection refused - Database server is not running or not accessible');
      console.error('   → Make sure MySQL/MariaDB server is running on your PC');
      console.error('   → For localhost, check if MySQL service is started');
      console.error('   → Windows: Check Services (services.msc) for MySQL');
      console.error('   → Check if the port is correct (default: 3306)');
      console.error('   → Verify DATABASE_URL uses: mysql://user:password@localhost:3306/database');
    } else if (error.code === 'ER_ACCESS_DENIED_ERROR' || error.code === 'P1000') {
      console.error('⚠️  Access denied - Invalid database credentials');
      console.error('   → Check your username and password in DATABASE_URL');
      console.error('   → Verify the user has proper permissions');
    } else if (error.code === 'ENOTFOUND' || error.code === 'P1003') {
      console.error('⚠️  Host not found - Cannot resolve database hostname');
      console.error('   → Check your DATABASE_URL host in .env file');
      console.error('   → Verify DNS/hostname is correct');
    } else if (error.code === 'ETIMEDOUT' || error.code === 'P1002') {
      console.error('⚠️  Connection timeout - Database server is not responding');
      console.error('   → Check if database server is running');
      console.error('   → Verify network connectivity');
    } else if (error.message && error.message.includes('DATABASE_URL')) {
      console.error('⚠️  DATABASE_URL configuration error');
      console.error('   → Check your .env file has DATABASE_URL set');
      console.error('   → Format: mysql://user:password@host:port/database');
    } else {
      console.error('⚠️  Unexpected error occurred');
      if (error.stack) {
        console.error('📋 Stack trace:', error.stack.split('\n').slice(0, 3).join('\n'));
      }
    }
    
    console.error('\n💡 Troubleshooting steps for LOCALHOST MySQL:');
    console.error('   1. Start MySQL service on your PC:');
    console.error('      - Windows: Open Services (Win+R → services.msc) → Find MySQL → Start');
    console.error('      - Or use: net start MySQL (in Command Prompt as Admin)');
    console.error('   2. Check DATABASE_URL in .env file:');
    console.error('      Format: mysql://username:password@localhost:3306/database_name');
    console.error('      Example: mysql://root:mypassword@localhost:3306/evoting_db');
    console.error('      If no password: mysql://root@localhost:3306/evoting_db');
    console.error('   3. Create the database if it doesn\'t exist:');
    console.error('      - Open MySQL Command Line or MySQL Workbench');
    console.error('      - Run: CREATE DATABASE evoting_db;');
    console.error('   4. Verify MySQL is listening on port 3306:');
    console.error('      - Check: netstat -an | findstr 3306');
    console.error('   5. Test connection manually:');
    console.error('      - Try: mysql -u root -p -h localhost\n');
    
    throw error;
  }
}

// Handle graceful shutdown
process.on('beforeExit', async () => {
  await prisma.$disconnect();
  await pool.end();
});

module.exports = { prisma, testConnection };
