const AppError = require('../utils/AppError');

const handleCastErrorDB = err => {
    const message = `Invalid ${err.path}: ${err.value}.`;
    return new AppError(message, 400);
};

const handleDuplicateFieldsDB = err => {
    if (err.code === 'P2002') {
        const target = err.meta && err.meta.target ? (Array.isArray(err.meta.target) ? err.meta.target[0] : err.meta.target) : null;
        const fieldName = target || 'This information';
        const message = `${fieldName} is already in use. Please use different information.`;
        const error = new AppError(message, 409);
        error.errors = { [fieldName]: message };
        return error;
    }
    return new AppError('This record already exists. Please use different information.', 409);
};

const handleValidationErrorDB = err => {
    if (err.code === 'P2003') {
        return new AppError('A related record is missing. Please check your selection and try again.', 400);
    }
    if (err.code === 'P2025') {
        return new AppError('The requested record was not found.', 404);
    }
    return new AppError(err.message || 'Invalid request. Please check your input.', 400);
};

const sendErrorDev = (err, res) => {
    res.status(err.statusCode).json({
        success: false,
        status: err.status,
        error: err,
        message: err.message,
        errors: err.errors,
        stack: err.stack
    });
};

const sendErrorProd = (err, res) => {
    // Operational, trusted error: send message to client
    if (err.isOperational) {
        res.status(err.statusCode).json({
            success: false,
            message: err.message,
            errors: err.errors
        });
    } else {
        // Programming or other unknown error: don't leak details
        console.error('ERROR 💥', err);
        res.status(500).json({
            success: false,
            message: 'Something went wrong on our side. Please try again.',
            errors: {}
        });
    }
};

module.exports = (err, req, res, next) => {
    err.statusCode = err.statusCode || 500;
    err.status = err.status || 'error';

    // Convert Prisma/DB errors to user-friendly messages in all environments (so frontend always gets plain-language messages)
    let error = { ...err };
    error.message = err.message;
    error.name = err.name;
    error.code = err.code;
    if (error.code === 'P2002') error = handleDuplicateFieldsDB(error);
    if (error.code === 'P2003' || error.code === 'P2025') error = handleValidationErrorDB(error);
    // Prisma "Unknown arg" (invalid field name) -> 400 with clear message
    if (err.message && typeof err.message === 'string' && err.message.includes('Unknown arg')) {
        error = new AppError('Invalid data field sent. Please refresh and try again.', 400);
    }

    // Unknown/programming errors: hide technical details from client
    if (!error.isOperational && error.statusCode === 500) {
        error.message = 'Something went wrong. Please try again.';
        error.errors = {};
    }

    const payload = {
        success: false,
        message: error.message,
        errors: error.errors || {}
    };
    if (err.stack) {
        payload.stack = err.stack;
    }
    res.status(error.statusCode).json(payload);
};
