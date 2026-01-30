require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');

async function listResources() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('Error: ANTHROPIC_API_KEY not found in .env');
    return;
  }

  const anthropic = new Anthropic({ apiKey });

  console.log('--- Checking Claude API Resources ---');
  
  try {
    // 1. List Models
    console.log('\nFetching available models...');
    const models = await anthropic.models.list();
    console.log('Available Models:');
    
    // The list() method returns a paginated response.
    // We can iterate over the AsyncIterable provided by the SDK or access the .data property of the page
    for await (const model of models) {
        console.log(` - ${model.id} (${model.display_name || 'No display name'}) [Created: ${new Date(model.created_at).toLocaleDateString()}]`);
    }

    // 2. Explanation about Projects
    console.log('\n--- Note on "Projects" ---');
    console.log('IMPORTANT: The "Projects" feature (Workspaces with knowledge bases) available in the Claude.ai web interface');
    console.log('is currently NOT exposed via the public API.');
    console.log('The API Key provides access to model inference (chat/completions) and not user-created web projects.');
    console.log('To use project context, you must manually include relevant files in your system prompt or messages,');
    console.log('as demonstrated in this application\'s "claude-client.js".');

  } catch (err) {
    console.error('Error connecting to Anthropic API:', err.message);
    if (err.status === 401) {
        console.error('Authentication failed. Please check your API Key.');
    }
  }
}

listResources();
