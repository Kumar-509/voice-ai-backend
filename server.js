const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB Connection
if (process.env.MONGODB_URI) {
  mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('✅ Connected to MongoDB'))
    .catch(err => console.error('❌ MongoDB connection error:', err));
} else {
  console.warn('⚠️  MONGODB_URI not set');
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
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
  });
});

// Query Router - Routes queries to appropriate API
function routeQuery(query) {
  const lowerQuery = query.toLowerCase();
  
  if (lowerQuery.includes('weather') || lowerQuery.includes('temperature')) {
    return 'weather';
  } else if (lowerQuery.includes('time') || lowerQuery.includes('date')) {
    return 'time';
  } else if (lowerQuery.match(/\d+\s*[+\-*/]\s*\d+/)) {
    return 'math';
  } else if (lowerQuery.includes('who is') || lowerQuery.includes('what is') || lowerQuery.includes('define')) {
    return 'knowledge';
  } else {
    return 'general';
  }
}

// Weather API
async function getWeather(location = 'London') {
  try {
    // Using free Open-Meteo API
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

// Chat endpoint
app.post('/api/chat', async (req, res) => {
  try {
    const { userId = 'anonymous', message } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Route query
    const queryType = routeQuery(message);
    let response = '';

    switch (queryType) {
      case 'weather':
        const location = message.match(/in ([a-zA-Z\s]+)/)?.[1] || 'London';
        response = await getWeather(location);
        break;
      
      case 'time':
        const now = new Date();
        response = `Current time: ${now.toLocaleString()}`;
        break;
      
      case 'math':
        try {
          const result = eval(message.match(/[\d+\-*/().\s]+/)[0]);
          response = `The answer is: ${result}`;
        } catch {
          response = 'Could not calculate that.';
        }
        break;
      
      case 'knowledge':
        const topic = message.replace(/(who is|what is|define)/gi, '').trim();
        response = await searchWikipedia(topic);
        break;
      
      case 'general':
      default:
        response = await searchDuckDuckGo(message);
        if (!response || response === 'No results found.') {
          response = `I received your message: "${message}". I'm working on understanding more complex queries!`;
        }
        break;
    }

    // Save to database
    if (mongoose.connection.readyState === 1) {
      const chat = new Chat({ userId, message, response });
      await chat.save();
    }

    res.json({ success: true, response, queryType });
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: 'Server error', message: error.message });
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

// Voice endpoint (same as chat)
app.post('/api/voice', async (req, res) => {
  // Reuse chat logic for voice queries
  return app._router.handle(req, res, (err) => {
    if (err) res.status(500).json({ error: err.message });
  });
});

// Search endpoint
app.post('/api/search', async (req, res) => {
  try {
    const { query } = req.body;
    const results = await searchDuckDuckGo(query);
    res.json({ success: true, results });
  } catch (error) {
    res.status(500).json({ error: 'Search failed' });
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

// News endpoint (using free API)
app.get('/api/news', async (req, res) => {
  try {
    // Using free news aggregator
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
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📍 Health check: http://localhost:${PORT}/health`);
});
