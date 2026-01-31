const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const fileUpload = require('express-fileupload');
const routes = require('./routes');

const app = express();

// Middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

const allowedOrigins = [
  "https://masteko-asa.netlify.app",
  "http://localhost:5173",
  "https://masteko-property-kti.netlify.app",
  "https://property-new.netlify.app",
  "https://property-n.kiaantechnology.com",
  "https://property-mastekocomplete.netlify.app"
];

app.use(
  cors({
    origin: function (origin, callback) {
      // allow server-to-server or curl requests
      if (!origin) return callback(null, true);

      // Allow all origins in development
      if (process.env.NODE_ENV === 'development' || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        console.error("CORS blocked origin:", origin);
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
    ],
  })
);
// Configure this properly for production later
app.use(express.json());
app.use(morgan('dev'));

// File Upload Middleware
app.use(fileUpload({
  useTempFiles: true,
  tempFileDir: '/tmp/',
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB
}));

// Routes
app.use('/api', routes);
app.use('/uploads', express.static('uploads'));

// Error Handling
const globalErrorHandler = require('./middlewares/globalError.middleware');
const AppError = require('./utils/AppError');

// Error Handling
// Handle undefined routes
app.use((req, res, next) => {
  next(new AppError(`Can't find ${req.originalUrl} on this server!`, 404));
});

app.use(globalErrorHandler);

module.exports = app;
