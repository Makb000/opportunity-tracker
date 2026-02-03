const express = require('express');
const { BlobServiceClient } = require('@azure/storage-blob');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Azure Blob Storage configuration
const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
const containerName = process.env.STORAGE_CONTAINER_NAME || 'data';
const blobName = process.env.STORAGE_BLOB_NAME || 'crm-data.json';

// Validate connection string exists
if (!connectionString) {
  console.error('ERROR: AZURE_STORAGE_CONNECTION_STRING environment variable is required');
  console.error('Set this in Azure App Service Configuration > Application settings');
  process.exit(1);
}

// Initialize Azure Blob Storage clients
const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
const containerClient = blobServiceClient.getContainerClient(containerName);
const blobClient = containerClient.getBlockBlobClient(blobName);

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// Request logging
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.path}`);
  next();
});

// ============================================
// Helper Functions
// ============================================

/**
 * Read JSON data from Azure Blob Storage
 * Returns empty structure if blob doesn't exist
 */
async function readData() {
  try {
    const downloadResponse = await blobClient.download(0);
    const content = await streamToString(downloadResponse.readableStreamBody);
    return JSON.parse(content);
  } catch (error) {
    if (error.statusCode === 404) {
      // Blob doesn't exist yet, return empty data structure
      console.log('No existing data found, returning empty structure');
      return {
        companies: [],
        opportunities: [],
        contacts: [],
        activities: []
      };
    }
    throw error;
  }
}

/**
 * Write JSON data to Azure Blob Storage
 */
async function writeData(data) {
  const content = JSON.stringify(data, null, 2);
  const options = {
    blobHTTPHeaders: {
      blobContentType: 'application/json'
    }
  };
  await blobClient.upload(content, Buffer.byteLength(content), { overwrite: true, ...options });
  console.log(`Data saved: ${data.companies?.length || 0} companies, ${data.opportunities?.length || 0} opportunities, ${data.contacts?.length || 0} contacts, ${data.activities?.length || 0} activities`);
}

/**
 * Convert readable stream to string
 */
async function streamToString(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

// ============================================
// API Endpoints
// ============================================

/**
 * GET /api/data
 * Retrieve all CRM data (companies, opportunities, contacts, activities)
 */
app.get('/api/data', async (req, res) => {
  try {
    const data = await readData();
    res.json(data);
  } catch (error) {
    console.error('Error reading data:', error.message);
    res.status(500).json({ error: 'Failed to read data', details: error.message });
  }
});

/**
 * PUT /api/data
 * Replace all CRM data (full import/sync)
 */
app.put('/api/data', async (req, res) => {
  try {
    const data = req.body;
    
    // Validate structure
    if (!data || typeof data !== 'object') {
      return res.status(400).json({ error: 'Invalid data format' });
    }
    
    // Ensure all arrays exist
    const sanitizedData = {
      companies: Array.isArray(data.companies) ? data.companies : [],
      opportunities: Array.isArray(data.opportunities) ? data.opportunities : [],
      contacts: Array.isArray(data.contacts) ? data.contacts : [],
      activities: Array.isArray(data.activities) ? data.activities : []
    };
    
    await writeData(sanitizedData);
    res.json({ 
      success: true, 
      counts: {
        companies: sanitizedData.companies.length,
        opportunities: sanitizedData.opportunities.length,
        contacts: sanitizedData.contacts.length,
        activities: sanitizedData.activities.length
      }
    });
  } catch (error) {
    console.error('Error writing data:', error.message);
    res.status(500).json({ error: 'Failed to write data', details: error.message });
  }
});

/**
 * PATCH /api/data
 * Partial update - merge provided fields with existing data
 */
app.patch('/api/data', async (req, res) => {
  try {
    const updates = req.body;
    const existingData = await readData();
    
    // Merge updates with existing data
    const mergedData = {
      companies: Array.isArray(updates.companies) ? updates.companies : existingData.companies,
      opportunities: Array.isArray(updates.opportunities) ? updates.opportunities : existingData.opportunities,
      contacts: Array.isArray(updates.contacts) ? updates.contacts : existingData.contacts,
      activities: Array.isArray(updates.activities) ? updates.activities : existingData.activities
    };
    
    await writeData(mergedData);
    res.json({ 
      success: true, 
      counts: {
        companies: mergedData.companies.length,
        opportunities: mergedData.opportunities.length,
        contacts: mergedData.contacts.length,
        activities: mergedData.activities.length
      }
    });
  } catch (error) {
    console.error('Error updating data:', error.message);
    res.status(500).json({ error: 'Failed to update data', details: error.message });
  }
});

// ============================================
// Entity-specific endpoints for granular updates
// ============================================

/**
 * PATCH /api/opportunities/:id
 * Update or create a single opportunity
 */
app.patch('/api/opportunities/:id', async (req, res) => {
  try {
    const data = await readData();
    const index = data.opportunities.findIndex(o => o.id === req.params.id);
    
    if (index >= 0) {
      data.opportunities[index] = { 
        ...data.opportunities[index], 
        ...req.body, 
        updatedAt: new Date().toISOString() 
      };
    } else {
      data.opportunities.push({ 
        id: req.params.id, 
        ...req.body, 
        createdAt: new Date().toISOString() 
      });
    }
    
    await writeData(data);
    res.json({ success: true, opportunity: data.opportunities.find(o => o.id === req.params.id) });
  } catch (error) {
    console.error('Error updating opportunity:', error.message);
    res.status(500).json({ error: 'Failed to update opportunity', details: error.message });
  }
});

/**
 * DELETE /api/opportunities/:id
 * Delete a single opportunity
 */
app.delete('/api/opportunities/:id', async (req, res) => {
  try {
    const data = await readData();
    const originalLength = data.opportunities.length;
    data.opportunities = data.opportunities.filter(o => o.id !== req.params.id);
    
    if (data.opportunities.length === originalLength) {
      return res.status(404).json({ error: 'Opportunity not found' });
    }
    
    // Also remove related activities
    data.activities = data.activities.filter(a => a.opportunityId !== req.params.id);
    
    await writeData(data);
    res.json({ success: true, deleted: req.params.id });
  } catch (error) {
    console.error('Error deleting opportunity:', error.message);
    res.status(500).json({ error: 'Failed to delete opportunity', details: error.message });
  }
});

/**
 * PATCH /api/companies/:id
 * Update or create a single company
 */
app.patch('/api/companies/:id', async (req, res) => {
  try {
    const data = await readData();
    const index = data.companies.findIndex(c => c.id === req.params.id);
    
    if (index >= 0) {
      data.companies[index] = { 
        ...data.companies[index], 
        ...req.body, 
        updatedAt: new Date().toISOString() 
      };
    } else {
      data.companies.push({ 
        id: req.params.id, 
        ...req.body, 
        createdAt: new Date().toISOString() 
      });
    }
    
    await writeData(data);
    res.json({ success: true, company: data.companies.find(c => c.id === req.params.id) });
  } catch (error) {
    console.error('Error updating company:', error.message);
    res.status(500).json({ error: 'Failed to update company', details: error.message });
  }
});

/**
 * DELETE /api/companies/:id
 * Delete a single company
 */
app.delete('/api/companies/:id', async (req, res) => {
  try {
    const data = await readData();
    const originalLength = data.companies.length;
    data.companies = data.companies.filter(c => c.id !== req.params.id);
    
    if (data.companies.length === originalLength) {
      return res.status(404).json({ error: 'Company not found' });
    }
    
    await writeData(data);
    res.json({ success: true, deleted: req.params.id });
  } catch (error) {
    console.error('Error deleting company:', error.message);
    res.status(500).json({ error: 'Failed to delete company', details: error.message });
  }
});

/**
 * PATCH /api/contacts/:id
 * Update or create a single contact
 */
app.patch('/api/contacts/:id', async (req, res) => {
  try {
    const data = await readData();
    const index = data.contacts.findIndex(c => c.id === req.params.id);
    
    if (index >= 0) {
      data.contacts[index] = { 
        ...data.contacts[index], 
        ...req.body, 
        updatedAt: new Date().toISOString() 
      };
    } else {
      data.contacts.push({ 
        id: req.params.id, 
        ...req.body, 
        createdAt: new Date().toISOString() 
      });
    }
    
    await writeData(data);
    res.json({ success: true, contact: data.contacts.find(c => c.id === req.params.id) });
  } catch (error) {
    console.error('Error updating contact:', error.message);
    res.status(500).json({ error: 'Failed to update contact', details: error.message });
  }
});

/**
 * DELETE /api/contacts/:id
 * Delete a single contact
 */
app.delete('/api/contacts/:id', async (req, res) => {
  try {
    const data = await readData();
    const originalLength = data.contacts.length;
    data.contacts = data.contacts.filter(c => c.id !== req.params.id);
    
    if (data.contacts.length === originalLength) {
      return res.status(404).json({ error: 'Contact not found' });
    }
    
    await writeData(data);
    res.json({ success: true, deleted: req.params.id });
  } catch (error) {
    console.error('Error deleting contact:', error.message);
    res.status(500).json({ error: 'Failed to delete contact', details: error.message });
  }
});

/**
 * PATCH /api/activities/:id
 * Update or create a single activity
 */
app.patch('/api/activities/:id', async (req, res) => {
  try {
    const data = await readData();
    const index = data.activities.findIndex(a => a.id === req.params.id);
    
    if (index >= 0) {
      data.activities[index] = { 
        ...data.activities[index], 
        ...req.body, 
        updatedAt: new Date().toISOString() 
      };
    } else {
      data.activities.push({ 
        id: req.params.id, 
        ...req.body, 
        createdAt: new Date().toISOString() 
      });
    }
    
    await writeData(data);
    res.json({ success: true, activity: data.activities.find(a => a.id === req.params.id) });
  } catch (error) {
    console.error('Error updating activity:', error.message);
    res.status(500).json({ error: 'Failed to update activity', details: error.message });
  }
});

/**
 * DELETE /api/activities/:id
 * Delete a single activity
 */
app.delete('/api/activities/:id', async (req, res) => {
  try {
    const data = await readData();
    const originalLength = data.activities.length;
    data.activities = data.activities.filter(a => a.id !== req.params.id);
    
    if (data.activities.length === originalLength) {
      return res.status(404).json({ error: 'Activity not found' });
    }
    
    await writeData(data);
    res.json({ success: true, deleted: req.params.id });
  } catch (error) {
    console.error('Error deleting activity:', error.message);
    res.status(500).json({ error: 'Failed to delete activity', details: error.message });
  }
});

// ============================================
// Health & Diagnostics
// ============================================

/**
 * GET /api/health
 * Health check endpoint for monitoring
 */
app.get('/api/health', async (req, res) => {
  try {
    // Test blob storage connectivity
    await containerClient.exists();
    res.json({ 
      status: 'healthy', 
      timestamp: new Date().toISOString(),
      storage: 'connected',
      container: containerName,
      blob: blobName
    });
  } catch (error) {
    res.status(503).json({ 
      status: 'unhealthy', 
      timestamp: new Date().toISOString(),
      storage: 'disconnected',
      error: error.message
    });
  }
});

/**
 * GET /api/backup
 * Download a timestamped backup of all data
 */
app.get('/api/backup', async (req, res) => {
  try {
    const data = await readData();
    const timestamp = new Date().toISOString().split('T')[0];
    res.setHeader('Content-Disposition', `attachment; filename=crm-backup-${timestamp}.json`);
    res.setHeader('Content-Type', 'application/json');
    res.json(data);
  } catch (error) {
    console.error('Error creating backup:', error.message);
    res.status(500).json({ error: 'Failed to create backup', details: error.message });
  }
});

// ============================================
// SPA Fallback - serve index.html for all non-API routes
// ============================================
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============================================
// Error handling
// ============================================
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ============================================
// Start server
// ============================================
app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║           Opportunity Tracker Server Started               ║
╠════════════════════════════════════════════════════════════╣
║  Port:      ${PORT.toString().padEnd(44)}║
║  Container: ${containerName.padEnd(44)}║
║  Blob:      ${blobName.padEnd(44)}║
║  Time:      ${new Date().toISOString().padEnd(44)}║
╚════════════════════════════════════════════════════════════╝
  `);
});
