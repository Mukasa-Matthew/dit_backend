const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { testConnection } = require('./config/prisma');

// dotenv is already loaded in prisma.js, but load again to ensure all vars are available
dotenv.config();

const app = express();

// Middleware
// Production CORS - allow frontend origin
const allowedOrigins = [
  'http://64.23.169.136:3063',
  'http://localhost:3063',
  process.env.FRONTEND_URL
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn(`CORS blocked origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Request logging middleware (for debugging)
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path} - Origin: ${req.headers.origin || 'none'}`);
  next();
});

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
    error: err.message || 'Internal Server Error'
    // Stack traces not exposed in production for security
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

const PORT = process.env.PORT || 5656;

// Test database connection before starting server
async function startServer() {
  try {
    // Test database connection
    await testConnection();
    
    // Start server
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📝 Environment: production`);
      console.log(`🌐 Access at: http://64.23.169.136:${PORT}`);
    });
  } catch (error) {
    console.error('\n❌ Failed to start server due to database connection error');
    process.exit(1);
  }
}

startServer();

module.exports = app;

