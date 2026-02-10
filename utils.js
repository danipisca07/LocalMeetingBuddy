/**
 * Determines the display source string based on meeting status, source, and speaker.
 * 
 * @param {boolean} isLiveMeeting - Whether the meeting is live.
 * @param {string} source - The source identifier (e.g., 'user', 'caller', 'live').
 * @param {string} [speaker] - The identified speaker name, if available.
 * @returns {string} The formatted display source string.
 */
function determineDisplaySource(isLiveMeeting, source, speaker) {
    let displaySource = "unknown caller";
    if (
        (isLiveMeeting && speaker !== undefined && speaker !== "")
        || (source !== "user")
    ) {
        displaySource = source + "-" + speaker;
    } else if (!isLiveMeeting && source === 'user') {
        displaySource = 'user';
    }
    return displaySource;
}

module.exports = {
    determineDisplaySource
};
