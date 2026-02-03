const OpenAI = require('openai');
const Anthropic = require('@anthropic-ai/sdk');

// Initialize OpenAI with error handling
let openai;
try {
  openai = new OpenAI({
    apiKey: process.env.MY_OPENAI_API,
  });
} catch (error) {
  console.error('OpenAI initialization error:', error);
}

// Initialize Anthropic (Claude)
let anthropic;
try {
  anthropic = new Anthropic({
    apiKey: process.env.MY_CLAUDE_API,
  });
} catch (error) {
  console.error('Anthropic initialization error:', error);
}

// CORS headers for better compatibility
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-cache, no-store, must-revalidate',
  'Pragma': 'no-cache',
  'Expires': '0'
};

exports.handler = async function (event, context) {
  // Handle CORS preflight requests
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: ''
    };
  }

  // Only allow POST requests
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Method Not Allowed" })
    };
  }

  // Check if at least one AI service is initialized
  if (!openai && !anthropic) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: "AI services not configured" })
    };
  }

  try {
    // Parse and validate request body
    const body = JSON.parse(event.body);
    const { message, history = [], customApiKey, provider = 'openai', model, systemPrompt } = body;
    
    console.log('Request received:', { model, provider, hasCustomKey: !!customApiKey });

    // Validate required fields
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: "Message is required and must be a non-empty string" })
      };
    }

    // Validate history format
    if (!Array.isArray(history)) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: "History must be an array" })
      };
    }

    // Determine model and provider
    let selectedModel = model || 'gpt-3.5-turbo-16k';
    const isClaudeModel = selectedModel.includes('claude');
    
    console.log('Processing:', { selectedModel, isClaudeModel, hasAnthropic: !!anthropic, hasOpenAI: !!openai });
    
    // Use custom API key if provided
    let apiClient = isClaudeModel ? anthropic : openai;
    let actualProvider = isClaudeModel ? 'anthropic' : 'openai';
    
    console.log('Using provider:', actualProvider);
    
    if (customApiKey) {
      if (provider === 'openai') {
        apiClient = new OpenAI({ apiKey: customApiKey });
        actualProvider = 'openai';
      } else if (provider === 'anthropic') {
        apiClient = new Anthropic({ apiKey: customApiKey });
        actualProvider = 'anthropic';
      } else {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: `Provider "${provider}" not supported.` })
        };
      }
    }

    let aiMessage;

    // Route to appropriate AI service
    if (actualProvider === 'anthropic' || isClaudeModel) {
      // Check if Anthropic is initialized
      if (!apiClient) {
        return {
          statusCode: 500,
          headers: corsHeaders,
          body: JSON.stringify({ error: "Claude API not configured" })
        };
      }

      // Convert message history to Claude format
      const claudeMessages = history.map(msg => ({
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: msg.content
      }));

      // Add current message
      claudeMessages.push({
        role: 'user',
        content: message.trim()
      });

      // Call Claude API
      const claudeResponse = await apiClient.messages.create({
        model: selectedModel,
        max_tokens: 1024,
        temperature: 0.7,
        system: systemPrompt || 'You are a helpful chat assistant.',
        messages: claudeMessages
      });

      aiMessage = claudeResponse.content[0]?.text;

      if (!aiMessage) {
        throw new Error('No response from Claude');
      }

    } else {
      // OpenAI API
      if (!apiClient) {
        return {
          statusCode: 500,
          headers: corsHeaders,
          body: JSON.stringify({ error: "OpenAI API not configured" })
        };
      }

      const messages = [
        {
          role: 'system',
          content: systemPrompt || 'You are a helpful chat assistant.'
        },
        ...history,
        {
          role: 'user',
          content: message.trim()
        }
      ];

      const gptResponse = await apiClient.chat.completions.create({
        model: selectedModel,
        max_tokens: 1024,
        temperature: 0.7,
        messages: messages
      });

      aiMessage = gptResponse.choices[0]?.message?.content;

      if (!aiMessage) {
        throw new Error('No response from OpenAI');
      }
    }

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ 
        message: aiMessage
      })
    };

  } catch (error) {
    console.error('Chat function error:', error);
    
    // Handle specific OpenAI errors
    if (error.code === 'insufficient_quota') {
      return {
        statusCode: 429,
        headers: corsHeaders,
        body: JSON.stringify({ error: "API quota exceeded. Please try again later." })
      };
    }
    
    if (error.code === 'rate_limit_exceeded') {
      return {
        statusCode: 429,
        headers: corsHeaders,
        body: JSON.stringify({ error: "Rate limit exceeded. Please wait a moment and try again." })
      };
    }

    // Generic error response
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ 
        error: "Sorry, I'm having trouble processing your request. Please try again." 
      })
    };
  }
};