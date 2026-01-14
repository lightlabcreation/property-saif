const prisma = require('../../config/prisma');

// GET /api/admin/maintenance
exports.getTasks = async (req, res) => {
    try {
        const { propertyId } = req.query;
        const whereClause = {};
        if (propertyId && propertyId !== 'all') {
            whereClause.propertyId = parseInt(propertyId);
        }

        const tasks = await prisma.maintenanceTask.findMany({
            where: whereClause,
            include: { property: true },
            orderBy: { dueDate: 'asc' }
        });

        const formatted = tasks.map(t => ({
            id: `MNT-${t.id + 100}`,
            dbId: t.id,
            name: t.name,
            building: t.property ? t.property.name : 'General',
            buildingId: t.propertyId,
            type: t.type,
            frequency: t.frequency,
            dueDate: t.dueDate?.toISOString().split('T')[0] || 'N/A',
            vendor: t.vendor,
            status: t.status,
            notes: t.notes
        }));

        res.json(formatted);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Server error' });
    }
};

// POST /api/admin/maintenance
exports.createTask = async (req, res) => {
    try {
        const { name, buildingId, type, frequency, dueDate, vendor, notes } = req.body;

        const newTask = await prisma.maintenanceTask.create({
            data: {
                name,
                propertyId: buildingId ? parseInt(buildingId) : null,
                type,
                frequency,
                dueDate: new Date(dueDate),
                vendor,
                status: 'Upcoming',
                notes
            }
        });

        res.status(201).json(newTask);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Error creating task' });
    }
};

// PUT /api/admin/maintenance/:id
exports.updateTask = async (req, res) => {
    try {
        const { id } = req.params;
        const { status, name, notes } = req.body;

        const data = {};
        if (status) data.status = status;
        if (name) data.name = name;
        if (notes) data.notes = notes;

        const updated = await prisma.maintenanceTask.update({
            where: { id: parseInt(id) },
            data
        });

        res.json(updated);
    } catch (e) {
        res.status(500).json({ message: 'Error updating task' });
    }
};
