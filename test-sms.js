/**
 * SMS Integration Test Script
 * Run this to test the SMS functionality
 */

const smsService = require('./src/services/sms.service');

async function testSMS() {
    console.log('🧪 Testing SMS Integration...\n');

    // Test 1: Send a test SMS
    console.log('📤 Test 1: Sending test SMS...');
    const testPhone = ''; // Replace with your test phone number
    const testMessage = 'Hello! This is a test message from your Property Management System.';

    const result = await smsService.sendSMS(testPhone, testMessage);

    if (result.success) {
        console.log('✅ SMS sent successfully!');
        console.log('   SID:', result.sid);
        console.log('   To:', testPhone);
    } else {
        console.log('❌ SMS failed to send');
        console.log('   Error:', result.error);
        console.log('   Code:', result.code);
    }

    console.log('\n' + '='.repeat(50));
    console.log('Test complete!');
    console.log('='.repeat(50));
}

// Run the test
testSMS().catch(console.error);
