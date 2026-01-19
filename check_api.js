const axios = require('axios');

async function checkApi() {
    try {
        const res = await axios.get('http://localhost:5000/api/admin/units?limit=100');
        const units = res.data.data;

        console.log('--- API CHECK ---');
        units.forEach(u => {
            if (u.status !== 'Vacant') {
                console.log(`Unit: ${u.unit_identifier} | Status: ${u.status} | RentalMode: ${u.rentalMode}`);
            }
        });
    } catch (e) {
        console.error(e.message);
    }
}

checkApi();
