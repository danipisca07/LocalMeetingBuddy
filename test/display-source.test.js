const assert = require('assert');
const { determineDisplaySource } = require('../utils');

console.log('Running tests for determineDisplaySource...');

// Test Case 1: Live Meeting, valid speaker
// Condition: (isLiveMeeting && speaker exists) -> true
// Expected: source + "-" + speaker
try {
    const result = determineDisplaySource(true, 'live', 'Speaker1');
    assert.strictEqual(result, 'live-Speaker1');
    console.log('PASS: Live Meeting with valid speaker');
} catch (e) {
    console.error('FAIL: Live Meeting with valid speaker', e.message);
}

// Test Case 2: Live Meeting, source not user
// Condition: (source !== "user") -> true
// Expected: source + "-" + speaker
try {
    const result = determineDisplaySource(true, 'caller', 'Speaker2');
    assert.strictEqual(result, 'caller-Speaker2');
    console.log('PASS: Live Meeting, source not user');
} catch (e) {
    console.error('FAIL: Live Meeting, source not user', e.message);
}

// Test Case 3: Live Meeting, speaker undefined
// Condition: (isLiveMeeting && undefined) -> false
// OR (source !== "user")
// If source is 'live' (which != 'user'), it should enter first block.
try {
    const result = determineDisplaySource(true, 'live', undefined);
    assert.strictEqual(result, 'live-undefined');
    console.log('PASS: Live Meeting, speaker undefined, source != user');
} catch (e) {
    console.error('FAIL: Live Meeting, speaker undefined, source != user', e.message);
}

// Test Case 4: Not Live Meeting, source is user
// Condition: First block: (false) || (false) -> false
// Second block: (!isLiveMeeting && source === 'user') -> true
// Expected: 'user'
try {
    const result = determineDisplaySource(false, 'user', 'Speaker1'); // Speaker ignored if source is user and not live?
    // Wait, check logic:
    // (false && ...) -> false
    // || ('user' !== 'user') -> false
    // else if (true && true) -> true
    // returns 'user'
    assert.strictEqual(result, 'user');
    console.log('PASS: Not Live Meeting, source user');
} catch (e) {
    console.error('FAIL: Not Live Meeting, source user', e.message);
}

// Test Case 5: Not Live Meeting, source not user
// Condition: First block: (false) || ('caller' !== 'user') -> true
// Expected: source + "-" + speaker
try {
    const result = determineDisplaySource(false, 'caller', 'Speaker3');
    assert.strictEqual(result, 'caller-Speaker3');
    console.log('PASS: Not Live Meeting, source not user');
} catch (e) {
    console.error('FAIL: Not Live Meeting, source not user', e.message);
}

// Test Case 6: Live Meeting, source is user (hypothetical config error or edge case)
// Condition: (true && speaker defined) -> true
// Expected: user-SpeakerX
try {
    const result = determineDisplaySource(true, 'user', 'SpeakerX');
    assert.strictEqual(result, 'user-SpeakerX');
    console.log('PASS: Live Meeting, source user, speaker defined');
} catch (e) {
    console.error('FAIL: Live Meeting, source user, speaker defined', e.message);
}

// Test Case 7: Live Meeting, source is user, speaker undefined
// Condition: (true && undefined) -> false
// || ('user' !== 'user') -> false
// else if (!true ...) -> false
// Expected: "unknown caller" (default)
try {
    const result = determineDisplaySource(true, 'user', undefined);
    assert.strictEqual(result, 'unknown caller');
    console.log('PASS: Live Meeting, source user, speaker undefined -> unknown caller');
} catch (e) {
    console.error('FAIL: Live Meeting, source user, speaker undefined', e.message);
}

// Test Case 8: Live Meeting, source is user, speaker empty string
// Condition: (true && "" !== "") -> false
// || ('user' !== 'user') -> false
// else if (!true ...) -> false
// Expected: "unknown caller"
try {
    const result = determineDisplaySource(true, 'user', '');
    assert.strictEqual(result, 'unknown caller');
    console.log('PASS: Live Meeting, source user, speaker empty -> unknown caller');
} catch (e) {
    console.error('FAIL: Live Meeting, source user, speaker empty', e.message);
}

// Test Case 9: Not Live Meeting, source user, speaker defined (should be ignored)
try {
    const result = determineDisplaySource(false, 'user', 'ShouldBeIgnored');
    assert.strictEqual(result, 'user');
    console.log('PASS: Not Live Meeting, source user, speaker ignored');
} catch (e) {
    console.error('FAIL: Not Live Meeting, source user, speaker ignored', e.message);
}

console.log('All tests completed.');
