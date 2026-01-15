const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const fileUpload = require('express-fileupload');
const routes = require('./routes');

const app = express();

// Middleware
app.use(helmet());

const allowedOrigins = [
  "https://masteko-asa.netlify.app",
  "http://localhost:5173",
];

app.use(
  cors({
    origin: function (origin, callback) {
      // allow server-to-server or curl requests
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
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
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ status: 'error', message: 'Something went wrong!' });
});

module.exports = app;
