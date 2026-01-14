const prisma = require('../../config/prisma');

// GET /api/tenant/lease
exports.getLeaseDetails = async (req, res) => {
    try {
        const userId = req.user.id;
        console.log('Fetching lease for userId:', userId);

        const tenant = await prisma.user.findUnique({
            where: { id: userId },
            include: {
                leases: {
                    include: {
                        unit: {
                            include: { property: true }
                        }
                    },
                    orderBy: {
                        createdAt: 'desc'
                    }
                }
            }
        });

        console.log('Tenant found with ALL leases:', JSON.stringify(tenant, null, 2));

        if (!tenant || !tenant.leases || tenant.leases.length === 0) {
            console.log('No leases found for tenant:', userId);
            return res.status(404).json({ message: 'No lease found for this account' });
        }

        // Filter for relevant leases in JS if needed, or just take the latest
        const lease = tenant.leases.find(l => ['Active', 'DRAFT', 'Moved'].includes(l.status)) || tenant.leases[0];

        res.json({
            id: `LEASE-${lease.startDate ? new Date(lease.startDate).getFullYear() : new Date().getFullYear()}-${lease.id}`,
            property: lease.unit.property.name,
            unit: lease.unit.name,
            address: lease.unit.property.address,
            monthlyRent: lease.monthlyRent ? parseFloat(lease.monthlyRent) : 0,
            startDate: lease.startDate,
            endDate: lease.endDate,
            status: lease.status,
            deposit: lease.monthlyRent ? parseFloat(lease.monthlyRent) : 0, // Mock assumption
        });

    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Server error' });
    }
};
