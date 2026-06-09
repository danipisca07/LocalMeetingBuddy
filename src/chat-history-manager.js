class ChatHistoryManager {
  constructor() {
    this.history = [];
  }

  /**
   * Retrieves the full chat history.
   * @returns {Array} The array of chat messages.
   */
  getHistory() {
    return this.history;
  }

  /**
   * Adds a new message to the chat history.
   * @param {string} role - The role of the message sender (e.g., 'user', 'assistant').
   * @param {string} content - The content of the message.
   */
  addMessage(role, content) {
    this.history.push({ role, content });
  }

  /**
   * Clears the chat history.
   */
  clearHistory() {
    this.history = [];
  }
}

module.exports = ChatHistoryManager;
