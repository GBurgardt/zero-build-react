import Anthropic from '@anthropic-ai/sdk';
import { config } from 'dotenv';

config();

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

console.log('Testing Claude API...');
console.log('API Key present:', !!ANTHROPIC_API_KEY);
console.log('API Key length:', ANTHROPIC_API_KEY?.length || 0);
console.log('API Key first 10 chars:', ANTHROPIC_API_KEY?.substring(0, 10) + '...');

if (!ANTHROPIC_API_KEY) {
  console.error('No API key found!');
  process.exit(1);
}

const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

async function testClaude() {
  try {
    console.log('\nSending test message to Claude...');
    
    const response = await anthropic.messages.create({
      model: 'claude-opus-4-1-20250805', // Claude Opus 4.1
      max_tokens: 100,
      temperature: 0.7,
      system: 'You are a helpful assistant.',
      messages: [
        {
          role: 'user',
          content: 'Say hello in 5 words or less'
        }
      ]
    });
    
    console.log('\nSuccess! Response:', response);
    console.log('Text content:', response.content[0]?.text);
    
  } catch (error) {
    console.error('\nError calling Claude:', error);
    console.error('Error type:', error?.constructor?.name);
    console.error('Error message:', error?.message);
    if (error?.status) {
      console.error('HTTP Status:', error.status);
    }
    if (error?.error) {
      console.error('API Error:', error.error);
    }
  }
}

testClaude();