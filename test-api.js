const axios = require('axios');

async function testAPI() {
    try {
        const response = await axios.get('http://localhost:5000/api/admin/properties/available');
        console.log('Status:', response.status);
        console.log('Data:', JSON.stringify(response.data, null, 2));
    } catch (error) {
        console.error('Error:', error.response?.status, error.response?.data || error.message);
    }
}

testAPI();
