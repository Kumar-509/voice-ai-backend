const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const axios = require('axios');
const OpenAI = require('openai');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB Connection
if (process.env.MONGODB_URI) {
  mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('✅ Connected to MongoDB'))
    .catch(err => console.error('❌ MongoDB connection error:', err));
} else {
  console.warn('⚠️ MONGODB_URI not set');
}

// MongoDB Schemas
const ChatSchema = new mongoose.Schema({
  userId: String,
  message: String,
  response: String,
  timestamp: { type: Date, default: Date.now }
});

const ReminderSchema = new mongoose.Schema({
  userId: String,
  title: String,
  time: Date,
  completed: { type: Boolean, default: false }
});

const Chat = mongoose.model('Chat', ChatSchema);
const Reminder = mongoose.model('Reminder', ReminderSchema);

// Health Check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    time: new Date().toISOString(),
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    openai: process.env.OPENAI_API_KEY ? 'configured' : 'not configured'
  });
});

// OpenAI Chat with Real-time Search
async function chatWithOpenAI(message, useSearch = false) {
  try {
    const messages = [
      {
        role: 'system',
        content: 'You are a helpful AI assistant. Provide accurate, concise, and friendly responses. If asked about current events or real-time information, indicate that you may not have the latest data.'
      },
      {
        role: 'user',
        content: message
      }
    ];

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: messages,
      max_tokens: 500,
      temperature: 0.7
    });

    return completion.choices[0].message.content;
  } catch (error) {
    console.error('OpenAI Error:', error.message);
    if (error.status === 401) {
      return 'OpenAI API key is not configured. Please add OPENAI_API_KEY to environment variables.';
    }
    return 'I encountered an error processing your request. Please try again.';
  }
}

// Web Search with OpenAI Analysis
async function searchWithOpenAI(query) {
  try {
    // First, get web search results from DuckDuckGo
    const searchResults = await searchDuckDuckGo(query);
    
    if (!searchResults || searchResults === 'No results found.' || searchResults === 'Search unavailable.') {
      // Fallback to OpenAI without search context
      return await chatWithOpenAI(query);
    }

    // Use OpenAI to synthesize search results
    const messages = [
      {
        role: 'system',
        content: 'You are a helpful search assistant. Synthesize the provided search results into a clear, concise answer.'
      },
      {
        role: 'user',
        content: `User query: ${query}\n\nSearch results: ${searchResults}\n\nProvide a clear answer based on these results.`
      }
    ];

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: messages,
      max_tokens: 300,
      temperature: 0.5
    });

    return completion.choices[0].message.content;
  } catch (error) {
    console.error('Search with OpenAI Error:', error.message);
    return await chatWithOpenAI(query);
  }
}

// DuckDuckGo Instant Answer
async function searchDuckDuckGo(query) {
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json`;
    const res = await axios.get(url);
    return res.data.AbstractText || res.data.Answer || 'No results found.';
  } catch (error) {
    return 'Search unavailable.';
  }
}

// Weather API
async function getWeather(location = 'London') {
  try {
    const geocodeUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1`;
    const geoRes = await axios.get(geocodeUrl);
    
    if (geoRes.data.results && geoRes.data.results.length > 0) {
      const { latitude, longitude, name } = geoRes.data.results[0];
      const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true`;
      const weatherRes = await axios.get(weatherUrl);
      const weather = weatherRes.data.current_weather;
      
      return `The weather in ${name} is ${weather.temperature}°C with wind speed ${weather.windspeed} km/h.`;
    }
    return 'Weather location not found.';
  } catch (error) {
    return 'Unable to fetch weather at the moment.';
  }
}

// Wikipedia API
async function searchWikipedia(query) {
  try {
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`;
    const res = await axios.get(url);
    return res.data.extract || 'No information found.';
  } catch (error) {
    return 'Unable to find information.';
  }
}

// Chat endpoint with OpenAI
app.post('/api/chat', async (req, res) => {
  try {
    const { userId = 'anonymous', message } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Use OpenAI for intelligent responses
    const response = await chatWithOpenAI(message);
    
    // Save to database
    if (mongoose.connection.readyState === 1) {
      const chat = new Chat({ userId, message, response });
      await chat.save();
    }

    res.json({ success: true, response });
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: 'Server error', message: error.message });
  }
});

// Enhanced Search endpoint with OpenAI
app.post('/api/search', async (req, res) => {
  try {
    const { query } = req.body;
    
    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }

    // Use OpenAI-enhanced search
    const results = await searchWithOpenAI(query);
    
    res.json({ success: true, results });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Search failed', message: error.message });
  }
});

// Get chat history
app.get('/api/chat/history', async (req, res) => {
  try {
    const { userId = 'anonymous', limit = 50 } = req.query;
    const chats = await Chat.find({ userId })
      .sort({ timestamp: -1 })
      .limit(parseInt(limit));
    res.json({ success: true, chats });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Voice endpoint (uses same chat logic)
app.post('/api/voice', async (req, res) => {
  try {
    const { userId = 'anonymous', message } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const response = await chatWithOpenAI(message);
    
    if (mongoose.connection.readyState === 1) {
      const chat = new Chat({ userId, message, response });
      await chat.save();
    }

    res.json({ success: true, response });
  } catch (error) {
    console.error('Voice error:', error);
    res.status(500).json({ error: 'Server error', message: error.message });
  }
});

// Reminders
app.post('/api/reminders', async (req, res) => {
  try {
    const { userId, title, time } = req.body;
    const reminder = new Reminder({ userId, title, time });
    await reminder.save();
    res.json({ success: true, reminder });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create reminder' });
  }
});

app.get('/api/reminders', async (req, res) => {
  try {
    const { userId } = req.query;
    const reminders = await Reminder.find({ userId, completed: false });
    res.json({ success: true, reminders });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch reminders' });
  }
});

// News endpoint
app.get('/api/news', async (req, res) => {
  try {
    const category = req.query.category || 'general';
    res.json({ 
      success: true, 
      message: 'News feature coming soon',
      category 
    });
  } catch (error) {
    res.status(500).json({ error: 'News unavailable' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`\ud83d\ude80 Server running on port ${PORT}`);
  console.log(`\ud83d\udccd Health check: http://localhost:${PORT}/health`);
  console.log(`\ud83e\udd16 OpenAI: ${process.env.OPENAI_API_KEY ? 'Configured' : 'Not configured'}`);
});
