const { body, validationResult } = require('express-validator');
const bcrypt = require('bcrypt');
const prisma = require('../../config/prisma');
const { generateTokens } = require('../../utils/token');

// Login Controller
exports.login = async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { email, password } = req.body;

        // Find user
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        // Check Role (if admin portal, enforce Admin)
        // Actually, user might be Owner/Tenant logging in via same endpoint?
        // The requirement says "Admin authentication (JWT)". 
        // We will allow all but frontend will redirect based on role.

        // Validate password
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        // Generate Tokens
        const { accessToken, refreshToken } = generateTokens(user);

        // Store Refresh Token
        // First, delete old tokens for this user to keep it clean (optional, strictly one session or multiple?)
        // Let's just create a new one.
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 7);

        await prisma.refreshToken.create({
            data: {
                token: refreshToken,
                userId: user.id,
                expiresAt,
            },
        });

        res.json({
            message: 'Login successful',
            accessToken,
            refreshToken,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role,
            },
        });
    } catch (error) {
        console.error('Login Error:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Validation Rules
exports.validateLogin = [
    body('email').isEmail().withMessage('Please provide a valid email'),
    body('password').exists().withMessage('Password is required'),
];
