class AppError extends Error {
    constructor(message, statusCode) {
        super(message);

        this.statusCode = statusCode;
        this.status = `${statusCode}`.startsWith('4') ? false : 'error';
        this.isOperational = true;
        this.errors = {}; // Field-specific errors

        Error.captureStackTrace(this, this.constructor);
    }

    // Helper to add field level errors
    setErrors(errors) {
        this.errors = errors;
        return this;
    }
}

module.exports = AppError;
