const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { testConnection } = require('./config/prisma');

// dotenv is already loaded in prisma.js, but load again to ensure all vars are available
dotenv.config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve uploaded files
app.use('/uploads', express.static('uploads'));

// Routes
app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/admin', require('./routes/admin-recovery.routes')); // Admin recovery
app.use('/api/users', require('./routes/users.routes')); // Admin user management
app.use('/api/positions', require('./routes/positions.routes'));
app.use('/api/candidates', require('./routes/candidates.routes'));
app.use('/api/voters', require('./routes/voters.routes')); // Voter management
app.use('/api/verify', require('./routes/verification.routes'));
app.use('/api/vote', require('./routes/votes.routes'));
app.use('/api/reports', require('./routes/reports.routes'));
app.use('/api/email', require('./routes/email-test.routes')); // Email test endpoint

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'E-Voting System API is running' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

const PORT = process.env.PORT || 5000;

// Test database connection before starting server
async function startServer() {
  try {
    // Test database connection
    await testConnection();
    
    // Start server
    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📝 Environment: ${process.env.NODE_ENV || 'development'}`);
    });
  } catch (error) {
    console.error('\n❌ Failed to start server due to database connection error');
    process.exit(1);
  }
}

startServer();

module.exports = app;

